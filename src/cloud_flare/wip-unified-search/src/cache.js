import { SEARCH_VERSION } from "./cursor.js";
import { MAX_LIMIT } from "./constants.js";

export const RESPONSE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60; // 1일
export const KV_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일

// 데이터 갱신 시 Worker 환경변수도 변경하면 기존 KV/커서를 즉시 분리한다.
export function getDataVersion(env) {
  return env?.SEARCH_DATA_VERSION?.trim() || "default";
}

/**
 * KV 캐시 키 생성
 * @param {string} canonicalQuery
 * @param {number} limit
 * @param {string|null} cursor
 * @param {string} [dataVersion]
 * @returns {Promise<string>}
 */
export async function getCacheKeyString(
  canonicalQuery,
  limit,
  cursor,
  dataVersion = "default",
) {
  // 한글 검색어/커서가 길어도 KV 키의 512-byte 제한을 넘지 않는다.
  const input = JSON.stringify([
    SEARCH_VERSION,
    dataVersion,
    canonicalQuery,
    limit,
    cursor || "",
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return `search:${SEARCH_VERSION}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isSearchResponse(value) {
  return (
    value &&
    Array.isArray(value.results) &&
    value.results.length <= MAX_LIMIT &&
    value.results.every((item) => typeof item === "string") &&
    typeof value.hasMore === "boolean" &&
    (value.hasMore
      ? typeof value.nextCursor === "string" && value.nextCursor.length > 0
      : value.nextCursor === null)
  );
}

function getKvInstance(env) {
  return env?.UNIFIED_SEARCH_KV || env?.KV || null;
}

/**
 * 직렬화된 JSON 응답 조회 (손상 여부 검증 후 응답 재직렬화 생략)
 * @param {string} cacheKeyStr
 * @param {Object} [env]
 * @returns {Promise<{ data: string|null, source: 'KV'|null, maxAge?: number }>}
 */
export async function findCachedData(cacheKeyStr, env = {}) {
  const kv = getKvInstance(env);

  if (kv) {
    try {
      const data = await kv.get(cacheKeyStr, "text");
      if (data) {
        const cached = JSON.parse(data);
        const age = (Date.now() - cached?.savedAt) / 1000;
        if (
          Number.isFinite(age) &&
          age >= 0 &&
          age < KV_CACHE_TTL_SECONDS &&
          typeof cached.body === "string" &&
          isSearchResponse(JSON.parse(cached.body))
        ) {
          return {
            data: cached.body,
            source: "KV",
            maxAge: Math.min(
              RESPONSE_CACHE_MAX_AGE_SECONDS,
              Math.floor(KV_CACHE_TTL_SECONDS - age),
            ),
          };
        }
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
 * @param {Object|string} data 응답 객체 또는 직렬화된 JSON
 * @param {Object} [env]
 * @param {Object} [ctx]
 */
export async function saveCacheData(cacheKeyStr, data, env = {}, ctx = null) {
  const kv = getKvInstance(env);

  if (!kv) {
    return;
  }

  const task = kv
    .put(
      cacheKeyStr,
      JSON.stringify({
        savedAt: Date.now(),
        body: typeof data === "string" ? data : JSON.stringify(data),
      }),
      {
        expirationTtl: KV_CACHE_TTL_SECONDS,
      },
    )
    .catch((error) => console.error("KV cache save error:", error));

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
    return;
  }

  await task;
}
