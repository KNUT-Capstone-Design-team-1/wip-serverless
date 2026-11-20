const CACHE_SECONDS = 24 * 60 * 60;

// Each function is deployed independently; keep this helper inside its package.
function createResponseCache({ maxEntries = 500, maxBytes = 8 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  }

  async function getOrLoad(key, load) {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > now()) {
      entries.delete(key);
      entries.set(key, entry);
      return { ...entry.value, hit: true, age: Math.floor((now() - entry.createdAt) / 1000) };
    }
    remove(key);
    if (pending.has(key)) return pending.get(key);

    const task = Promise.resolve().then(load).then((value) => {
      const size = Buffer.byteLength(value.body);
      if (value.cacheable !== false && size <= maxBytes) {
        while (entries.size >= maxEntries || bytes + size > maxBytes) {
          remove(entries.keys().next().value);
        }
        const createdAt = now();
        entries.set(key, { value, bytes: size, createdAt, expiresAt: createdAt + CACHE_SECONDS * 1000 });
        bytes += size;
      }
      return { ...value, hit: false, age: 0 };
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  return { getOrLoad };
}

module.exports = { CACHE_SECONDS, createResponseCache };
