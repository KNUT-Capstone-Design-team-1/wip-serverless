import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createNotice, readNotices } from "../src/notices.js";
import { updateNotice, deleteNotice } from "../src/notices_idx.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE Notices (idx INTEGER PRIMARY KEY, title TEXT, contents TEXT,
    mustRead INTEGER, createDate TEXT, updateDate TEXT);
    INSERT INTO Notices VALUES (1, 'first', 'body', 1, '', ''), (2, 'second', 'body', 0, '', '');`);
  db.exec(readFileSync(new URL("../migrations/0001_notice_query_indexes.sql", import.meta.url), "utf8"));
  const entries = new Map();
  let batches = 0;
  const env = {
    D1: {
      prepare(sql) {
        return { sql, params: [], bind(...params) { this.params = params; return this; } };
      },
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
    WIP_NOTICE: {
      async get(key, type) {
        const entry = entries.get(key);
        return entry ? (type === "json" ? JSON.parse(entry.value) : entry.value) : null;
      },
      async put(key, value, options) { entries.set(key, { value, options }); },
    },
  };
  return { db, env, entries, batches: () => batches };
}

const request = (query = "") => new Request(`https://example.com/notices${query}`);
const payload = (body) => new Request("https://example.com/notices", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("notice cache, TTL, batching, pagination, filtering, and write invalidation", async () => {
  const f = fixture();
  try {
    const tasks = [];
    const ctx = { waitUntil: (task) => tasks.push(task) };
    let response = await readNotices(request(), f.env, ctx);
    await Promise.all(tasks);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=86400");
    assert.equal(response.headers.get("X-Cache-Status"), "MISS");
    assert.equal((await response.json()).total, 2);
    assert.equal(f.batches(), 1);
    assert.equal([...f.entries.values()][0].options.expirationTtl, 31536000);
    response = await readNotices(request(), f.env);
    assert.equal(response.headers.get("X-Cache-Status"), "HIT (KV)");
    assert.equal(f.batches(), 1);

    response = await readNotices(request("?skip=1&limit=1"), f.env);
    let data = await response.json();
    assert.deepEqual(data.notices.map((n) => n.idx), [2]);
    assert.equal(data.total, 2);
    response = await readNotices(request("?mustRead=1"), f.env);
    assert.deepEqual((await response.json()).notices.map((n) => n.idx), [1]);

    await updateNotice(1, payload({ mustRead: false }), f.env);
    response = await readNotices(request("?mustRead=1"), f.env);
    assert.equal(response.headers.get("X-Cache-Status"), "MISS");
    assert.equal((await response.json()).total, 0);
    await updateNotice(2, payload({ title: "updated" }), f.env);
    assert.equal(f.db.prepare("SELECT title FROM Notices WHERE idx=2").get().title, "updated");
    await createNotice(payload({ title: "third", contents: "body", mustRead: true }), f.env);
    response = await readNotices(request(), f.env);
    assert.equal((await response.json()).total, 3);
    await deleteNotice(3, f.env);
    response = await readNotices(request(), f.env);
    assert.equal((await response.json()).total, 2);

    response = await readNotices(request("?skip=100"), f.env);
    data = await response.json();
    assert.deepEqual(data.notices, []);
    assert.equal(data.total, 2);
    const before = f.batches();
    for (const query of ["?skip=-1", "?limit=-1", "?skip=abc", "?limit=1.5"]) {
      assert.equal((await readNotices(request(query), f.env)).status, 400);
    }
    assert.equal((await readNotices(request("?limit=11"), f.env)).status, 413);
    assert.equal(f.batches(), before);
    assert.equal((await readNotices(request("?limit=0"), f.env)).status, 200);
    const plan = f.db.prepare("EXPLAIN QUERY PLAN SELECT idx FROM Notices WHERE mustRead=1 ORDER BY idx LIMIT 10").all();
    assert.ok(plan.some((row) => row.detail.includes("idx_notices_must_read_idx")));
  } finally { f.db.close(); }
});

test("a pre-write read cannot repopulate the current notice cache version", async () => {
  const f = fixture();
  try {
    const { findCachedNotices, saveCachedNotices, invalidateNoticeCache } = await import("../src/cache.js");
    const options = { mustRead: false, skip: 0, limit: 10 };
    const stale = await findCachedNotices(f.env, options);
    await invalidateNoticeCache(f.env);
    await saveCachedNotices(f.env, stale.key, { stale: true });
    assert.equal((await findCachedNotices(f.env, options)).data, null);
    const withoutKv = { D1: f.env.D1 };
    assert.equal((await readNotices(request(), withoutKv)).status, 200);
  } finally { f.db.close(); }
});
