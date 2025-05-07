require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const fs = require("fs");
const path = require("path");
const NodeRSA = require("node-rsa");
const markImageData = require("./mark_image_data.json");

/**
 * auth header로 부터 토큰을 추출
 * @param {String} authHeader
 * @returns
 */
function getToken(authHeader) {
  return authHeader.startsWith("Bearer ")
    ? authHeader.substring(7, authHeader.length)
    : null;
}

/**
 * 토큰 인증
 * @param {String} token 토큰 (base64)
 * @returns
 */
function authenticateRSA(token) {
  const rsaPrvKey = fs.readFileSync(
    path.join(__dirname, "./rsa_prv_key"),
    "utf-8"
  );

  const encryptDate = new NodeRSA(rsaPrvKey).decrypt(token, "utf8");

  dayjs.extend(utc);
  const now = dayjs.utc();
  const expireDate = dayjs.utc(encryptDate).add(10, "minute");

  return now.isBefore(expireDate);
}

/**
 * 토큰 인증
 * @param {Request} req
 * @returns
 */
function authenticate(req) {
  const token = getToken(req.headers.authorization);
  if (!token) {
    return false;
  }

  const authenticate = authenticateRSA(token);
  if (!authenticate) {
    return false;
  }

  return true;
}

async function getMarkImageData(req) {
  try {
    const { page, limit } = req.query;

    if (!page || !limit) {
      throw new Error(
        `Page and limit not received. page: ${page}, limit: ${limit}`
      );
    }

    if (limit > 50) {
      throw new Error(`Limit is very large. limit: ${limit}`);
    }

    const total = markImageData.length;
    const totalPage = Math.ceil(total / limit);
    const current = (page - 1) * limit;
    const data = markImageData.slice(current, current + limit);

    return { total, totalPage, page, limit, data };
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

functions.http("markImage", async (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.status(401);
        return;
      }

      res.status(200).json(await getMarkImageData(req));
      break;
    }
  }
});
