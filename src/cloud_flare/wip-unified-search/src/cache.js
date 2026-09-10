import { SEARCH_VERSION } from "./cursor.js";

const CACHE_MAX_AGE_SECONDS = 3600;
const MEMORY_CACHE_MAX_ENTRIES = 500;

// Worker In-Memory LRU Cache (개발/workers.dev 환경 및 초고속 캐시 레이어)
const memoryCache = new Map();

/**
 * 인메모리 캐시 조회
 * @param {string} key
 * @returns {Object|null}
 */
function getFromMemoryCache(key) {
  const cached = memoryCache.get(key);

  if (!cached) {
    return null;
  }

  const isExpired = Date.now() > cached.expiresAt;

  if (isExpired) {
    memoryCache.delete(key);
    return null;
  }

  // LRU 갱신
  memoryCache.delete(key);
  memoryCache.set(key, cached);

  return cached.data;
}

/**
 * 인메모리 캐시 저장
 * @param {string} key
 * @param {Object} data
 */
function setToMemoryCache(key, data) {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_MAX_AGE_SECONDS * 1000,
  });
}

/**
 * Cache Key 식별자 문자열 생성
 * @param {string} canonicalQuery
 * @param {number} limit
 * @param {string|null} cursor
 * @returns {string}
 */
export function getCacheKeyString(canonicalQuery, limit, cursor) {
  return `v:${SEARCH_VERSION}|q:${canonicalQuery}|l:${limit}|c:${cursor || ""}`;
}

/**
 * Cache Key Request 생성 함수 (Cloudflare Cache API용)
 * @param {Request} request
 * @param {string} canonicalQuery
 * @param {number} limit
 * @param {string|null} cursor
 * @returns {Request}
 */
export function createCacheKey(request, canonicalQuery, limit, cursor) {
  const cacheUrl = new URL(request.url);

  cacheUrl.pathname = "/_cache/unified_search";

  const params = new URLSearchParams({
    v: SEARCH_VERSION,
    q: canonicalQuery,
    limit: String(limit),
    cursor: cursor || "",
  });

  cacheUrl.search = params.toString();

  return new Request(cacheUrl.toString(), { method: "GET" });
}

/**
 * 캐시된 응답 조회 (In-Memory -> Cache API 순서)
 * @param {string} cacheKeyStr
 * @param {Request} cacheKeyRequest
 * @returns {Promise<{ data: Object|null, source: 'MEMORY'|'CF_CACHE'|null }>}
 */
export async function findCachedData(cacheKeyStr, cacheKeyRequest) {
  // 1. In-Memory 캐시 확인 (workers.dev 및 초고속 반환)
  const memoryData = getFromMemoryCache(cacheKeyStr);

  if (memoryData) {
    return { data: memoryData, source: "MEMORY" };
  }

  // 2. Cloudflare Edge Cache API 확인
  const isCacheSupported =
    typeof caches !== "undefined" && Boolean(caches.default);

  if (!isCacheSupported) {
    return { data: null, source: null };
  }

  try {
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKeyRequest);

    if (cachedResponse) {
      const data = await cachedResponse.json();
      setToMemoryCache(cacheKeyStr, data);
      return { data, source: "CF_CACHE" };
    }

    return { data: null, source: null };
  } catch (error) {
    console.error("Cache lookup error:", error);
    return { data: null, source: null };
  }
}

/**
 * 응답을 캐시에 저장 (In-Memory + Cache API)
 * @param {string} cacheKeyStr
 * @param {Request} cacheKeyRequest
 * @param {Object} data
 * @param {Object} [ctx]
 */
export async function saveCacheData(cacheKeyStr, cacheKeyRequest, data, ctx) {
  // 1. In-Memory 캐시 저장
  setToMemoryCache(cacheKeyStr, data);

  // 2. Cloudflare Cache API 저장
  const isCacheSupported =
    typeof caches !== "undefined" && Boolean(caches.default);

  if (!isCacheSupported) {
    return;
  }

  try {
    const cache = caches.default;
    const responseToCache = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
      },
    });

    const hasWaitUntil = ctx && typeof ctx.waitUntil === "function";

    if (hasWaitUntil) {
      ctx.waitUntil(cache.put(cacheKeyRequest, responseToCache));
      return;
    }

    await cache.put(cacheKeyRequest, responseToCache);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

export { CACHE_MAX_AGE_SECONDS };
