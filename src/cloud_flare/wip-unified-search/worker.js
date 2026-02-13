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

/**
 * 통합 검색 요청 처리
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @returns
 */
async function requestUnifiedSearch(request, env) {
  const keywords = new URL(request.url).searchParams.getAll("keyword");

  const validateResult = validate(keywords);
  if (!validateResult.valid) {
    return new Response(validateResult.reason, { status: 400 });
  }

  const db = env.D1;
  const results = await UnifiedSearchService.searchUnified(
    db,
    validateResult.normalizedKeywords,
  );

  return Response.json({ results });
}

export default {
  async fetch(request, env, _ctx) {
    const token = request.headers.get("x-auth-token");

    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const ok = await verifyToken(token, env.SECRET_KEY);

    if (!ok) {
      return new Response("Unauthorized", { status: 401 });
    }

    switch (request.method.toUpperCase()) {
      case "GET":
        return requestUnifiedSearch(request, env);

      default:
        return new Response("Bad Request", { status: 400 });
    }
  },
};
