const { createJsonResponse } = require("./response");

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function createResourceStore(storage, { now = Date.now } = {}) {
  const resources = new Map();
  const responses = new Map();
  const pending = new Map();
  let resourceBytes = 0;
  let responseBytes = 0;
  let version = 0;

  function removeResource(key) {
    resourceBytes -= resources.get(key).size;
    resources.delete(key);
  }
  function removeResponse(key) {
    responseBytes -= responses.get(key).response.body.length;
    responses.delete(key);
  }

  async function load(table) {
    const cached = resources.get(table);
    if (cached && cached.expiresAt > now()) {
      resources.delete(table);
      resources.set(table, cached);
      return cached;
    }
    if (cached) removeResource(table);
    if (pending.has(table)) return pending.get(table);

    const task = (async () => {
      const [contents] = await storage.bucket("wip-bucket").file(`${table}.json`).download();
      const data = JSON.parse(contents.toString("utf8"));
      if (!Array.isArray(data.resources)) throw new Error("Invalid resource data");
      const entry = { resources: data.resources, size: contents.length * 2,
        expiresAt: now() + CACHE_TTL_MS, version: ++version };
      if (entry.size <= MAX_RESOURCE_BYTES) {
        while (resources.size >= 10 || resourceBytes + entry.size > MAX_RESOURCE_BYTES) {
          removeResource(resources.keys().next().value);
        }
        resources.set(table, entry);
        resourceBytes += entry.size;
      }
      return entry;
    })().finally(() => pending.delete(table));
    pending.set(table, task);
    return task;
  }

  async function getResponse(table, page, limit) {
    const entry = await load(table);
    const key = `${table}:${entry.version}:${page}:${limit}`;
    const cached = responses.get(key);
    if (cached && cached.expiresAt > now()) {
      responses.delete(key);
      responses.set(key, cached);
      return cached.response;
    }
    if (cached) removeResponse(key);
    const current = (page - 1) * limit;
    const total = entry.resources.length;
    const response = createJsonResponse({
      resource: entry.resources.slice(current, current + limit),
      total, totalPage: Math.ceil(total / limit), current,
    });
    // Bound retained JSON; at most three compressed variants are retained per page.
    if (response.body.length <= MAX_RESPONSE_BYTES) {
      while (responses.size >= 32 || responseBytes + response.body.length > MAX_RESPONSE_BYTES) {
        removeResponse(responses.keys().next().value);
      }
      responses.set(key, { response, expiresAt: entry.expiresAt });
      responseBytes += response.body.length;
    }
    return response;
  }

  return { getResponse };
}

module.exports = { createResourceStore };
