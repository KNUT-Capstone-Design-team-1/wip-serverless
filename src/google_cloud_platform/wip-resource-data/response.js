const { createHash } = require("node:crypto");
const { promisify } = require("node:util");
const zlib = require("node:zlib");

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

function createResponse({ body, bodyLength, etag, availableEncodings, loadEncoded, onSizeChange }) {
  const encodings = new Map();
  let size = body ? body.length : 0;

  function getEncoded(encoding) {
    if (!availableEncodings.includes(encoding)) return Promise.reject(new Error("Unsupported encoding"));
    if (encoding === "identity" && body) return Promise.resolve(body);
    if (!encodings.has(encoding)) {
      const task = Promise.resolve().then(() => loadEncoded(encoding)).then((encoded) => {
        size += encoded.length;
        if (onSizeChange) onSizeChange();
        return encoded;
      });
      encodings.set(encoding, task.catch((error) => { encodings.delete(encoding); throw error; }));
    }
    return encodings.get(encoding);
  }

  return { body, bodyLength, etag, availableEncodings, getEncoded, get size() { return size; } };
}

function createJsonResponse(data, { onSizeChange } = {}) {
  const body = Buffer.from(JSON.stringify(data));
  return createResponse({
    body, bodyLength: body.length,
    etag: `W/"${createHash("sha256").update(body).digest("base64")}"`,
    availableEncodings: ["br", "gzip", "deflate", "identity"], onSizeChange,
    loadEncoded(encoding) {
      return encoding === "br"
        ? brotli(body, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        } })
        : (encoding === "gzip" ? gzip : deflate)(body, { level: 6 });
    },
  });
}

function createStoredResponse(page, loadEncoded, onSizeChange) {
  return createResponse({
    bodyLength: page.bodyLength, etag: page.etag,
    availableEncodings: ["br", "gzip", "deflate", "identity"], loadEncoded, onSizeChange,
  });
}

async function sendJsonResponse(req, res, response) {
  let encoding = req.acceptsEncodings(...response.availableEncodings);
  res.vary("Accept-Encoding");
  if (!encoding) return res.sendStatus(406);
  res.status(200).type("json").set("ETag", response.etag).set("Cache-Control", "private, no-cache");
  if (req.fresh) return res.status(304).end();

  let body = await response.getEncoded(encoding);
  if (encoding !== "identity" && body.length >= response.bodyLength && req.acceptsEncodings("identity")) {
    encoding = "identity";
    body = await response.getEncoded("identity");
  }
  if (encoding !== "identity") res.set("Content-Encoding", encoding);
  return res.send(body);
}

module.exports = { createJsonResponse, createStoredResponse, sendJsonResponse };
