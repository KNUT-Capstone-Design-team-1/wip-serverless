import { invalidateNoticeCache } from "./cache.js";

/**
 * 공지사항 업데이트
 * @param {number} idx 공지사항 ID
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @returns
 */
export async function updateNotice(idx, request, env) {
  const contentType = request.headers.get("Content-Type");

  if (contentType !== "application/json") {
    console.log(`[UPDATE-NOTICE] Allowed only json contents type`);
    return new Response("Bad Request", { status: 400 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!payload) {
    console.log(`[UPDATE-NOTICE] No payload`);
    return new Response("Bad Request", { status: 400 });
  }

  const { title, contents, mustRead } = payload;

  if (!title && !contents && typeof mustRead !== "boolean" && !mustRead) {
    console.log(
      `[UPDATE-NOTICE] Required value not exist. title: %s, contents: %s`,
      title,
      contents,
    );
    return new Response("Bad Request", { status: 400 });
  }

  const fields = [];
  const values = [];
  if (title) { fields.push("title = ?"); values.push(title); }
  if (contents) { fields.push("contents = ?"); values.push(contents); }
  if (typeof mustRead === "boolean" || mustRead) {
    fields.push("mustRead = ?");
    values.push(Number(mustRead));
  }
  const sql = `UPDATE Notices SET ${fields.join(", ")}, updateDate = CURRENT_TIMESTAMP WHERE idx = ?`;
  const statement = env.D1.prepare(sql).bind(...values, idx);
  await env.D1.batch([statement]);
  await invalidateNoticeCache(env);

  return new Response("Success", { status: 200 });
}

/**
 * 공지사항 삭제
 * @param {number} idx 공지사항 ID
 * @param {Object} env workers 환경
 * @returns
 */
export async function deleteNotice(idx, env) {
  const sql = `DELETE FROM Notices WHERE idx = ?`;
  const statement = env.D1.prepare(sql).bind(idx);
  await env.D1.batch([statement]);
  await invalidateNoticeCache(env);

  return new Response("Success", { status: 200 });
}
