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

  const payload = await request.json();
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
  const statement = env.D1.prepare(sql).bind(title, contents, mustRead);
  await env.D1.batch([statement]);

  return new Response("Created", { status: 201 });
}

/**
 * 공지사항 목록 조회
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경
 * @returns
 */
export async function readNotices(request, env) {
  const queryParams = new URL(request.url).searchParams;

  const mustRead = queryParams.get("mustRead") || null;
  const skip = queryParams.get("skip") || 0;
  const limit = parseInt(queryParams.get("limit"), 10) || 10;

  if (limit > 10) {
    return new Response("Content Too Large", { status: 413 });
  }

  const sql = `SELECT idx, title, contents, mustRead, createDate, updateDate
                 FROM Notices
                 ${mustRead ? "WHERE mustRead = 1" : ""}
                 ORDER BY idx LIMIT ?,?`;
  const statement = env.D1.prepare(sql).bind(skip, limit);
  const notices = (await env.D1.batch([statement]))?.[0]?.results;

  const countSql = `SELECT COUNT(idx) AS cnt FROM Notices ${mustRead ? "WHERE mustRead = 1" : ""}`;
  const countStatement = env.D1.prepare(countSql);
  const total = (await env.D1.batch([countStatement]))?.[0]?.results?.[0]?.cnt;

  return Response.json({ success: true, notices, total });
}
