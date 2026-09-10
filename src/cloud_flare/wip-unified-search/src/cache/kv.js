import { CACHE_MAX_AGE_SECONDS } from "./memory.js";

/**
 * KV 인스턴스 추출 헬퍼
 * @param {Object} env
 * @returns {Object|null}
 */
function getKvInstance(env) {
  return env?.UNIFIED_SEARCH_KV || env?.KV || null;
}

/**
 * KV 캐시 조회
 * @param {Object} env
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
export async function getFromKvCache(env, key) {
  const kv = getKvInstance(env);

  if (!kv) {
    return null;
  }

  try {
    return await kv.get(key, "json");
  } catch (error) {
    console.error("KV cache lookup error:", error);
    return null;
  }
}

/**
 * KV 캐시 저장 Task 생성
 * @param {Object} env
 * @param {string} key
 * @param {Object} data
 * @returns {Promise<void>|null}
 */
export function createKvSaveTask(env, key, data) {
  const kv = getKvInstance(env);

  if (!kv) {
    return null;
  }

  return kv
    .put(key, JSON.stringify(data), {
      expirationTtl: CACHE_MAX_AGE_SECONDS,
    })
    .catch((err) => console.error("KV cache save error:", err));
}
