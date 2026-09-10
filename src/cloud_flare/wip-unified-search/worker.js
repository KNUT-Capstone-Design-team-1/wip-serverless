/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { verifyToken } from "./src/authentication.js";
import { handleSearchRequest } from "./src/search_handler.js";

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
      return handleSearchRequest(request, env, ctx);
    }

    return new Response("Bad Request", { status: 400 });
  },
};
