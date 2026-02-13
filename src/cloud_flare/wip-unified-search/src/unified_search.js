const LIMIT = 30;

/**
 * FTS5 안전 토큰 이스케이프
 * @param {string} token 토큰
 * @returns
 */
function escapeFtsToken(token) {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * MATCH 쿼리 문자열 생성
 * @param {string[]} keywords 검색 키워드 목록
 * @returns
 */
function buildMatchQuery(keywords) {
  if (!keywords || keywords.length === 0) {
    return null;
  }

  const escaped = keywords.map(escapeFtsToken);

  return escaped.map((v) => `${v}*`).join(` AND `);
}

/**
 * unified_search 조회
 * @param {Object} db 데이터베이스 객체
 * @param {string[]} keywords 검색 키워드 목록
 */
export async function searchUnified(db, keywords) {
  const matchQuery = buildMatchQuery(keywords);

  if (!matchQuery) {
    return new Response("유효하지 않은 검색어 입니다.", { status: 400 });
  }

  const sql = `
   SELECT u.ITEM_SEQ
   FROM unified_search_fts AS u
   WHERE u MATCH ?
   ORDER BY bm25(u) ASC
   LIMIT ?
  `;

  const { results } = await db.prepare(sql).bind(matchQuery, LIMIT).all();

  return results;
}
