const encoder = new TextEncoder();

/**
 * 시크릿 키 import
 * @param {String} secret 시크릿 키
 * @returns 
 */
async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * base64 URL을 디코딩
 * @param {String} str base64 URL
 * @returns 
 */
function decodeBase64URL(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

/**
 * 토큰 검증
 * @param {String} token 토큰
 * @param {String} secret 시크릿 키
 * @returns 
 */
export async function verifyToken(token, secret) {
  const [tsB64, sigB64] = token.split(".");
  if (!tsB64 || !sigB64) return false;

  const timestamp = atob(tsB64);
  const tokenTime = Number(timestamp);
  if (Number.isNaN(tokenTime)) return false;

  // ⏱ 10분 검증
  if (Date.now() - tokenTime > 10 * 60 * 1000) {
    return false;
  }

  const key = await importKey(secret);

  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64URL(sigB64),
    encoder.encode(timestamp),
  );
}
