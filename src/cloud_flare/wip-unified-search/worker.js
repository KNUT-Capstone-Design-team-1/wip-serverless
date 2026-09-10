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
import { SEARCH_VERSION } from "./src/cursor.js";

const DEFAULT_LIMIT = 30;
const CACHE_MAX_AGE_SECONDS = 3600;

/**
 * Cache Key 생성 함수
 * @param {Request} request
 * @param {string} canonicalQuery
 * @param {number} limit
 * @param {string|null} cursor
 * @returns {Request}
 */
function createCacheKey(request, canonicalQuery, limit, cursor) {
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
 * 캐시된 응답 조회
 * @param {Request} cacheKey
 * @returns {Promise<Response|null>}
 */
async function findCachedResponse(cacheKey) {
  const isCacheSupported =
    typeof caches !== "undefined" && Boolean(caches.default);

  if (!isCacheSupported) {
    return null;
  }

  try {
    const cache = caches.default;

    const cachedResponse = await cache.match(cacheKey);

    const hasCachedResponse = Boolean(cachedResponse);

    if (hasCachedResponse) {
      return cachedResponse;
    }

    return null;
  } catch (error) {
    console.error("Cache lookup error:", error);

    return null;
  }
}

/**
 * 응답을 캐시에 비동기로 저장
 * @param {Request} cacheKey
 * @param {Response} response
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
async function saveResponseToCache(cacheKey, response, ctx) {
  const isCacheSupported =
    typeof caches !== "undefined" && Boolean(caches.default);

  if (!isCacheSupported) {
    return;
  }

  try {
    const cache = caches.default;

    const responseToCache = response.clone();

    const hasWaitUntil = ctx && typeof ctx.waitUntil === "function";

    if (hasWaitUntil) {
      ctx.waitUntil(cache.put(cacheKey, responseToCache));

      return;
    }

    await cache.put(cacheKey, responseToCache);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

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

  const cacheKey = createCacheKey(
    request,
    validateResult.canonicalQuery,
    limit,
    cursor,
  );

  const cachedResponse = await findCachedResponse(cacheKey);

  const isCacheHit = Boolean(cachedResponse);

  if (isCacheHit) {
    return cachedResponse;
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
    },
  });

  await saveResponseToCache(cacheKey, response, ctx);

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
