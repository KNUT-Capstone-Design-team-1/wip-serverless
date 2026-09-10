/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import validate from "./src/validation.js";
import * as UnifiedSearchService from "./src/unified_search.js";
import { verifyToken } from "./src/authentication.js";
import {
  getCacheKeyString,
  createCacheKey,
  findCachedData,
  saveCacheData,
  CACHE_MAX_AGE_SECONDS,
} from "./src/cache.js";

const DEFAULT_LIMIT = 30;

/**
 * 요청 URL에서 limit 파싱
 * @param {URL} url
 * @returns {number}
 */
function parseLimit(url) {
  const limitStr = url.searchParams.get("limit");

  const hasLimitParam = limitStr !== null;

  if (hasLimitParam) {
    return parseInt(limitStr, 10);
  }

  return DEFAULT_LIMIT;
}

/**
 * 통합 검색 요청 처리
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @param {Object} [ctx] workers context 객체
 * @returns {Promise<Response>}
 */
async function requestUnifiedSearch(request, env, ctx) {
  const url = new URL(request.url);

  const keywords = url.searchParams.getAll("keyword");

  const cursor = url.searchParams.get("cursor");

  const limit = parseLimit(url);

  const validateResult = validate(keywords, limit, cursor);

  const isInvalidRequest = !validateResult.valid;

  if (isInvalidRequest) {
    return new Response(validateResult.reason, { status: 400 });
  }

  const cacheKeyStr = getCacheKeyString(
    validateResult.canonicalQuery,
    limit,
    cursor,
  );

  const cacheKeyRequest = createCacheKey(
    request,
    validateResult.canonicalQuery,
    limit,
    cursor,
  );

  const { data: cachedData, source } = await findCachedData(
    cacheKeyStr,
    cacheKeyRequest,
  );

  const isCacheHit = Boolean(cachedData);

  if (isCacheHit) {
    return new Response(JSON.stringify(cachedData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
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
  });

  const response = new Response(JSON.stringify(searchResult), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
      "X-Cache-Status": "MISS",
    },
  });

  await saveCacheData(cacheKeyStr, cacheKeyRequest, searchResult, ctx);

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const token = request.headers.get("x-auth-token");

    const isTokenMissing = !token;

    if (isTokenMissing) {
      return new Response("Unauthorized", { status: 401 });
    }

    const isTokenValid = await verifyToken(token, env.SECRET_KEY);

    if (!isTokenValid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const httpMethod = request.method.toUpperCase();

    const isGetMethod = httpMethod === "GET";

    if (isGetMethod) {
      return requestUnifiedSearch(request, env, ctx);
    }

    return new Response("Bad Request", { status: 400 });
  },
};
