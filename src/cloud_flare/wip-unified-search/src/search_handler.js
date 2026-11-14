import validate from "./validation.js";
import * as UnifiedSearchService from "./unified_search.js";
import { DEFAULT_LIMIT } from "./constants.js";
import {
  getCacheKeyString,
  getDataVersion,
  findCachedData,
  saveCacheData,
  RESPONSE_CACHE_MAX_AGE_SECONDS,
} from "./cache.js";

/**
 * 요청 URL에서 limit 파싱
 * @param {URL} url
 * @returns {number}
 */
function parseLimit(url) {
  const limitStr = url.searchParams.get("limit");

  const hasLimitParam = limitStr !== null;

  if (hasLimitParam) {
    return /^\d+$/.test(limitStr) ? Number(limitStr) : NaN;
  }

  return DEFAULT_LIMIT;
}

/**
 * 통합 검색 요청 처리 핸들러
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @param {Object} [ctx] workers context 객체
 * @returns {Promise<Response>}
 */
export async function handleSearchRequest(request, env, ctx) {
  const url = new URL(request.url);

  const keywords = url.searchParams.getAll("keyword");
  const cursor = url.searchParams.get("cursor");
  const limit = parseLimit(url);
  const dataVersion = getDataVersion(env);

  const validateResult = validate(keywords, limit, cursor, dataVersion);

  const isInvalidRequest = !validateResult.valid;

  if (isInvalidRequest) {
    return new Response(validateResult.reason, { status: 400 });
  }

  const cacheKeyStr = await getCacheKeyString(
    validateResult.canonicalQuery,
    limit,
    cursor,
    dataVersion,
  );

  const {
    data: cachedData,
    source,
    maxAge,
  } = await findCachedData(cacheKeyStr, env);

  const isCacheHit = Boolean(cachedData);

  if (isCacheHit) {
    return new Response(cachedData, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `private, max-age=${maxAge}`,
        "X-Cache-Status": `HIT (${source})`,
      },
    });
  }

  const db = env.D1;

  const searchResult = await UnifiedSearchService.searchUnified(db, {
    keywords: validateResult.finalTokens,
    canonicalQuery: validateResult.canonicalQuery,
    limit,
    cursorData: validateResult.cursorData,
    dataVersion,
  });

  const responseBody = JSON.stringify(searchResult);
  const response = new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `private, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`,
      "X-Cache-Status": "MISS",
    },
  });

  await saveCacheData(cacheKeyStr, responseBody, env, ctx);

  return response;
}
