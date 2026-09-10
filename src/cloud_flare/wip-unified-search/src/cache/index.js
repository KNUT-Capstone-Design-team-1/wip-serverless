import { getFromMemoryCache, setToMemoryCache, CACHE_MAX_AGE_SECONDS } from "./memory.js";
import { getFromKvCache, createKvSaveTask } from "./kv.js";
import { getFromEdgeCache, createEdgeCacheSaveTask } from "./edge.js";

export { getCacheKeyString, createCacheKey } from "./key.js";
export { CACHE_MAX_AGE_SECONDS } from "./memory.js";

/**
 * 캐시된 응답 조회 (In-Memory -> KV -> Edge Cache API 순차 확인)
 * @param {string} cacheKeyStr
 * @param {Request} cacheKeyRequest
 * @param {Object} [env]
 * @returns {Promise<{ data: Object|null, source: 'MEMORY'|'KV'|'CF_CACHE'|null }>}
 */
export async function findCachedData(cacheKeyStr, cacheKeyRequest, env = {}) {
  // 1. In-Memory 조회
  const memoryData = getFromMemoryCache(cacheKeyStr);
  if (memoryData) {
    return { data: memoryData, source: "MEMORY" };
  }

  // 2. Workers KV 조회
  const kvData = await getFromKvCache(env, cacheKeyStr);
  if (kvData) {
    setToMemoryCache(cacheKeyStr, kvData);
    return { data: kvData, source: "KV" };
  }

  // 3. Edge Cache API 조회
  const edgeData = await getFromEdgeCache(cacheKeyRequest);
  if (edgeData) {
    setToMemoryCache(cacheKeyStr, edgeData);
    return { data: edgeData, source: "CF_CACHE" };
  }

  return { data: null, source: null };
}

/**
 * 응답을 모든 캐시 계층에 저장 (In-Memory 동기 저장 + KV/Edge 비동기 저장)
 * @param {string} cacheKeyStr
 * @param {Request} cacheKeyRequest
 * @param {Object} data
 * @param {Object} [env]
 * @param {Object} [ctx]
 */
export async function saveCacheData(cacheKeyStr, cacheKeyRequest, data, env = {}, ctx = null) {
  // 1. In-Memory 저장
  setToMemoryCache(cacheKeyStr, data);

  // 2. 비동기 Task 목록 구성
  const tasks = [
    createKvSaveTask(env, cacheKeyStr, data),
    createEdgeCacheSaveTask(cacheKeyRequest, data),
  ].filter(Boolean);

  if (tasks.length === 0) {
    return;
  }

  const hasWaitUntil = ctx && typeof ctx.waitUntil === "function";

  if (hasWaitUntil) {
    ctx.waitUntil(Promise.all(tasks));
    return;
  }

  await Promise.all(tasks);
}
