/**
 * 공지사항 업데이트
 * @param {number} idx 공지사항 ID
 * @param {Request} request 요청 객체
 * @param {*} env workers 환경
 * @returns
 */
export async function updateNotice(idx, request, env) {
  const contentType = request.headers.get("Content-Type");

  if (contentType !== "application/json") {
    console.log(`[UPDATE-NOTICE] Allowed only json contents type`);
    return new Response("Bad Request", { status: 400 });
  }

  const payload = await request.json();

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

  const sql = `UPDATE Notices SET 
                 ${title ? "title = ?," : ""}
                 ${contents ? "contents = ?," : ""}
                 ${mustRead ? "mustRead = ?," : ""}
                 updateDate = CURRENT_TIMESTAMP
                 WHERE idx = ?`;
  const statement = env.D1.prepare(sql).bind(title, contents, mustRead, idx);
  await env.D1.batch([statement]);

  return new Response("Success", { status: 200 });
}

/**
 * 공지사항 삭제
 * @param {number} idx 공지사항 ID
 * @param {*} env workers 환경
 * @returns
 */
export async function deleteNotice(idx, env) {
  const sql = `DELETE FROM Notices WHERE idx = ?`;
  const statement = env.D1.prepare(sql).bind(idx);
  await env.D1.batch([statement]);

  return new Response("Success", { status: 200 });
}
