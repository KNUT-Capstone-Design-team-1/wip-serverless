/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
const NoticesApiHandler = require('./src/notices');
const NoticesIdxApiHandler = require('./src/notices_idx');

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
  switch (request.method.toUpperCase()) {
    case "GET":
      return NoticesIdxApiHandler.readNoticeDetail(request, env);

    case "PUT":
      return NoticesIdxApiHandler.updateNotice(request, env);

    case "DELETE":
      return NoticesIdxApiHandler.deleteNotice(request, env);

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