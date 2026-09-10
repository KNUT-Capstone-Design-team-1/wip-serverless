import { SEARCH_VERSION } from "../cursor.js";

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
