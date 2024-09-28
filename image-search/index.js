require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const fs = require("fs");
const path = require("path");
const NodeRSA = require("node-rsa");
const axios = require("axios");

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

/**
 * 딥러닝 서버에 요청
 * @param {Request} req
 * @returns
 */
async function requestDLServer(req) {
  try {
    const result = await axios.post(
      process.env.GOOGLE_CLOUD_DL_SERVER_URL,
      { base64: req.body.base64 },
      { headers: { "Content-Type": "application/json" } }
    );
  
    return result;
  } catch (e) {
    if (e.errors) {
      for (const e1 of e.errors) {
        console.log('Aggergate DLServer Error', e1.stack || e1);
      }
    } else {
      console.log('Standard DL Server Error', e.stack || e);
    }

    throw e;
  }
}

functions.http("imageSearch", async (req, res) => {
  switch (req.method) {
    case "POST": {
      if (!authenticate(req)) {
        res.status(401);
        return;
      }

      const searchResult = await requestDLServer(req);

      res.status(searchResult.status).json(searchResult.data);
      break;
    }

    default:
      res.status(405).send();
  }
});
