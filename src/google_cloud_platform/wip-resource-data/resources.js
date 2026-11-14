const { createHash } = require("node:crypto");
const { createJsonResponse, createStoredResponse } = require("./response");
const { validateManifest } = require("./manifest");

const CACHE_TTL_MS = 5 * 60 * 1000;

function createResourceStore(storage, {
  now = Date.now,
  manifestPath = "resource-pages/latest.json",
  maxResourceBytes = 64 * 1024 * 1024,
  maxResponseBytes = 16 * 1024 * 1024,
} = {}) {
  const resources = new Map();
  const responses = new Map();
  const pending = new Map();
  const pendingResponses = new Map();
  let resourceBytes = 0;
  let responseBytes = 0;
  let manifestTask;

  function removeResource(key) {
    resourceBytes -= resources.get(key).size;
    resources.delete(key);
  }
  function removeResponse(key) {
    responseBytes -= responses.get(key).size;
    responses.delete(key);
  }
  function trimResponses() {
    while (responses.size > 32 || responseBytes > maxResponseBytes) {
      removeResponse(responses.keys().next().value);
    }
  }
  function resized(key) {
    const cached = responses.get(key);
    if (!cached) return;
    responseBytes += cached.response.size - cached.size;
    cached.size = cached.response.size;
    trimResponses();
  }

  async function readManifest() {
    if (!manifestPath) return null;
    if (!manifestTask) {
      manifestTask = storage.bucket("wip-bucket").file(manifestPath).download({ decompress: false })
        .then(([contents]) => {
          const hash = createHash("sha256").update(contents).digest("hex");
          return { hash, data: validateManifest(JSON.parse(contents.toString("utf8"))) };
        })
        .catch((error) => {
          if (Number(error.code) === 404) return null;
          throw error;
        })
        .finally(() => { manifestTask = undefined; });
    }
    return manifestTask;
  }

  async function load(table, generation) {
    const key = `${table}:${generation}`;
    const cached = resources.get(key);
    if (cached && cached.expiresAt > now()) {
      resources.delete(key);
      resources.set(key, cached);
      return cached;
    }
    if (cached) removeResource(key);
    if (pending.has(key)) return pending.get(key);

    const task = (async () => {
      const [contents] = await storage.bucket("wip-bucket")
        .file(`${table}.json`, { generation }).download();
      const data = JSON.parse(contents.toString("utf8"));
      if (!Array.isArray(data.resources)) throw new Error("Invalid resource data");
      const entry = { resources: data.resources, size: contents.length * 2,
        expiresAt: now() + CACHE_TTL_MS };
      if (entry.size <= maxResourceBytes) {
        while (resources.size >= 10 || resourceBytes + entry.size > maxResourceBytes) {
          removeResource(resources.keys().next().value);
        }
        resources.set(key, entry);
        resourceBytes += entry.size;
      }
      return entry;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  async function buildResponse(table, page, limit, key, source) {
    const manifest = source.manifest?.data;
    const tableEntry = manifest && Object.hasOwn(manifest.tables, table) ? manifest.tables[table] : undefined;
    const pages = tableEntry?.pages[limit];
    if (pages) {
      const prepared = pages[page - 1];
      const response = prepared ? createStoredResponse(prepared, async (encoding) => {
        const file = prepared.files[encoding];
        // Avoid GCS automatically decompressing the prebuilt response.
        const [body] = await storage.bucket("wip-bucket").file(file.path).download({ decompress: false });
        if (body.length !== file.bytes || createHash("sha256").update(body).digest("hex") !== file.sha256) {
          throw new Error("Resource page checksum mismatch");
        }
        return body;
      }, () => resized(key)) : createJsonResponse({
        resource: [], total: tableEntry.total, totalPage: pages.length, current: (page - 1) * limit,
      }, { onSizeChange: () => resized(key) });
      return { response, expiresAt: Infinity };
    }

    if (tableEntry) {
      // Preserve arbitrary page sizes using the same immutable snapshot.
      const baseLimit = Number(Object.keys(tableEntry.pages)[0]);
      const current = (page - 1) * limit;
      const end = Math.min(current + limit, tableEntry.total);
      const resource = [];
      for (let offset = current; offset < end;) {
        const basePage = Math.floor(offset / baseLimit) + 1;
        const baseResponse = await getSnapshotResponse(table, basePage, baseLimit, source);
        const data = JSON.parse((await baseResponse.getEncoded("identity")).toString("utf8"));
        const start = offset % baseLimit;
        const count = Math.min(baseLimit - start, end - offset);
        for (const row of data.resource.slice(start, start + count)) resource.push(row);
        offset += count;
      }
      return { response: createJsonResponse({
        resource, total: tableEntry.total, totalPage: Math.ceil(tableEntry.total / limit), current,
      }, { onSizeChange: () => resized(key) }), expiresAt: Infinity };
    }

    // Unprepared tables retain the original API behavior.
    const entry = await load(table, source.generation);
    const current = (page - 1) * limit;
    const total = entry.resources.length;
    return {
      response: createJsonResponse({
        resource: entry.resources.slice(current, current + limit),
        total, totalPage: Math.ceil(total / limit), current,
      }, { onSizeChange: () => resized(key) }),
      expiresAt: entry.expiresAt,
    };
  }

  async function getResponse(table, page, limit) {
    // Revalidate GCS on every request, including requests answered from memory.
    const manifest = await readManifest();
    if (manifest && Object.hasOwn(manifest.data.tables, table)) {
      return getSnapshotResponse(table, page, limit, { manifest, version: manifest.hash });
    }
    const [metadata] = await storage.bucket("wip-bucket").file(`${table}.json`).getMetadata();
    const generation = String(metadata.generation);
    if (!/^[0-9]+$/.test(generation)) throw new Error("Invalid resource generation");
    return getSnapshotResponse(table, page, limit, { generation, version: `raw:${generation}` });
  }

  async function getSnapshotResponse(table, page, limit, source) {
    // Check pages BEFORE loading the table: large tables may not fit the resource cache.
    const key = `${source.version}:${table}:${page}:${limit}`;
    const cached = responses.get(key);
    if (cached && cached.expiresAt > now()) {
      responses.delete(key);
      responses.set(key, cached);
      return cached.response;
    }
    if (cached) removeResponse(key);
    if (pendingResponses.has(key)) return pendingResponses.get(key);
    const task = buildResponse(table, page, limit, key, source).then((entry) => {
      entry.size = entry.response.size;
      if (entry.size <= maxResponseBytes) {
        responses.set(key, entry);
        responseBytes += entry.size;
        trimResponses();
      }
      return entry.response;
    }).finally(() => pendingResponses.delete(key));
    pendingResponses.set(key, task);
    return task;
  }

  return { getResponse };
}

module.exports = { createResourceStore };
