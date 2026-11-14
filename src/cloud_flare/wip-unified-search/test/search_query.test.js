import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { searchUnified } from "../src/unified_search.js";
import { decodeAndValidateCursor, SEARCH_VERSION } from "../src/cursor.js";
import { handleSearchRequest } from "../src/search_handler.js";

test("FTS cursor pages match a full ordered query, including score ties", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search_v2 (ITEM_SEQ TEXT, body TEXT);
      CREATE VIRTUAL TABLE unified_search_fts_v2 USING fts5(NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT);`);
    const row = db.prepare("INSERT INTO unified_search_v2(rowid, ITEM_SEQ, body) VALUES (?, ?, ?)");
    const fts = db.prepare("INSERT INTO unified_search_fts_v2(rowid, INDICATION_TEXT) VALUES (?, ?)");
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
    const expected = db.prepare(`SELECT rowid, rank FROM unified_search_fts_v2
      WHERE unified_search_fts_v2 MATCH '"aspirin"*' AND rank MATCH 'bm25(8.0, 5.0, 10.0, 2.0, 1.0)' ORDER BY rank, rowid`).all();
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

test("default search excludes usage/warning-only symptoms and retains product fields", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search_v2 (ITEM_SEQ TEXT, USAGE_TEXT TEXT, WARNING_TEXT TEXT);
      CREATE VIRTUAL TABLE unified_search_fts_v2 USING fts5(
        NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT);`);
    const source = db.prepare("INSERT INTO unified_search_v2(rowid, ITEM_SEQ, USAGE_TEXT, WARNING_TEXT) VALUES (?, ?, ?, ?)");
    const insert = db.prepare("INSERT INTO unified_search_fts_v2(rowid, NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT) VALUES (?, ?, ?, ?, ?, ?)");
    const rows = [
      ["효능제품", "성분가", "독감 콧물 완화", "AB12 흰색", "제조사가", "", ""],
      ["무관제품", "성분나", "별도효능", "CD34 노랑", "제조사나", "독감 콧물", "독감증후군 콧물 이상반응"],
      ["콧물제품", "성분다", "별도효능", "EF56", "제조사다", "", ""],
      ["효능제품2", "성분라", "콧물", "GH78", "제조사라", "", ""],
    ];
    rows.forEach((row, index) => {
      source.run(index + 1, String(index + 1), row[5], row[6]);
      insert.run(index + 1, ...row.slice(0, 5));
    });
    const d1 = { prepare(sql) { return { bind(...params) { return {
      async all() { return { results: db.prepare(sql).all(...params) }; },
    }; } }; } };
    const search = async (...keywords) => (await searchUnified(d1, {
      keywords, canonicalQuery: keywords.join(" "),
    })).results;
    assert.deepEqual(await search("독감"), ["1"]);
    assert.deepEqual(await search("독감", "콧물"), ["1"]);
    const symptoms = await search("콧물");
    assert.deepEqual(new Set(symptoms), new Set(["1", "3", "4"]));
    assert.ok(symptoms.indexOf("4") < symptoms.indexOf("3"), "indication weight exceeds equal-length product-name match");
    assert.deepEqual(await search("성분나"), ["2"]);
    assert.deepEqual(await search("CD34"), ["2"]);
    assert.deepEqual(await search("제조사나"), ["2"]);
    assert.deepEqual(await search("무관제품"), ["2"]);
    const before = await search("콧물");
    db.prepare("UPDATE unified_search_v2 SET WARNING_TEXT = ?").run("콧물 ".repeat(20000));
    assert.deepEqual(await search("콧물"), before);
    assert.equal(SEARCH_VERSION, "v5");
    const oldCursor = Buffer.from(JSON.stringify({ v: "v4", q: "콧물", l: 7, b: -1, r: 1 }), "utf8").toString("base64");
    assert.equal(decodeAndValidateCursor(oldCursor, "콧물", 7).valid, false);
  } finally { db.close(); }
});
