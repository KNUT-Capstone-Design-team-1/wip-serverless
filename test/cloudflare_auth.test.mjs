import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

let sequence = 0;
const NOW = 1800000000000;
const SECRET = "unit-test-secret";

function sign(timestamp, secret = SECRET, encoding = "base64url") {
  const text = String(timestamp);
  return `${Buffer.from(text).toString("base64")}.${createHmac("sha256", secret).update(text).digest(encoding)}`;
}

async function freshAuth(service) {
  return import(`../src/cloud_flare/${service}/src/authentication.js?test=${sequence++}`);
}

for (const service of ["wip-notice", "wip-unified-search"]) {
  test(`${service}: valid legacy tokens, key reuse, concurrent import and key rotation`, async (t) => {
    t.mock.method(Date, "now", () => NOW);
    const { verifyToken } = await freshAuth(service);
    let imports = 0;
    let verifications = 0;
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    t.mock.method(crypto.subtle, "importKey", (...args) => {
      imports++;
      assert.deepEqual(args[4], ["verify"]);
      return originalImport(...args);
    });
    t.mock.method(crypto.subtle, "verify", (...args) => { verifications++; return originalVerify(...args); });
    assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => verifyToken(sign(NOW), SECRET))), Array(10).fill(true));
    assert.equal(imports, 1);
    assert.equal(verifications, 10);
    assert.equal(await verifyToken(sign(NOW, SECRET, "base64"), SECRET), true);
    assert.equal(await verifyToken(sign(NOW), "rotated-secret"), false);
    assert.equal(await verifyToken(sign(NOW, "rotated-secret"), "rotated-secret"), true);
    assert.equal(imports, 2);
    assert.equal(await verifyToken(sign(NOW), SECRET), true);
    assert.equal(imports, 3);
  });

  test(`${service}: invalid input, expiry and future timestamps fail before key import`, async (t) => {
    t.mock.method(Date, "now", () => NOW);
    const { verifyToken } = await freshAuth(service);
    let imports = 0;
    t.mock.method(crypto.subtle, "importKey", () => { imports++; throw new Error("must not import"); });
    const valid = sign(NOW);
    for (const token of [undefined, null, 42, {}, "", "a.b.c", ".", valid + ".extra",
      `%.${valid.split(".")[1]}`, `${valid.split(".")[0]}.${"!".repeat(43)}`,
      sign("Infinity"), sign("NaN"), sign(""), sign(" "), sign(-1), sign(1.5),
      sign(Number.MAX_SAFE_INTEGER + 1), sign(NOW - 600001), sign(NOW + 30001)]) {
      assert.equal(await verifyToken(token, SECRET), false, String(token));
    }
    for (const secret of [undefined, null, 42, ""]) assert.equal(await verifyToken(valid, secret), false);
    assert.equal(imports, 0);
  });

  test(`${service}: cached keys do not bypass expiry and import errors can recover`, async (t) => {
    let clock = NOW;
    t.mock.method(Date, "now", () => clock);
    const { verifyToken } = await freshAuth(service);
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    let fail = true;
    let imports = 0;
    t.mock.method(crypto.subtle, "importKey", (...args) => {
      imports++;
      if (fail) return Promise.reject(new Error("temporary import error"));
      return originalImport(...args);
    });
    assert.equal(await verifyToken(sign(NOW), SECRET), false);
    fail = false;
    assert.equal(await verifyToken(sign(NOW), SECRET), true);
    assert.equal(imports, 2);
    clock = NOW + 600000;
    assert.equal(await verifyToken(sign(NOW), SECRET), true);
    clock++;
    assert.equal(await verifyToken(sign(NOW), SECRET), false);
    assert.equal(imports, 2);
  });

  test(`${service}: worker returns 401 for malformed credentials before touching D1`, async () => {
    const { default: worker } = await import(`../src/cloud_flare/${service}/worker.js`);
    const env = { SECRET_KEY: SECRET, D1: { prepare() { throw new Error("D1 must not be used"); } } };
    const url = service === "wip-notice" ? "https://example.com/notices" : "https://example.com/?keyword=aspirin";
    for (const token of [null, "invalid", "%25.invalid", sign(Date.now()) + ".extra"]) {
      const headers = token ? { "x-auth-token": token } : {};
      assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 401);
    }
  });
}
