const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const { base, load } = require("../changes/validate-search-v2.cjs");
const v2 = load("src/services/unified_search/v2.ts");
const root = "src/services/unified_search/";
const mock = (relative) => path.resolve(base, relative);
const logger = { debug() {}, info() {}, error() {} };
const pill = {
  ITEM_SEQ: "1", ITEM_NAME: "이름 이름", MATERIAL_NAME: "성분", MATERIAL_ENG_NAME: "ingredient",
  CHART: "모양", PRINT_FRONT: "AB12", PRINT_BACK: "", DRUG_SHAPE: "원형",
  COLOR_CLASS1: "흰색", COLOR_CLASS2: "", ENTP_NAME: "제조사", ENTP_ENG_NAME: "company",
};
const record = (overrides = {}) => ({ ITEM_SEQ: "1", CONTENTS: "legacy text",
  ...v2.buildMetadata(pill), INDICATION_TEXT: "독감 콧물", USAGE_TEXT: "복용법", WARNING_TEXT: "주의사항",
  ...overrides,
});

test("actual deployer schema/upsert synchronizes both indexes and preserves failed documents", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE unified_search (ITEM_SEQ TEXT UNIQUE, CONTENTS TEXT)");
    db.exec(v2.SCHEMA_V2);
    db.exec(v2.SCHEMA_V2); // additive/idempotent
    db.exec(v2.buildUpsertSql([record({ NAME_TEXT: "O'Reilly 이름 이름" })]));
    assert.equal(db.prepare("SELECT NAME_TEXT FROM unified_search_v2").get().NAME_TEXT, "O'Reilly 이름 이름");
    const match = (table, text) => db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`).all(text);
    assert.equal(match("unified_search_fts_v2", "콧물").length, 1);
    db.exec(v2.buildUpsertSql([record({ INDICATION_TEXT: null, USAGE_TEXT: null, WARNING_TEXT: null, CONTENTS: "incomplete" })]));
    assert.equal(db.prepare("SELECT INDICATION_TEXT FROM unified_search_v2").get().INDICATION_TEXT, "독감 콧물");
    assert.equal(db.prepare("SELECT CONTENTS FROM unified_search").get().CONTENTS, "legacy text");
    assert.equal(match("unified_search_fts_v2", "콧물").length, 1);
    db.exec(v2.buildUpsertSql([record({ INDICATION_TEXT: "", USAGE_TEXT: "새복용법", WARNING_TEXT: "독감증후군 콧물" })]));
    assert.equal(match("unified_search_fts_v2", "콧물").length, 0);
    assert.equal(match("unified_search_docs_fts_v2", "콧물").length, 1);
    for (const table of ["unified_search_fts_v2", "unified_search_docs_fts_v2"]) {
      db.exec(`INSERT INTO ${table}(${table}, rank) VALUES ('integrity-check', 1)`);
    }
    db.exec("DELETE FROM unified_search_v2");
    assert.equal(match("unified_search_docs_fts_v2", "콧물").length, 0);
    for (const table of ["unified_search_fts_v2", "unified_search_docs_fts_v2"]) {
      db.exec(`INSERT INTO ${table}(${table}, rank) VALUES ('integrity-check', 1)`);
    }
    assert.throws(() => v2.buildUpsertSql([{ ITEM_SEQ: "1", CONTENTS: "old" }]), /Legacy/);
    assert.equal(v2.buildMetadata(pill).NAME_TEXT, "이름 이름");
  } finally { db.close(); }
});

test("document fetch distinguishes failure, valid empty and raw efficacy cache", async () => {
  const requested = [];
  const docs = load(root + "documents.ts", {
    axios: { async get(url) {
      requested.push(url);
      if (url.endsWith("/NB")) throw new Error("network error");
      return { data: "" };
    } },
    [mock("src/utils/logger.ts")]: logger,
    [mock("src/utils/item_processing.ts")]: { async tryAsyncItem(fn) { try { return await fn(); } catch { return undefined; } } },
    [mock("src/services/pill_data/effect_summary/storage.ts")]: {
      async readEffectDocument() { return '<DOC><ARTICLE title="독감"><![CDATA[콧물 콧물]]></ARTICLE></DOC>'; },
    },
  });
  const result = await docs.getDocData("1");
  assert.equal(result.EE_DOC_DATA, "독감 콧물 콧물");
  assert.equal(result.UD_DOC_DATA, "");
  assert.equal(result.NB_DOC_DATA, null);
  assert.equal(requested.length, 2);
});

test("incomplete documents are saved for retry and make the update fail visibly", async () => {
  const stored = [], failed = [];
  const batches = load(root + "batches.ts", {
    [mock("src/utils/logger.ts")]: logger,
    [mock(root + "documents.ts")]: { async getDocData() { return { EE_DOC_DATA: null, UD_DOC_DATA: "", NB_DOC_DATA: "" }; } },
    [mock(root + "repository.ts")]: { async upsert(records) { stored.push(...records); } },
    [mock(root + "failed_records.ts")]: { async writeFailedData(value) { failed.push(value); } },
  });
  await assert.rejects(batches.upsertAll([pill]), /incomplete/);
  assert.equal(stored.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(stored[0].INDICATION_TEXT, null);
  assert.equal(stored[0].NAME_TEXT, "이름 이름");
});

test("legacy failed records are regenerated; partial fetch keeps the retry file", async () => {
  for (const incomplete of [false, true]) {
    let removed = 0, rebuilt = 0;
    const stored = [];
    const retry = load("src/services/unified_search_insert_failed/index.ts", {
      [mock("src/utils/logger.ts")]: logger,
      [mock(root + "repository.ts")]: { async upsert(records) { stored.push(...records); } },
      [mock(root + "batches.ts")]: { async createSearchRecord() {
        rebuilt++; return record({ INDICATION_TEXT: incomplete ? null : "독감" });
      } },
      [mock(root + "pill_resource.ts")]: { async readPillDataResource() { return [pill]; } },
      [mock(root + "failed_records.ts")]: {
        async listFailedDataFiles() { return ["1.json"]; },
        async readFailedData() { return { ITEM_SEQ: "1", CONTENTS: "old mixed document" }; },
        async removeFailedData() { removed++; },
      },
    });
    if (incomplete) await assert.rejects(retry.upsertFailedRetryAll(), /incomplete/);
    else await retry.upsertFailedRetryAll();
    assert.equal(rebuilt, 1);
    assert.equal(stored.length, 1);
    assert.equal(removed, incomplete ? 0 : 1);
  }
});

test("document fetching is bounded to three pills and DB batches retain order", async () => {
  let active = 0, peak = 0;
  const stored = [];
  const batches = load(root + "batches.ts", {
    [mock("src/utils/logger.ts")]: logger,
    [mock(root + "documents.ts")]: { async getDocData() {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return { EE_DOC_DATA: "효능", UD_DOC_DATA: "", NB_DOC_DATA: "" };
    } },
    [mock(root + "repository.ts")]: { async upsert(records) { stored.push(records); } },
    [mock(root + "failed_records.ts")]: { async writeFailedData() { assert.fail("unexpected retry"); } },
  });
  await batches.upsertAll(Array.from({ length: 6 }, (_, i) => ({ ...pill, ITEM_SEQ: String(i + 1) })));
  assert.equal(peak, 3);
  assert.deepEqual(stored.map((batch) => batch.length), [5, 1]);
  assert.deepEqual(stored.flat().map((item) => item.ITEM_SEQ), ["1", "2", "3", "4", "5", "6"]);
});
