const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const zlib = require("node:zlib");
const base = path.resolve(__dirname, "../src/google_cloud_platform");

// Exercise handlers without cloud credentials or installed framework dependencies.
function loadWithMocks(filename, mocks) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const localRequire = Module.createRequire(filename);
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name);
  mod._compile(fs.readFileSync(filename, "utf8"), filename);
  return mod.exports;
}

function response() {
  return {
    headers: {}, code: 200,
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; },
    type() { return this; },
    vary(value) { this.headers.Vary = value; return this; },
    send(body) { this.body = body; return this; },
    sendStatus(code) { this.code = code; return this; },
    end() { return this; },
    json(body) { this.body = JSON.stringify(body); return this; },
  };
}

function loadHandler(service, extraMocks = {}) {
  let handler;
  const app = { use() {}, get(url, fn) { handler = fn; }, post(url, fn) { handler = fn; } };
  loadWithMocks(path.join(base, service, "index.js"), {
    dotenv: { config() {} },
    express: () => app,
    compression: () => () => {},
    "@google-cloud/functions-framework": { http() {} },
    "./authentication": { authenticate: () => true },
    ...extraMocks,
  });
  return async (req) => {
    const res = response();
    await handler(req, res, (error) => { throw error; });
    return res;
  };
}

for (const service of ["wip-pill-detail", "wip-pill-image-feature-extraction"]) {
  test(`${service}: one-day cache, concurrent deduplication, expiry and failure retry`, async () => {
    const { createResponseCache } = require(path.join(base, service, "cache.js"));
    let clock = 0;
    let loads = 0;
    const cache = createResponseCache({ now: () => clock, maxEntries: 2, maxBytes: 100 });
    const load = async () => { loads++; return { body: '{"ok":true}' }; };
    await Promise.all([cache.getOrLoad("one", load), cache.getOrLoad("one", load)]);
    assert.equal(loads, 1);
    clock = 86399000;
    assert.equal((await cache.getOrLoad("one", load)).hit, true);
    clock = 86400000;
    assert.equal((await cache.getOrLoad("one", load)).hit, false);
    assert.equal(loads, 2);
    await assert.rejects(cache.getOrLoad("error", async () => { throw new Error("failed"); }));
    await cache.getOrLoad("error", load);
    await cache.getOrLoad("degraded", async () => ({ body: "offline", cacheable: false }));
    assert.equal((await cache.getOrLoad("degraded", load)).hit, false);
    await cache.getOrLoad("large", async () => ({ body: "x".repeat(101) }));
    assert.equal((await cache.getOrLoad("large", load)).hit, false);
  });
}

test("pill detail fallback requests run together; errors and invalid IDs are not cached", async () => {
  let upstream = 0;
  const fallback = [];
  const handler = loadHandler("wip-pill-detail", {
    axios: {
      create: () => ({ async get(url) {
        upstream++;
        if (!url.includes("nedrug.mfds.go.kr")) throw Object.assign(new Error("upstream down"), { upstream: true });
        return new Promise((resolve) => {
          fallback.push(() => resolve({ data: url.split("/").pop() }));
          if (fallback.length === 3) fallback.forEach((finish) => finish());
        });
      } }),
      isAxiosError: (error) => error.upstream,
    },
  });
  const req = { query: { ITEM_SEQ: "123456789" }, headers: {} };
  const first = await handler(req);
  assert.equal(first.headers["Cache-Control"], "private, max-age=86400");
  assert.deepEqual(JSON.parse(first.body), { EE_DOC_DATA: "EE", UD_DOC_DATA: "UD", NB_DOC_DATA: "NB" });
  const second = await handler(req);
  assert.equal(second.headers["X-Cache-Status"], "HIT");
  assert.equal(upstream, 4);
  assert.equal((await handler({ query: { ITEM_SEQ: "123&other=1" } })).code, 400);

  let failures = 0;
  const degraded = loadHandler("wip-pill-detail", { axios: {
    create: () => ({ async get() { failures++; throw new Error("offline"); } }),
    isAxiosError: () => true,
  } });
  assert.equal((await degraded(req)).headers["Cache-Control"], "no-store");
  await degraded(req);
  assert.equal(failures, 8);
});

test("image cache identifies bytes, sides and model; only repeated images reuse Gemini", async () => {
  const { prepareImages } = require(path.join(base, "wip-pill-image-feature-extraction/image.js"));
  const front = fs.readFileSync(path.join(base, "wip-pill-image-feature-extraction/test/pill_test.jpg"));
  const back = fs.readFileSync(path.join(base, "wip-pill-image-feature-extraction/test/pill_test2.jpg"));
  const body = { front: front.toString("base64"), back: back.toString("base64") };
  const first = prepareImages(body, "model-a");
  const equivalent = { ...body, front: "data:image/jpeg;base64," + body.front.match(/.{1,80}/g).join("\n") };
  assert.equal(prepareImages(equivalent, "model-a").key, first.key);
  assert.notEqual(prepareImages({ front: body.back, back: body.front }, "model-a").key, first.key);
  assert.notEqual(prepareImages(body, "model-b").key, first.key);
  assert.notEqual(prepareImages({ front: body.front }, "model-a").key, first.key);
  assert.throws(() => prepareImages({ front: "not base64!" }, "model-a"));
  assert.throws(() => prepareImages({}, "model-a"));

  let requests = 0;
  const handler = loadHandler("wip-pill-image-feature-extraction", { "./gemini": {
    async requestDetectImageGemini(images) {
      requests++;
      assert.equal(images.front.mimeType, "image/jpeg");
      return '{"PRINT_FRONT":"A","PRINT_BACK":"B","SHAPE":[],"COLOR":[]}';
    },
  } });
  const req = { body, headers: { apiversion: "2" } };
  const res = await handler(req);
  assert.equal(res.headers["Cache-Control"], "private, max-age=86400");
  assert.equal((await handler(req)).headers["X-Cache-Status"], "HIT");
  await handler({ ...req, body: { front: body.back, back: body.front } });
  assert.equal(requests, 2);
  assert.equal((await handler({ ...req, body: {} })).code, 400);
});

test("resource downloads coalesce, page serialization is reused, TTL refreshes data", async () => {
  const { createResourceStore } = require(path.join(base, "wip-resource-data/resources.js"));
  let clock = 0;
  let downloads = 0;
  let values = [1, 2, 3];
  const storage = { bucket: () => ({ file: () => ({ async download() {
    downloads++;
    await Promise.resolve();
    return [Buffer.from(JSON.stringify({ resources: values }))];
  } }) }) };
  const store = createResourceStore(storage, { now: () => clock });
  const [one, two] = await Promise.all([store.getResponse("pill_data", 1, 2), store.getResponse("pill_data", 1, 2)]);
  assert.equal(downloads, 1);
  assert.equal(one, two);
  assert.deepEqual(JSON.parse(one.body), { resource: [1, 2], total: 3, totalPage: 2, current: 0 });
  assert.deepEqual(JSON.parse((await store.getResponse("pill_data", 2, 2)).body).resource, [3]);
  clock = 300000;
  values = [4];
  assert.deepEqual(JSON.parse((await store.getResponse("pill_data", 1, 2)).body).resource, [4]);
  assert.equal(downloads, 2);
});

test("resource handler preserves legacy pagination and storage failure responses", async () => {
  const handler = loadHandler("wip-resource-data", { "@google-cloud/storage": { Storage: class {
    bucket() { return { file: () => ({ download: async () => [Buffer.from('{"resources":[1,2,3]}')] }) }; }
  } } });
  for (const [page, limit, expected] of [
    ["0", "0", [1, 2, 3]], ["-1", "-1", [1]], ["1", "2", [1, 2]], ["2", "2", [3]],
  ]) {
    const res = await handler({ query: { table: "pill_data", page, limit }, acceptsEncodings: () => "identity" });
    assert.equal(res.code, 200);
    assert.deepEqual(JSON.parse(res.body).resource, expected);
  }
  const failed = loadHandler("wip-resource-data", { "@google-cloud/storage": { Storage: class {
    bucket() { return { file: () => ({ download: async () => { throw new Error("test storage failure"); } }) }; }
  } } });
  const error = await failed({ query: { table: "pill_data", page: "1" } });
  assert.equal(error.code, 500);
  assert.equal(error.body, "Failed to load resource data");
});

for (const service of ["wip-resource-data", "wip-table-schema"]) {
  test(`${service}: reusable Brotli/gzip/deflate, unchanged JSON and conditional responses`, async (t) => {
    const { createJsonResponse, sendJsonResponse } = require(path.join(base, service, "response.js"));
    const data = { columns: require(path.join(base, "wip-table-schema/schemas/pill_data.json")).columns };
    const cached = createJsonResponse(data);
    for (const [encoding, decode] of [["br", zlib.brotliDecompressSync], ["gzip", zlib.gunzipSync], ["deflate", zlib.inflateSync]]) {
      assert.equal(cached.getEncoded(encoding), cached.getEncoded(encoding));
      const compressed = await cached.getEncoded(encoding);
      assert.deepEqual(JSON.parse(decode(compressed)), data);
      assert.ok(compressed.length < cached.body.length);
      const res = response();
      await sendJsonResponse({ acceptsEncodings: (...values) => values.includes(encoding) ? encoding : false }, res, cached);
      assert.equal(res.headers["Content-Encoding"], encoding);
      assert.equal(res.headers.Vary, "Accept-Encoding");
      assert.deepEqual(res.body, compressed);
      t.diagnostic(`${encoding}: ${cached.body.length} -> ${compressed.length} bytes`);
    }
    const identity = response();
    await sendJsonResponse({ acceptsEncodings: () => "identity" }, identity, cached);
    assert.deepEqual(identity.body, cached.body);
    assert.equal(identity.headers["Content-Encoding"], undefined);
    const rejected = response();
    await sendJsonResponse({ acceptsEncodings: () => false }, rejected, cached);
    assert.equal(rejected.code, 406);
    const fresh = response();
    await sendJsonResponse({ acceptsEncodings: () => "br", fresh: true }, fresh, cached);
    assert.equal(fresh.code, 304);
    assert.equal(fresh.body, undefined);
  });
}

for (const service of [
  "wip-database-version", "wip-external-url", "wip-log", "wip-pill-detail",
  "wip-pill-image-feature-extraction", "wip-resource-data", "wip-table-schema",
]) {
  test(`${service}: reuse parsed RSA key; invalid credentials fail without throwing`, (t) => {
    let reads = 0;
    let parses = 0;
    const issuedAt = 1800000000000;
    let now = issuedAt;
    t.mock.method(Date, "now", () => now);
    const date = (ms) => ({
      isValid: () => Number.isFinite(ms), valueOf: () => ms,
      add: (minutes) => date(ms + minutes * 60000),
      isBefore: (other) => ms < other.valueOf(),
    });
    const dayjs = { extend() {}, utc: (value) => date(value === undefined ? Date.now() : Date.parse(value)) };
    const auth = loadWithMocks(path.join(base, service, "authentication.js"), {
      dayjs, "dayjs/plugin/utc": {},
      fs: { readFileSync() { reads++; return "test key"; } },
      "node-rsa": class {
        constructor() { parses++; }
        decrypt(token) {
          if (token === "bad") throw new Error("invalid");
          if (token === "invalid-date") return "not a date";
          if (token === "future") return new Date(issuedAt + 30001).toISOString();
          if (token === "clock-skew") return new Date(issuedAt + 30000).toISOString();
          return new Date(issuedAt).toISOString();
        }
      },
    });
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.equal(auth.authenticate({ headers: {} }), false);
      assert.equal(auth.authenticate({ headers: { authorization: ["Bearer valid"] } }), false);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer " } }), false);
      assert.equal(reads, 0);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer valid" } }), true);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer valid" } }), true);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer bad" } }), false);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer invalid-date" } }), false);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer future" } }), false);
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer clock-skew" } }), true);
      now += 600000;
      assert.equal(auth.authenticate({ headers: { authorization: "Bearer valid" } }), false);
      assert.equal(reads, 1);
      assert.equal(parses, 1);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
    }
  });
}

test("image authentication remains required when NODE_ENV is missing or development", () => {
  const { authenticate } = loadWithMocks(path.join(base, "wip-pill-image-feature-extraction/authentication.js"), {
    dayjs: { extend() {} }, "dayjs/plugin/utc": {},
    fs: { readFileSync() { throw new Error("missing credentials must not read a key"); } },
    "node-rsa": class {},
  });
  const previousEnv = process.env.NODE_ENV;
  try {
    for (const env of [undefined, "development", "test", "production"]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      assert.equal(authenticate({ headers: {} }), false);
    }
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
