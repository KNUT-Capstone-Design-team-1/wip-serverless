import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import worker from "../worker.js";
import tokenGenerator from "../scripts/create-admin-token.cjs";

const { createNoticeAdminHeaders } = tokenGenerator;
const SECRET = "reader-test-secret-" + "r".repeat(32);
const ADMIN_SECRET = "admin-test-secret-" + "a".repeat(32);
const NOW = 1800000000000;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE Notices (idx INTEGER PRIMARY KEY, title TEXT, contents TEXT,
    mustRead INTEGER, createDate TEXT, updateDate TEXT);
    INSERT INTO Notices VALUES (1, 'first', 'body', 1, '', '');`);
  let batches = 0;
  const env = {
    SECRET_KEY: SECRET, ADMIN_SECRET_KEY: ADMIN_SECRET,
    D1: {
      prepare(sql) { return { sql, params: [], bind(...params) { this.params = params; return this; } }; },
      async batch(statements) {
        batches++;
        return statements.map(({ sql, params }) => {
          const statement = db.prepare(sql);
          if (/^SELECT/.test(sql.trim())) return { results: statement.all(...params) };
          statement.run(...params);
          return { results: [] };
        });
      },
    },
  };
  return { db, env, batches: () => batches };
}

function request(method, pathname, headers, body = { title: "new", contents: "body" }) {
  return new Request(`https://example.com${pathname}`, {
    method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }),
  });
}

test("readers can list notices without admin configuration", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    delete f.env.ADMIN_SECRET_KEY;
    const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
    const res = await worker.fetch(request("GET", "/notices", { "x-auth-token": headers["x-auth-token"] }), f.env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).total, 1);
    assert.equal(f.batches(), 1);
  } finally { f.db.close(); }
});

test("all notice mutation routes reject reader credentials without reading the body or D1", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
    for (const [method, pathname] of [["POST", "/notices"], ["POST", "/notices/"], ["PUT", "/notices/1"], ["DELETE", "/notices/1"]]) {
      for (const adminToken of [undefined, headers["x-auth-token"], "invalid", headers["x-admin-token"] + ".extra"]) {
        const auth = { "x-auth-token": headers["x-auth-token"] };
        if (adminToken) auth["x-admin-token"] = adminToken;
        const req = request(method, pathname + "?role=admin", auth, { title: "forged", role: "admin", admin: true });
        const res = await worker.fetch(req, f.env);
        assert.equal(res.status, 403);
        assert.equal(res.headers.get("Cache-Control"), "no-store");
        assert.equal(req.bodyUsed, false);
      }
    }
    assert.equal(f.batches(), 0);
    assert.equal(f.db.prepare("SELECT title FROM Notices WHERE idx=1").get().title, "first");
  } finally { f.db.close(); }
});

test("missing, short or reused admin secrets deny writes even with a signed admin token", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    for (const secret of [undefined, "", "short", SECRET]) {
      f.env.ADMIN_SECRET_KEY = secret;
      const timestamp = String(NOW);
      const token = `${Buffer.from(timestamp).toString("base64")}.${createHmac("sha256", secret || "missing").update(timestamp).digest("base64url")}`;
      const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
      headers["x-admin-token"] = token;
      assert.equal((await worker.fetch(request("POST", "/notices", headers), f.env)).status, 403);
    }
    assert.equal(f.batches(), 0);
  } finally { f.db.close(); }
});

test("admin credentials do not bypass reader authentication or token expiry", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
    const adminOnly = { "x-admin-token": headers["x-admin-token"] };
    assert.equal((await worker.fetch(request("DELETE", "/notices/1", adminOnly), f.env)).status, 401);
    assert.equal((await worker.fetch(request("DELETE", "/notices/1", { ...headers, "x-auth-token": "invalid" }), f.env)).status, 401);
    for (const timestamp of [NOW - 600001, NOW + 30001]) {
      const expired = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, timestamp);
      const auth = { ...headers, "x-admin-token": expired["x-admin-token"] };
      assert.equal((await worker.fetch(request("DELETE", "/notices/1", auth), f.env)).status, 403);
    }
    assert.equal(f.batches(), 0);
  } finally { f.db.close(); }
});

test("separate admin credentials permit create, update and delete", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
    assert.equal((await worker.fetch(request("POST", "/notices", headers), f.env)).status, 201);
    assert.equal((await worker.fetch(request("PUT", "/notices/2", headers, { title: "updated", mustRead: false }), f.env)).status, 200);
    assert.equal(f.db.prepare("SELECT title FROM Notices WHERE idx=2").get().title, "updated");
    assert.equal((await worker.fetch(request("DELETE", "/notices/2", headers), f.env)).status, 200);
    assert.equal(f.db.prepare("SELECT COUNT(*) count FROM Notices").get().count, 1);
    assert.equal(f.batches(), 3);
    assert.equal((await worker.fetch(request("POST", "/notices/", headers), f.env)).status, 201);
    const before = f.batches();
    assert.equal((await worker.fetch(request("DELETE", "/notices/9007199254740993", headers), f.env)).status, 400);
    assert.equal(f.batches(), before);
  } finally { f.db.close(); }
});

test("reader and admin keys are reused independently and admin rotation rejects old credentials", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const { verifyToken, verifyAdminToken } = await import("../src/authentication.js?admin-cache-test");
  const original = crypto.subtle.importKey.bind(crypto.subtle);
  let imports = 0;
  t.mock.method(crypto.subtle, "importKey", (...args) => { imports++; return original(...args); });
  const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
  const env = { SECRET_KEY: SECRET, ADMIN_SECRET_KEY: ADMIN_SECRET };
  for (let i = 0; i < 3; i++) {
    assert.equal(await verifyToken(headers["x-auth-token"], SECRET), true);
    assert.equal(await verifyAdminToken(headers["x-admin-token"], env), true);
  }
  assert.equal(imports, 2);
  env.ADMIN_SECRET_KEY = "rotated-admin-key-" + "z".repeat(32);
  assert.equal(await verifyAdminToken(headers["x-admin-token"], env), false);
  const rotated = createNoticeAdminHeaders(SECRET, env.ADMIN_SECRET_KEY, NOW);
  assert.equal(await verifyAdminToken(rotated["x-admin-token"], env), true);
  assert.equal(imports, 3);
});

test("token generator rejects unsafe configuration without exposing secret values", () => {
  assert.throws(() => createNoticeAdminHeaders(undefined, ADMIN_SECRET), /SECRET_KEY is required/);
  assert.throws(() => createNoticeAdminHeaders(SECRET, "short"), /at least 32/);
  assert.throws(() => createNoticeAdminHeaders(SECRET, SECRET), /must be different/);
});

test("malformed JSON never reaches D1, and readers are denied before parsing", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  try {
    const headers = createNoticeAdminHeaders(SECRET, ADMIN_SECRET, NOW);
    for (const [method, path] of [["POST", "/notices"], ["PUT", "/notices/1"]]) {
      const invalid = (auth) => new Request(`https://example.com${path}`, {
        method, headers: { "Content-Type": "application/json", ...auth }, body: "{broken",
      });
      assert.equal((await worker.fetch(invalid(headers), f.env)).status, 400);
      const reader = invalid({ "x-auth-token": headers["x-auth-token"] });
      assert.equal((await worker.fetch(reader, f.env)).status, 403);
      assert.equal(reader.bodyUsed, false);
    }
    assert.equal(f.batches(), 0);
  } finally { f.db.close(); }
});
