const { createHmac } = require("node:crypto");

function createNoticeAdminHeaders(secret, adminSecret, now = Date.now()) {
  if (typeof secret !== "string" || !secret) throw new Error("SECRET_KEY is required");
  if (typeof adminSecret !== "string" || Buffer.byteLength(adminSecret) < 32) {
    throw new Error("ADMIN_SECRET_KEY must contain at least 32 UTF-8 bytes");
  }
  if (adminSecret === secret) throw new Error("Admin and reader secrets must be different");
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("Invalid timestamp");
  const timestamp = String(now);
  const prefix = Buffer.from(timestamp).toString("base64");
  const sign = (key) => `${prefix}.${createHmac("sha256", key).update(timestamp).digest("base64url")}`;
  return { "x-auth-token": sign(secret), "x-admin-token": sign(adminSecret) };
}

if (require.main === module) {
  try {
    const headers = createNoticeAdminHeaders(process.env.SECRET_KEY, process.env.ADMIN_SECRET_KEY);
    process.stdout.write(`${JSON.stringify(headers, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createNoticeAdminHeaders };
