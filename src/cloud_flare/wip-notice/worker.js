/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import * as NoticesAPIHandler from "./src/notices.js";
import * as NoticesIDXAPIHandler from "./src/notices_idx.js";
import { verifyToken } from "./src/authentication.js";

/**
 * 공지사항 API 요청
 * @param {Request} request 요청 객체
 * @param {*} env workers 환경 객체
 * @returns
 */
async function requestNoticesApi(request, env) {
  switch (request.method.toUpperCase()) {
    case "POST":
      return NoticesAPIHandler.createNotice(request, env);

    case "GET":
      return NoticesAPIHandler.readNotices(request, env);

    default:
      return new Response("Bad Request", { status: 400 });
  }
}

/**
 * 공지사항 1개에 대한 API 요청
 * @param {Request} request 요청 객체
 * @param {*} env workers 환경 객체
 * @returns
 */
async function requestNoticesIdxApi(request, env) {
  const path = new URL(request.url).pathname;
  const pathParts = path.split("/").filter(Boolean);
  const idx = parseInt(pathParts[1], 10);

  if (!idx) {
    console.log(`[REQUEST-NOTICES-IDX-API] No idx`);
    return new Response("Bad Request", { status: 400 });
  }

  switch (request.method.toUpperCase()) {
    case "PUT":
      return NoticesIDXAPIHandler.updateNotice(idx, request, env);

    case "DELETE":
      return NoticesIDXAPIHandler.deleteNotice(idx, env);

    default:
      return new Response("Bad Request", { status: 400 });
  }
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

    const { pathname } = new URL(request.url);

    if (/^\/notices\/?$/.test(pathname)) {
      return requestNoticesApi(request, env);
    }

    if (/^\/notices\/\d+$/.test(pathname)) {
      return requestNoticesIdxApi(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
