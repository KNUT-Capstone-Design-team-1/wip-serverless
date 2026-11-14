export const RESPONSE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;
export const KV_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const VERSION_KEY = "notices:version";

function getKv(env) {
  return env.WIP_NOTICE || env.WIP_NOTICCE;
}

export async function findCachedNotices(env, { mustRead, skip, limit }) {
  const kv = getKv(env);
  if (!kv) return { key: null, data: null };

  try {
    const version = (await kv.get(VERSION_KEY)) || "initial";
    const key = `notices:v1:${version}:${Number(mustRead)}:${skip}:${limit}`;
    const data = await kv.get(key, "json");
    return { key, data };
  } catch (error) {
    console.error("Notice KV cache lookup error:", error);
    return { key: null, data: null };
  }
}

export async function saveCachedNotices(env, key, data, ctx) {
  const kv = getKv(env);
  if (!kv || !key) return;

  const task = kv.put(key, JSON.stringify(data), {
    expirationTtl: KV_CACHE_TTL_SECONDS,
  }).catch((error) => console.error("Notice KV cache save error:", error));

  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(task);
  } else {
    await task;
  }
}

export async function invalidateNoticeCache(env) {
  const kv = getKv(env);
  if (!kv) return;
  // Keep the version indefinitely so old cache entries cannot become current again.
  await kv.put(VERSION_KEY, crypto.randomUUID());
}

export function createNoticeResponse(data, hit) {
  return Response.json(data, {
    headers: {
      "Cache-Control": `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`,
      "X-Cache-Status": hit ? "HIT (KV)" : "MISS",
    },
  });
}
