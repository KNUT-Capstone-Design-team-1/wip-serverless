import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { searchUnified } from "../src/unified_search.js";
import { decodeAndValidateCursor } from "../src/cursor.js";
import { handleSearchRequest } from "../src/search_handler.js";

test("FTS cursor pages match a full ordered query, including score ties", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search (ITEM_SEQ TEXT, body TEXT);
      CREATE VIRTUAL TABLE unified_search_fts USING fts5(body);`);
    const row = db.prepare("INSERT INTO unified_search(rowid, ITEM_SEQ, body) VALUES (?, ?, ?)");
    const fts = db.prepare("INSERT INTO unified_search_fts(rowid, body) VALUES (?, ?)");
    for (let i = 1; i <= 180; i++) {
      const text = "aspirin ".repeat(i % 5 + 1) + "tablet ".repeat(i % 3 + 1);
      row.run(i, String(i), text);
      fts.run(i, text);
    }
    let calls = 0;
    const d1 = { prepare(sql) {
      return { bind(...params) {
        return { async all() { calls++; return { results: db.prepare(sql).all(...params) }; } };
      } };
    } };
    const expected = db.prepare(`SELECT rowid, rank FROM unified_search_fts
      WHERE unified_search_fts MATCH '"aspirin"*' ORDER BY rank, rowid`).all();
    const actual = [];
    let cursorData = null;
    let page;
    do {
      page = await searchUnified(d1, { keywords: ["aspirin"], canonicalQuery: "aspirin", limit: 7, cursorData });
      actual.push(...page.results);
      if (page.nextCursor) {
        cursorData = decodeAndValidateCursor(page.nextCursor, "aspirin", 7).data;
      }
    } while (page.hasMore);
    assert.deepEqual(actual, expected.map((row) => String(row.rowid)));
    assert.equal(new Set(actual).size, 180);

    const entries = new Map();
    const env = { D1: d1, UNIFIED_SEARCH_KV: {
      async get(key, type) {
        assert.equal(type, "text");
        return entries.get(key) ?? null;
      },
      async put(key, value, options) {
        assert.equal(options.expirationTtl, 2592000);
        entries.set(key, value);
      },
    } };
    const request = new Request("https://example.com/?keyword=aspirin&limit=50");
    const first = await handleSearchRequest(request, env);
    const before = calls;
    const second = await handleSearchRequest(request, env);
    assert.equal(calls, before);
    assert.equal(second.headers.get("X-Cache-Status"), "HIT (KV)");
    assert.equal(first.headers.get("Cache-Control"), "public, max-age=86400");
    assert.deepEqual(await first.json(), await second.json());

    // Malformed or falsy JSON used to be treated as a miss by KV's JSON reader.
    const cacheKey = [...entries.keys()][0];
    for (const corrupted of ["{broken", "null", "false", "0"]) {
      entries.set(cacheKey, corrupted);
      const beforeMiss = calls;
      const fallback = await handleSearchRequest(request, env);
      assert.equal(fallback.headers.get("X-Cache-Status"), "MISS");
      assert.equal(calls, beforeMiss + 1);
      assert.ok(Array.isArray((await fallback.json()).results));
    }
  } finally { db.close(); }
});
