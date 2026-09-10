import assert from "node:assert";
import validate from "../src/validation.js";
import { encodeCursor, decodeAndValidateCursor, SEARCH_VERSION } from "../src/cursor.js";
import { searchUnified } from "../src/unified_search.js";

async function runTests() {
  console.log("=== 1. Test validation & canonicalQuery ===");
  {
    const res = validate(["타이레놀"], 20);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.finalTokens, ["타이레놀"]);
    assert.strictEqual(res.canonicalQuery, "타이레놀");
  }

  {
    const res = validate(["아세트아미노펜", "이부프로펜"], 10);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.finalTokens, ["아세트아미노펜", "이부프로펜"]);
    assert.strictEqual(res.canonicalQuery, "아세트아미노펜 이부프로펜");
  }

  {
    // invalid limit
    const res = validate(["아세트아미노펜"], 0);
    assert.strictEqual(res.valid, false);
  }

  {
    // invalid limit over 50
    const res = validate(["아세트아미노펜"], 51);
    assert.strictEqual(res.valid, false);
  }

  console.log("=== 2. Test cursor encode/decode & validation ===");
  {
    const cursor = encodeCursor({
      canonicalQuery: "아세트아미노펜",
      limit: 20,
      score: -2.345,
      rowid: 123,
    });
    assert.ok(typeof cursor === "string");

    // valid verification
    const valRes = decodeAndValidateCursor(cursor, "아세트아미노펜", 20);
    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.data.score, -2.345);
    assert.strictEqual(valRes.data.rowid, 123);

    // query mismatch
    const mismatchQuery = decodeAndValidateCursor(cursor, "다른검색어", 20);
    assert.strictEqual(mismatchQuery.valid, false);

    // limit mismatch
    const mismatchLimit = decodeAndValidateCursor(cursor, "아세트아미노펜", 10);
    assert.strictEqual(mismatchLimit.valid, false);

    // corrupted cursor
    const corrupted = decodeAndValidateCursor("invalid_base64!!!", "아세트아미노펜", 20);
    assert.strictEqual(corrupted.valid, false);
  }

  console.log("=== 3. Test validate() with cursor ===");
  {
    const cursor = encodeCursor({
      canonicalQuery: "아세트아미노펜",
      limit: 20,
      score: -1.5,
      rowid: 42,
    });

    const res = validate(["아세트아미노펜"], 20, cursor);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.cursorData, { score: -1.5, rowid: 42 });

    const invalidRes = validate(["아세트아미노펜"], 20, "wrong_cursor");
    assert.strictEqual(invalidRes.valid, false);
  }

  console.log("=== 4. Test searchUnified (LIMIT + 1, pagination, tie-breaker) ===");
  {
    // Mock DB
    let executedSql = "";
    let executedParams = [];

    const mockDb = {
      prepare(sql) {
        executedSql = sql;
        return {
          bind(...params) {
            executedParams = params;
            return {
              async all() {
                // Return 4 items when limit is 3
                return {
                  results: [
                    { ITEM_SEQ: "1001", score: -5.0, row_id: 1 },
                    { ITEM_SEQ: "1002", score: -4.0, row_id: 2 },
                    { ITEM_SEQ: "1003", score: -3.0, row_id: 3 },
                    { ITEM_SEQ: "1004", score: -2.0, row_id: 4 },
                  ],
                };
              },
            };
          },
        };
      },
    };

    const result = await searchUnified(mockDb, {
      keywords: ["아세트아미노펜"],
      canonicalQuery: "아세트아미노펜",
      limit: 3,
    });

    assert.ok(executedSql.includes("LIMIT ?"));
    assert.ok(executedSql.includes("ORDER BY"));
    assert.ok(executedSql.includes("bm25(unified_search_fts) ASC,"));
    assert.ok(executedSql.includes("unified_search_fts.rowid ASC"));
    assert.strictEqual(executedParams[1], 4); // limit + 1 = 4
    assert.strictEqual(result.hasMore, true);
    assert.strictEqual(result.results.length, 3);
    assert.deepStrictEqual(result.results, ["1001", "1002", "1003"]);
    assert.ok(result.nextCursor);

    // Verify nextCursor
    const decodedNext = decodeAndValidateCursor(result.nextCursor, "아세트아미노펜", 3);
    assert.strictEqual(decodedNext.valid, true);
    assert.strictEqual(decodedNext.data.score, -3.0);
    assert.strictEqual(decodedNext.data.rowid, 3);
  }

  {
    // Mock DB with cursor second page
    let executedSql = "";
    let executedParams = [];

    const mockDb = {
      prepare(sql) {
        executedSql = sql;
        return {
          bind(...params) {
            executedParams = params;
            return {
              async all() {
                // Return 2 items when limit is 3 (no more)
                return {
                  results: [
                    { ITEM_SEQ: "1004", score: -2.0, row_id: 4 },
                    { ITEM_SEQ: "1005", score: -1.0, row_id: 5 },
                  ],
                };
              },
            };
          },
        };
      },
    };

    const result = await searchUnified(mockDb, {
      keywords: ["아세트아미노펜"],
      canonicalQuery: "아세트아미노펜",
      limit: 3,
      cursorData: { score: -3.0, rowid: 3 },
    });

    assert.ok(executedSql.includes("bm25(unified_search_fts) > ?"));
    assert.strictEqual(result.hasMore, false);
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.nextCursor, null);
    assert.deepStrictEqual(result.results, ["1004", "1005"]);
  }

  console.log("All unit tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
