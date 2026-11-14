const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const fs = require("fs");
const path = require("path");
const NodeRSA = require("node-rsa");

dayjs.extend(utc);
let rsa;

/**
 * auth header로 부터 토큰을 추출
 * @param {String} authHeader
 * @returns
 */
function getToken(authHeader) {
  return typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.substring(7, authHeader.length)
    : null;
}

/**
 * 토큰 인증
 * @param {String} token 토큰 (base64)
 * @returns
 */
function authenticateRSA(token) {
  if (!rsa) {
    const rsaPrvKey = fs.readFileSync(path.resolve("./rsa_prv_key"), "utf-8");
    rsa = new NodeRSA(rsaPrvKey);
  }
  const encryptDate = rsa.decrypt(token, "utf8");
  const now = dayjs.utc();
  const issuedAt = dayjs.utc(encryptDate);
  if (!issuedAt.isValid() || issuedAt.valueOf() - now.valueOf() > 30 * 1000) {
    return false;
  }
  const expireDate = issuedAt.add(10, "minute");

  return now.isBefore(expireDate);
}

/**
 * 인증
 * @param {Request} req
 */
function authenticate(req) {
  const token = getToken(req.headers.authorization);
  if (!token) {
    return false;
  }

  try {
    return authenticateRSA(token);
  } catch {
    return false;
  }
}

module.exports = { authenticate };
