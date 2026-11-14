import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { searchUnified } from "../src/unified_search.js";
import {
  decodeAndValidateCursor,
  encodeCursor,
  SEARCH_VERSION,
} from "../src/cursor.js";
import { handleSearchRequest } from "../src/search_handler.js";
import validate from "../src/validation.js";
import {
  getCacheKeyString,
  findCachedData,
  saveCacheData,
  KV_CACHE_TTL_SECONDS,
} from "../src/cache.js";

test("FTS cursor pages match a full ordered query, including score ties", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search_v2 (ITEM_SEQ TEXT, body TEXT);
      CREATE VIRTUAL TABLE unified_search_fts_v2 USING fts5(NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT);`);
    const row = db.prepare(
      "INSERT INTO unified_search_v2(rowid, ITEM_SEQ, body) VALUES (?, ?, ?)",
    );
    const fts = db.prepare(
      "INSERT INTO unified_search_fts_v2(rowid, INDICATION_TEXT) VALUES (?, ?)",
    );
    for (let i = 1; i <= 180; i++) {
      const text =
        "aspirin ".repeat((i % 5) + 1) + "tablet ".repeat((i % 3) + 1);
      row.run(i, String(i), text);
      fts.run(i, text);
    }
    let calls = 0;
    const d1 = {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async all() {
                calls++;
                return { results: db.prepare(sql).all(...params) };
              },
            };
          },
        };
      },
    };
    const expected = db
      .prepare(
        `SELECT rowid, rank FROM unified_search_fts_v2
      WHERE unified_search_fts_v2 MATCH '"aspirin"*' AND rank MATCH 'bm25(8.0, 5.0, 10.0, 2.0, 1.0)' ORDER BY rank, rowid`,
      )
      .all();
    const actual = [];
    let cursorData = null;
    let page;
    do {
      page = await searchUnified(d1, {
        keywords: ["aspirin"],
        canonicalQuery: "aspirin",
        limit: 7,
        cursorData,
      });
      actual.push(...page.results);
      if (page.nextCursor) {
        cursorData = decodeAndValidateCursor(
          page.nextCursor,
          "aspirin",
          7,
        ).data;
      }
    } while (page.hasMore);
    assert.deepEqual(
      actual,
      expected.map((row) => String(row.rowid)),
    );
    assert.equal(new Set(actual).size, 180);

    const entries = new Map();
    const env = {
      D1: d1,
      UNIFIED_SEARCH_KV: {
        async get(key, type) {
          assert.equal(type, "text");
          return entries.get(key) ?? null;
        },
        async put(key, value, options) {
          assert.equal(options.expirationTtl, 2592000);
          entries.set(key, value);
        },
      },
    };
    const request = new Request(
      "https://example.com/?keyword=aspirin&limit=50",
    );
    const first = await handleSearchRequest(request, env);
    const before = calls;
    const second = await handleSearchRequest(request, env);
    assert.equal(calls, before);
    assert.equal(second.headers.get("X-Cache-Status"), "HIT (KV)");
    assert.equal(first.headers.get("Cache-Control"), "private, max-age=86400");
    assert.deepEqual(await first.json(), await second.json());

    const equivalent = await handleSearchRequest(
      new Request("https://example.com/?keyword=ASPIRIN%20aspirin&limit=50"),
      env,
    );
    assert.equal(equivalent.headers.get("X-Cache-Status"), "HIT (KV)");
    assert.equal(calls, before, "equivalent input reuses the existing cache");

    // Malformed or falsy JSON used to be treated as a miss by KV's JSON reader.
    const cacheKey = [...entries.keys()][0];
    for (const corrupted of [
      "{broken",
      "null",
      "false",
      "0",
      "{}",
      "[]",
      JSON.stringify({
        savedAt: Date.now(),
        body: '{"results":"invalid","hasMore":false,"nextCursor":null}',
      }),
    ]) {
      entries.set(cacheKey, corrupted);
      const beforeMiss = calls;
      const fallback = await handleSearchRequest(request, env);
      assert.equal(fallback.headers.get("X-Cache-Status"), "MISS");
      assert.equal(calls, beforeMiss + 1);
      assert.ok(Array.isArray((await fallback.json()).results));
    }
  } finally {
    db.close();
  }
});

test("default search excludes usage/warning-only symptoms and retains product fields", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search_v2 (ITEM_SEQ TEXT, USAGE_TEXT TEXT, WARNING_TEXT TEXT);
      CREATE VIRTUAL TABLE unified_search_fts_v2 USING fts5(
        NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT);`);
    const source = db.prepare(
      "INSERT INTO unified_search_v2(rowid, ITEM_SEQ, USAGE_TEXT, WARNING_TEXT) VALUES (?, ?, ?, ?)",
    );
    const insert = db.prepare(
      "INSERT INTO unified_search_fts_v2(rowid, NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const rows = [
      ["효능제품", "성분가", "독감 콧물 완화", "AB12 흰색", "제조사가", "", ""],
      [
        "무관제품",
        "성분나",
        "별도효능",
        "CD34 노랑",
        "제조사나",
        "독감 콧물",
        "독감증후군 콧물 이상반응",
      ],
      ["콧물제품", "성분다", "별도효능", "EF56", "제조사다", "", ""],
      ["효능제품2", "성분라", "콧물", "GH78", "제조사라", "", ""],
    ];
    rows.forEach((row, index) => {
      source.run(index + 1, String(index + 1), row[5], row[6]);
      insert.run(index + 1, ...row.slice(0, 5));
    });
    const d1 = {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async all() {
                return { results: db.prepare(sql).all(...params) };
              },
            };
          },
        };
      },
    };
    const search = async (...keywords) =>
      (
        await searchUnified(d1, {
          keywords,
          canonicalQuery: keywords.join(" "),
        })
      ).results;
    assert.deepEqual(await search("독감"), ["1"]);
    assert.deepEqual(await search("독감", "콧물"), ["1"]);
    const symptoms = await search("콧물");
    assert.deepEqual(new Set(symptoms), new Set(["1", "3", "4"]));
    assert.ok(
      symptoms.indexOf("4") < symptoms.indexOf("3"),
      "indication weight exceeds equal-length product-name match",
    );
    assert.deepEqual(await search("성분나"), ["2"]);
    assert.deepEqual(await search("CD34"), ["2"]);
    assert.deepEqual(await search("제조사나"), ["2"]);
    assert.deepEqual(await search("무관제품"), ["2"]);
    const before = await search("콧물");
    db.prepare("UPDATE unified_search_v2 SET WARNING_TEXT = ?").run(
      "콧물 ".repeat(20000),
    );
    assert.deepEqual(await search("콧물"), before);
    assert.equal(SEARCH_VERSION, "v6");
    const oldCursor = Buffer.from(
      JSON.stringify({ v: "v5", q: "콧물", l: 7, b: -1, r: 1 }),
      "utf8",
    ).toString("base64");
    assert.equal(decodeAndValidateCursor(oldCursor, "콧물", 7).valid, false);
  } finally {
    db.close();
  }
});

test("query normalization retains symptoms and removes search labels across keyword parameters", () => {
  for (const keyword of ["통증", "염증", "감염"]) {
    assert.deepEqual(validate([keyword], 50).finalTokens, [keyword]);
  }
  const query = validate(["아세트아미노펜 성분", "효능"], 50);
  assert.equal(query.valid, true);
  assert.deepEqual(query.finalTokens, ["아세트아미노펜"]);
  assert.deepEqual(validate(["AB-12 0.5mg"], 50).finalTokens, [
    "0",
    "12",
    "5mg",
    "ab",
  ]);
  assert.equal(
    validate(["콧물 두통", "콧물"], 50).canonicalQuery,
    validate(["두통", "콧물"], 50).canonicalQuery,
  );
  assert.equal(validate(["성분", "효능"], 50).valid, false);
  assert.equal(validate(["% - /"], 50).valid, false);
  assert.equal(
    validate(["%ED%86%B5%EC%A6%9D"], 50).valid,
    false,
    "do not decode a second time",
  );
  assert.equal(validate(["가나 다라 마바", "사아 자차 카타"], 50).valid, false);
  assert.equal(
    validate(["아세트아미노펜 정"], 50).finalTokens.includes("정"),
    true,
    "dosage forms remain constraints",
  );
});

test("invalid limits and excessive cursors are rejected before touching storage", async () => {
  const env = {
    D1: {
      prepare() {
        assert.fail("invalid request queried D1");
      },
    },
    UNIFIED_SEARCH_KV: {
      get() {
        assert.fail("invalid request read KV");
      },
    },
  };
  for (const limit of [
    "49",
    "501",
    "1000000000",
    "50junk",
    "50.9",
    "5e2",
    "",
    "Infinity",
  ]) {
    const response = await handleSearchRequest(
      new Request(`https://example.com/?keyword=통증&limit=${limit}`),
      env,
    );
    assert.equal(response.status, 400, limit);
  }
  assert.equal(validate(["통증"], 500).valid, true);
  const response = await handleSearchRequest(
    new Request(`https://example.com/?keyword=통증&cursor=${"a".repeat(2049)}`),
    env,
  );
  assert.equal(response.status, 400);
});

test("normalized Korean queries work with external-content FTS and retain prefix semantics", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE unified_search_v2 (
      rowid INTEGER PRIMARY KEY, ITEM_SEQ TEXT NOT NULL UNIQUE,
      NAME_TEXT TEXT, INGREDIENT_TEXT TEXT, INDICATION_TEXT TEXT, APPEARANCE_TEXT TEXT, COMPANY_TEXT TEXT);
      CREATE VIRTUAL TABLE unified_search_fts_v2 USING fts5(
        NAME_TEXT, INGREDIENT_TEXT, INDICATION_TEXT, APPEARANCE_TEXT, COMPANY_TEXT,
        content='unified_search_v2', content_rowid='rowid', tokenize='unicode61 remove_diacritics 0');`);
    const insert = db.prepare(
      "INSERT INTO unified_search_v2 VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      1,
      "1",
      "타이레놀정",
      "아세트아미노펜",
      "통증 발열",
      "AB 12",
      "제조원",
    );
    insert.run(
      2,
      "2",
      "어린이타이레놀",
      "아세트아미노펜",
      "발열",
      "CD34",
      "제조원",
    );
    insert.run(3, "3", "다른제품", "성분나", "염증 감염", "AB12", "제조원");
    db.exec(
      "INSERT INTO unified_search_fts_v2(unified_search_fts_v2) VALUES ('rebuild')",
    );
    const env = {
      D1: {
        prepare(sql) {
          return {
            bind(...params) {
              return {
                async all() {
                  return { results: db.prepare(sql).all(...params) };
                },
              };
            },
          };
        },
      },
    };
    const search = async (...keywords) => {
      const url = new URL("https://example.com/");
      keywords.forEach((keyword) =>
        url.searchParams.append("keyword", keyword),
      );
      const response = await handleSearchRequest(new Request(url), env);
      assert.equal(response.status, 200);
      return (await response.json()).results;
    };
    assert.deepEqual(
      new Set(await search("아세트아미노펜 성분")),
      new Set(["1", "2"]),
    );
    assert.deepEqual(await search("성분", "아세트아미노펜", "통증 약"), ["1"]);
    assert.deepEqual(await search("염증"), ["3"]);
    assert.deepEqual(await search("감염"), ["3"]);
    assert.deepEqual(await search("AB-12"), ["1"]);
    assert.deepEqual(
      await search("타이레놀"),
      ["1"],
      "substring matching requires a different search strategy",
    );
  } finally {
    db.close();
  }
});

test("cache lifetime is bounded and response max-age respects the remaining lifetime", async (t) => {
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const values = new Map();
  const env = {
    KV: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async put(key, value, options) {
        assert.equal(options.expirationTtl, KV_CACHE_TTL_SECONDS);
        values.set(key, value);
      },
    },
  };
  const body = JSON.stringify({
    results: ["1"],
    nextCursor: null,
    hasMore: false,
  });
  const key = await getCacheKeyString("통증", 50, null);
  await saveCacheData(key, body, env);
  assert.equal((await findCachedData(key, env)).data, body);
  now += (KV_CACHE_TTL_SECONDS - 10) * 1000;
  assert.equal((await findCachedData(key, env)).maxAge, 10);
  now += 10000;
  assert.equal(
    (await findCachedData(key, env)).data,
    null,
    "reject stale KV even if KV returns it",
  );
  now -= (KV_CACHE_TTL_SECONDS + 1) * 1000;
  assert.equal(
    (await findCachedData(key, env)).data,
    null,
    "reject future timestamps",
  );
  const longKey = await getCacheKeyString(
    "가".repeat(250),
    500,
    "커서".repeat(500),
  );
  assert.ok(new TextEncoder().encode(longKey).length < 512);
  assert.notEqual(key, await getCacheKeyString("통증", 50, null, "new-data"));
});

test("data version changes invalidate cached responses and old pagination cursors", async () => {
  const values = new Map();
  let calls = 0;
  const env = {
    SEARCH_DATA_VERSION: "batch-1",
    D1: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                calls++;
                return {
                  results: Array.from({ length: 51 }, (_, index) => ({
                    ITEM_SEQ: String(index + 1),
                    row_id: index + 1,
                    score: -1,
                  })),
                };
              },
            };
          },
        };
      },
    },
    KV: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async put(key, value) {
        values.set(key, value);
      },
    },
  };
  const request = new Request("https://example.com/?keyword=통증&limit=50");
  const first = await handleSearchRequest(request, env);
  const { nextCursor } = await first.json();
  assert.equal(
    (await handleSearchRequest(request, env)).headers.get("X-Cache-Status"),
    "HIT (KV)",
  );
  assert.equal(calls, 1);
  env.SEARCH_DATA_VERSION = "batch-2";
  assert.equal(
    (await handleSearchRequest(request, env)).headers.get("X-Cache-Status"),
    "MISS",
  );
  assert.equal(calls, 2);
  const oldPage = new URL(request.url);
  oldPage.searchParams.set("cursor", nextCursor);
  assert.equal(
    (await handleSearchRequest(new Request(oldPage), env)).status,
    400,
  );
  assert.equal(calls, 2);
});

test("cursor validation rejects nonfinite scores and invalid rowids", () => {
  const cursor = encodeCursor({
    canonicalQuery: "통증",
    limit: 50,
    score: -1,
    rowid: 1,
  });
  assert.equal(decodeAndValidateCursor(cursor, "통증", 50).valid, true);
  const payload = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  for (const rowid of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    const invalid = Buffer.from(
      JSON.stringify({ ...payload, r: rowid }),
    ).toString("base64");
    assert.equal(decodeAndValidateCursor(invalid, "통증", 50).valid, false);
  }
  const invalid = Buffer.from(
    JSON.stringify(payload).replace('"b":-1', '"b":1e999'),
  ).toString("base64");
  assert.equal(decodeAndValidateCursor(invalid, "통증", 50).valid, false);
});
