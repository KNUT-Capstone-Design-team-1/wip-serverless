export const CACHE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12시간 (43,200초)
const MEMORY_CACHE_MAX_ENTRIES = 500;

// Worker In-Memory LRU Cache
const memoryCache = new Map();

/**
 * 인메모리 캐시 조회
 * @param {string} key
 * @returns {Object|null}
 */
export function getFromMemoryCache(key) {
  const cached = memoryCache.get(key);

  if (!cached) {
    return null;
  }

  const isExpired = Date.now() > cached.expiresAt;

  if (isExpired) {
    memoryCache.delete(key);
    return null;
  }

  memoryCache.delete(key);
  memoryCache.set(key, cached);

  return cached.data;
}

/**
 * 인메모리 캐시 저장
 * @param {string} key
 * @param {Object} data
 */
export function setToMemoryCache(key, data) {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_MAX_AGE_SECONDS * 1000,
  });
}
