import { findCachedNotices, saveCachedNotices, invalidateNoticeCache, createNoticeResponse } from "./cache.js";

/**
 * 공지사항 생성
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @returns
 */
export async function createNotice(request, env) {
  const contentType = request.headers.get("Content-Type");

  if (contentType !== "application/json") {
    console.log(`[CREATE-NOTICE] Allowed only json contents type`);
    return new Response("Bad Request", { status: 400 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (!payload) {
    console.log(`[CREATE-NOTICE] No payload`);
    return new Response("Bad Request", { status: 400 });
  }

  const { title, contents, mustRead = false } = payload;
  if (!title || !contents) {
    console.log(
      `[CREATE-NOTICE] Required value not exist. title: %s, contents: %s`,
      title,
      contents,
    );
    return new Response("Bad Request", { status: 400 });
  }

  const sql = `INSERT INTO Notices (idx, title, contents, mustRead, createDate, updateDate)
                 VALUES ((SELECT IFNULL(MAX(idx), 0) + 1 FROM Notices), ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  const statement = env.D1.prepare(sql).bind(title, contents, Number(mustRead));
  await env.D1.batch([statement]);
  await invalidateNoticeCache(env);

  return new Response("Created", { status: 201 });
}

/**
 * 공지사항 목록 조회
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @returns
 */
export async function readNotices(request, env, ctx) {
  const queryParams = new URL(request.url).searchParams;

  const mustRead = Boolean(queryParams.get("mustRead"));
  const skip = Number(queryParams.get("skip") || 0);
  const requestedLimit = Number(queryParams.get("limit") || 10);
  const limit = requestedLimit === 0 ? 10 : requestedLimit;

  if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    return new Response("Bad Request", { status: 400 });
  }

  if (limit > 10) {
    return new Response("Content Too Large", { status: 413 });
  }

  const { key, data } = await findCachedNotices(env, { mustRead, skip, limit });
  if (data) return createNoticeResponse(data, true);

  const sql = `SELECT idx, title, contents, mustRead, createDate, updateDate
                 FROM Notices
                 ${mustRead ? "WHERE mustRead = 1" : ""}
                 ORDER BY idx LIMIT ? OFFSET ?`;
  const statement = env.D1.prepare(sql).bind(limit, skip);

  const countSql = `SELECT COUNT(*) AS cnt FROM Notices ${mustRead ? "WHERE mustRead = 1" : ""}`;
  const countStatement = env.D1.prepare(countSql);
  const [page, count] = await env.D1.batch([statement, countStatement]);
  const result = { success: true, notices: page.results, total: count.results[0].cnt };
  await saveCachedNotices(env, key, result, ctx);

  return createNoticeResponse(result, false);
}
