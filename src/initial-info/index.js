const functions = require("@google-cloud/functions-framework");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const fs = require("fs");
const path = require("path");
const NodeRSA = require("node-rsa");

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
 * 초기화 정보 조회
 * @param {Request} req 
 * @returns 
 */
function getInitInfo(req) {
  const token = getToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  const authenticate = authenticateRSA(token);
  if (!authenticate) {
    return null;
  }

  return {
    appVersion: "2.1.0",
    resourceDate: "2025-07-08",
  };
}

functions.http("initInfo", (req, res) => {
  switch (req.method) {
    case "GET": {
      const initialInfo = getInitInfo(req);

      if (!initialInfo) {
        res.status(401);
        return;
      }

      res.status(200).json(initialInfo);
      break;
    }

    default:
      res.status(405).send();
  }
});
