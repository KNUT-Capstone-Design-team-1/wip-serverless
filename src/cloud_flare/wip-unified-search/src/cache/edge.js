import { CACHE_MAX_AGE_SECONDS } from "./memory.js";

/**
 * Edge Cache API 활성화 여부 확인
 * @returns {boolean}
 */
export function isEdgeCacheSupported() {
  return typeof caches !== "undefined" && Boolean(caches.default);
}

/**
 * Edge Cache API 조회
 * @param {Request} cacheKeyRequest
 * @returns {Promise<Object|null>}
 */
export async function getFromEdgeCache(cacheKeyRequest) {
  if (!isEdgeCacheSupported()) {
    return null;
  }

  try {
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKeyRequest);

    if (cachedResponse) {
      return await cachedResponse.json();
    }

    return null;
  } catch (error) {
    console.error("Edge cache lookup error:", error);
    return null;
  }
}

/**
 * Edge Cache API 저장 Task 생성
 * @param {Request} cacheKeyRequest
 * @param {Object} data
 * @returns {Promise<void>|null}
 */
export function createEdgeCacheSaveTask(cacheKeyRequest, data) {
  if (!isEdgeCacheSupported()) {
    return null;
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

    return cache
      .put(cacheKeyRequest, responseToCache)
      .catch((err) => console.error("Edge cache save error:", err));
  } catch (error) {
    console.error("Edge cache save task creation error:", error);
    return null;
  }
}
