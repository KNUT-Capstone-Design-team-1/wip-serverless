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

  // 1글자 단어는 불필요한 대량 스캔을 방지하기 위해 완전일치, 2글자 이상은 prefix 매칭
  const escapedTokens = keywords.map((token) => {
    const escaped = escapeFtsToken(token);
    const isSingleChar = token.length === 1;

    if (isSingleChar) {
      return escaped;
    }

    return `${escaped}*`;
  });

  return escapedTokens.join(" AND ");
}

/**
 * SQL 및 파라미터 빌더 (FTS5 rank 최적화 + 2단계 서브쿼리 JOIN)
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
        matched.score,
        matched.row_id
      FROM (
        SELECT
          unified_search_fts.rowid AS row_id,
          rank AS score
        FROM unified_search_fts
        WHERE unified_search_fts MATCH ?
          AND (
            rank > ?
            OR (rank = ? AND unified_search_fts.rowid > ?)
          )
        ORDER BY
          rank ASC,
          unified_search_fts.rowid ASC
        LIMIT ?
      ) AS matched
      JOIN unified_search ON unified_search.rowid = matched.row_id
      ORDER BY
        matched.score ASC,
        matched.row_id ASC;
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
      matched.score,
      matched.row_id
    FROM (
      SELECT
        unified_search_fts.rowid AS row_id,
        rank AS score
      FROM unified_search_fts
      WHERE unified_search_fts MATCH ?
      ORDER BY
        rank ASC,
        unified_search_fts.rowid ASC
      LIMIT ?
    ) AS matched
    JOIN unified_search ON unified_search.rowid = matched.row_id
    ORDER BY
      matched.score ASC,
      matched.row_id ASC;
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
 * @returns {Promise<{ results: string[], nextCursor: string|null, hasMore: boolean }>}
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
    nextCursor,
    hasMore,
  };
}

