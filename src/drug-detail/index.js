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

async function requestToAPI(req) {
  try {
    const { ITEM_SEQ } = req.query;
    const { API_URL, ENC_SERVICE_KEY } = process.env;

    if (!ITEM_SEQ) {
      throw new Error(`Invalid query ${ITEM_SEQ}`);
    }

    const result = await axios.get(
      `${API_URL}&serviceKey=${ENC_SERVICE_KEY}&item_seq=${ITEM_SEQ}`
    );

    const drugDetail = result?.data?.body?.items?.[0];

    if (!drugDetail) {
      console.log("Invalid response %s", result?.data?.body);
      throw new Error(`Invalid response`);
    }

    return drugDetail;
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

functions.http("drugDetail", async (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.status(401);
        return;
      }

      const drugDetail = await requestToAPI(req);

      res.status(200).json(drugDetail);
      break;
    }
  }
});
