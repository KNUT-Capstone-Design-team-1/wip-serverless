/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import * as NearbyPharmaciesAPIHandler from "./src/nearby_pharmacies.js";

async function requestNearbyPharmaciesApi(request, env) {
  switch (request.method.toUpperCase()) {
    case "GET":
      return NearbyPharmaciesAPIHandler.readPharmacies(request, env);

    default:
      return new Response("Bad Request", { status: 400 });
  }
}

export default {
  async fetch(request, env, _ctx) {
    const { pathname } = new URL(request.url);

    if (/^\/nearby-pharmacies\??$/.test(pathname)) {
      return requestNearbyPharmaciesApi(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
