import { SEARCH_VERSION } from "./cursor.js";

export const RESPONSE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60; // 1일 (86,400초)
export const KV_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일 (2,592,000초)

/**
 * KV 캐시 키 생성
 * @param {string} canonicalQuery
 * @param {number} limit
 * @param {string|null} cursor
 * @returns {string}
 */
export function getCacheKeyString(canonicalQuery, limit, cursor) {
  return `v:${SEARCH_VERSION}|q:${canonicalQuery}|l:${limit}|c:${cursor || ""}`;
}

function getKvInstance(env) {
  return env?.UNIFIED_SEARCH_KV || env?.KV || null;
}

/**
 * KV 캐시 조회
 * @param {string} cacheKeyStr
 * @param {Object} [env]
 * @returns {Promise<{ data: Object|null, source: 'KV'|null }>}
 */
export async function findCachedData(cacheKeyStr, env = {}) {
  const kv = getKvInstance(env);

  if (kv) {
    try {
      const data = await kv.get(cacheKeyStr, "json");
      if (data) {
        return { data, source: "KV" };
      }
    } catch (error) {
      console.error("KV cache lookup error:", error);
    }
  }

  return { data: null, source: null };
}

/**
 * KV 캐시 저장 (Workers context가 있으면 백그라운드에서 처리)
 * @param {string} cacheKeyStr
 * @param {Object} data
 * @param {Object} [env]
 * @param {Object} [ctx]
 */
export async function saveCacheData(cacheKeyStr, data, env = {}, ctx = null) {
  const kv = getKvInstance(env);

  if (!kv) {
    return;
  }

  const task = kv
    .put(cacheKeyStr, JSON.stringify(data), {
      expirationTtl: KV_CACHE_TTL_SECONDS,
    })
    .catch((error) => console.error("KV cache save error:", error));

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
    return;
  }

  await task;
}
