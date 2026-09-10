import { encodeCursor } from "./cursor.js";

/**
 * FTS5 안전 토큰 이스케이프
 * @param {string} token 토큰
 * @returns {string}
 */
function escapeFtsToken(token) {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * MATCH 쿼리 문자열 생성
 * @param {string[]} keywords 검색 키워드 목록
 * @returns {string|null}
 */
function buildMatchQuery(keywords) {
  const isKeywordsEmpty = !keywords || keywords.length === 0;

  if (isKeywordsEmpty) {
    return null;
  }

  const escapedTokens = keywords.map(escapeFtsToken);

  return escapedTokens.map((v) => `${v}*`).join(" AND ");
}

/**
 * SQL 및 파라미터 빌더
 * @param {string} matchQuery
 * @param {number} fetchLimit
 * @param {{ score: number, rowid: number }|null} cursorData
 * @returns {{ sql: string, params: Array<string|number> }}
 */
function buildSearchQueryAndParams(matchQuery, fetchLimit, cursorData) {
  const hasCursor = Boolean(cursorData);

  if (hasCursor) {
    const sqlWithCursor = `
      SELECT
        unified_search.ITEM_SEQ,
        bm25(unified_search_fts) AS score,
        unified_search_fts.rowid AS row_id
      FROM unified_search_fts
      JOIN unified_search ON unified_search.rowid = unified_search_fts.rowid
      WHERE unified_search_fts MATCH ?
        AND (
          bm25(unified_search_fts) > ?
          OR (bm25(unified_search_fts) = ? AND unified_search_fts.rowid > ?)
        )
      ORDER BY
        bm25(unified_search_fts) ASC,
        unified_search_fts.rowid ASC
      LIMIT ?;
    `;

    const paramsWithCursor = [
      matchQuery,
      cursorData.score,
      cursorData.score,
      cursorData.rowid,
      fetchLimit,
    ];

    return { sql: sqlWithCursor, params: paramsWithCursor };
  }

  const sqlWithoutCursor = `
    SELECT
      unified_search.ITEM_SEQ,
      bm25(unified_search_fts) AS score,
      unified_search_fts.rowid AS row_id
    FROM unified_search_fts
    JOIN unified_search ON unified_search.rowid = unified_search_fts.rowid
    WHERE unified_search_fts MATCH ?
    ORDER BY
      bm25(unified_search_fts) ASC,
      unified_search_fts.rowid ASC
    LIMIT ?;
  `;

  const paramsWithoutCursor = [matchQuery, fetchLimit];

  return { sql: sqlWithoutCursor, params: paramsWithoutCursor };
}

/**
 * Next Cursor 생성
 * @param {boolean} hasMore
 * @param {Array<Object>} items
 * @param {string} canonicalQuery
 * @param {number} limit
 * @returns {string|null}
 */
function generateNextCursor(hasMore, items, canonicalQuery, limit) {
  const canGenerateCursor = hasMore && items.length > 0;

  if (!canGenerateCursor) {
    return null;
  }

  const lastItem = items[items.length - 1];

  return encodeCursor({
    canonicalQuery,
    limit,
    score: lastItem.score,
    rowid: lastItem.row_id,
  });
}

/**
 * unified_search 조회 (FTS5 + Cursor 기반 페이지네이션)
 * @param {Object} db D1 데이터베이스 객체
 * @param {Object} options 검색 옵션
 * @param {string[]} options.keywords 검색 키워드 목록
 * @param {string} options.canonicalQuery 정규화된 쿼리 문자열
 * @param {number} [options.limit=30] 최대 검색 결과 개수
 * @param {{ score: number, rowid: number }|null} [options.cursorData=null] 커서 정보
 * @returns {Promise<{ results: string[], items: string[], nextCursor: string|null, hasMore: boolean }>}
 */
export async function searchUnified(
  db,
  { keywords, canonicalQuery, limit = 30, cursorData = null },
) {
  const matchQuery = buildMatchQuery(keywords);

  const isInvalidMatchQuery = !matchQuery;

  if (isInvalidMatchQuery) {
    throw new Error("유효하지 않은 검색어 입니다.");
  }

  const fetchLimit = limit + 1;

  const { sql, params } = buildSearchQueryAndParams(
    matchQuery,
    fetchLimit,
    cursorData,
  );

  const queryResult = await db.prepare(sql).bind(...params).all();

  const rawRows = queryResult.results || [];

  const hasMore = rawRows.length > limit;

  const items = hasMore ? rawRows.slice(0, limit) : rawRows;

  const nextCursor = generateNextCursor(hasMore, items, canonicalQuery, limit);

  const itemSeqs = items.map((row) => row.ITEM_SEQ);

  return {
    results: itemSeqs,
    items: itemSeqs,
    nextCursor,
    hasMore,
  };
}
