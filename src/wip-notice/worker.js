/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import * as NoticesApiHandler from "./src/notices.js";
import * as NoticesIdxApiHandler from "./src/notices_idx.js";

async function requestNoticesApi(request, env) {
  switch (request.method.toUpperCase()) {
    case "POST":
      return NoticesApiHandler.createNotice(request, env);

    case "GET":
      return NoticesApiHandler.readNotices(request, env);

    default:
      return new Response("Bad Request", { status: 400 });
  }
}

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
      return NoticesIdxApiHandler.updateNotice(idx, request, env);

    case "DELETE":
      return NoticesIdxApiHandler.deleteNotice(idx, env);

    default:
      return new Response("Bad Request", { status: 400 });
  }
}

export default {
  async fetch(request, env, _ctx) {
    const { pathname } = new URL(request.url);

    if (/^\/notices\??$/.test(pathname)) {
      return requestNoticesApi(request, env);
    }

    if (/^\/notices\/\d+$/) {
      return requestNoticesIdxApi(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
