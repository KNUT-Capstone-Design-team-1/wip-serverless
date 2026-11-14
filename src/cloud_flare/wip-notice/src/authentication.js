const TOKEN_EXPIRY_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const MAX_CLOCK_SKEW_MS = 30 * 1000;
// Reader and admin keys have independent, bounded import caches.
function createKeyImporter() {
  let cachedKey = null;
  return (secret) => {
    if (cachedKey?.secret === secret) return cachedKey.promise;
    const entry = { secret, promise: null };
    entry.promise = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    ).catch((error) => {
      if (cachedKey === entry) cachedKey = null;
      throw error;
    });
    cachedKey = entry;
    return entry.promise;
  };
}

const importKey = createKeyImporter();
const importAdminKey = createKeyImporter();

function decodeBase64URL(value) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new Error("Invalid Base64");
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * Verify Base64(timestamp).Base64URL(HMAC-SHA256(timestamp)).
 * Keys are reused; authentication results are checked on every request.
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<boolean>}
 */
async function verifySignedToken(token, secret, getKey) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [tsB64, sigB64] = parts;
  if (!tsB64 || tsB64.length > 24 || sigB64.length < 43 || sigB64.length > 44) return false;

  try {
    const timestamp = decodeBase64URL(tsB64);
    if (!/^\d+$/.test(timestamp)) return false;
    const tokenTime = Number(timestamp);
    if (!Number.isSafeInteger(tokenTime) || tokenTime <= 0) return false;
    const age = Date.now() - tokenTime;
    if (age > TOKEN_EXPIRY_MS || age < -MAX_CLOCK_SKEW_MS) return false;

    const signature = Uint8Array.from(decodeBase64URL(sigB64), (c) => c.charCodeAt(0));
    if (signature.length !== 32) return false;
    const key = await getKey(secret);
    return await crypto.subtle.verify("HMAC", key, signature, encoder.encode(timestamp));
  } catch {
    return false;
  }
}

export function verifyToken(token, secret) {
  return verifySignedToken(token, secret, importKey);
}

/** Admin credentials must be configured separately from public app credentials. */
export async function verifyAdminToken(token, env = {}) {
  const secret = env.ADMIN_SECRET_KEY;
  if (typeof secret !== "string" || encoder.encode(secret).length < 32 || secret === env.SECRET_KEY) {
    return false;
  }
  return verifySignedToken(token, secret, importAdminKey);
}
