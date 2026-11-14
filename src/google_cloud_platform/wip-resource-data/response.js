const { createHash } = require("node:crypto");
const { promisify } = require("node:util");
const zlib = require("node:zlib");

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

function createJsonResponse(data) {
  const body = Buffer.from(JSON.stringify(data));
  const etag = `W/"${createHash("sha256").update(body).digest("base64")}"`;
  const encodings = new Map();

  function getEncoded(encoding) {
    if (encoding === "identity") return Promise.resolve(body);
    if (!encodings.has(encoding)) {
      const task = encoding === "br"
        ? brotli(body, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        } })
        : (encoding === "gzip" ? gzip : deflate)(body, { level: 9 });
      encodings.set(encoding, task.catch((error) => { encodings.delete(encoding); throw error; }));
    }
    return encodings.get(encoding);
  }

  return { body, etag, getEncoded };
}

async function sendJsonResponse(req, res, response) {
  let encoding = req.acceptsEncodings("br", "gzip", "deflate", "identity");
  res.vary("Accept-Encoding");
  if (!encoding) return res.sendStatus(406);
  res.status(200).type("json").set("ETag", response.etag);
  if (req.fresh) return res.status(304).end();

  let body = await response.getEncoded(encoding);
  if (encoding !== "identity" && body.length >= response.body.length && req.acceptsEncodings("identity")) {
    encoding = "identity";
    body = response.body;
  }
  if (encoding !== "identity") res.set("Content-Encoding", encoding);
  return res.send(body);
}

module.exports = { createJsonResponse, sendJsonResponse };
