const encoder = new TextEncoder();

/**
 * 시크릿 키 import
 * @param {String} secret 시크릿 키
 * @returns
 */
async function importKey(secret) {
  const format = "raw";
  const encodedSecret = encoder.encode(secret);
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const extractable = false;
  const keyUsages = ["sign", "verify"];

  return crypto.subtle.importKey(
    format,
    encodedSecret,
    algorithm,
    extractable,
    keyUsages,
  );
}

/**
 * base64 URL을 디코딩
 * @param {String} str base64 URL
 * @returns
 */
function decodeBase64URL(str) {
  const replacedStr = str.replace(/-/g, "+").replace(/_/g, "/");

  return Uint8Array.from(atob(replacedStr), (c) => c.charCodeAt(0));
}

/**
 * 토큰 검증
 * @param {String} token 토큰
 * @param {String} secret 시크릿 키
 * @returns
 */
export async function verifyToken(token, secret) {
  const [tsB64, sigB64] = token.split(".");
  const isValidFormatToken = tsB64 && sigB64;
  if (!isValidFormatToken) {
    return false;
  }

  const timestamp = atob(tsB64);
  const tokenTime = Number(timestamp);
  if (Number.isNaN(tokenTime)) {
    return false;
  }

  const isExpiredToken = Date.now() - tokenTime > 10 * 60 * 1000;
  if (isExpiredToken) {
    return false;
  }

  const algorithm = "HMAC";
  const key = await importKey(secret);
  const signature = decodeBase64URL(sigB64);
  const data = encoder.encode(timestamp);

  return crypto.subtle.verify(algorithm, key, signature, data);
}
