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
    const { pageNo, numOfRows, Q0, Q1, QT, QN } = req.query;
    const { API_URL, ENC_SERVICE_KEY } = process.env;

    const result = await axios.get(`${API_URL}?serviceKey=${ENC_SERVICE_KEY}`, {
      params: {
        serviceKey: ENC_SERVICE_KEY,
        pageNo,
        numOfRows,
        Q0,
        Q1,
        QT,
        QN,
      },
    });

    const pharmacies = result?.data?.response?.body?.items;

    if (!pharmacies) {
      console.log("Invalid response %s", result?.data?.response);
      throw new Error(`Invalid response`);
    }

    return pharmacies;
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

functions.http("nearbyPharmacy", async (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.status(401);
        return;
      }

      const pharmacies = await requestToAPI(req);

      res.status(200).json(pharmacies);
      break;
    }
  }
});
