export const SEARCH_VERSION = "v4";

/**
 * UTF-8 문자열을 Base64로 인코딩
 * @param {string} str
 * @returns {string}
 */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);

  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**
 * Base64 문자열을 UTF-8 문자열로 디코딩
 * @param {string} base64
 * @returns {string}
 */
function fromBase64(base64) {
  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Cursor JSON 파싱 헬퍼 함수
 * @param {string} cursorStr
 * @returns {Object|null}
 */
function parseCursorPayload(cursorStr) {
  try {
    const jsonStr = fromBase64(cursorStr);

    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Cursor 생성 함수
 * @param {Object} params
 * @param {string} params.canonicalQuery
 * @param {number} params.limit
 * @param {number} params.score
 * @param {number} params.rowid
 * @returns {string}
 */
export function encodeCursor({ canonicalQuery, limit, score, rowid }) {
  const payload = {
    v: SEARCH_VERSION,
    q: canonicalQuery,
    l: limit,
    b: score,
    r: rowid,
  };

  const jsonString = JSON.stringify(payload);

  return toBase64(jsonString);
}

/**
 * Cursor 디코딩 및 유효성 검증 함수
 * @param {string} cursorStr
 * @param {string} canonicalQuery
 * @param {number} limit
 * @returns {{ valid: boolean, reason?: string, data?: { score: number, rowid: number } }}
 */
export function decodeAndValidateCursor(cursorStr, canonicalQuery, limit) {
  const isCursorMissing = !cursorStr || typeof cursorStr !== "string";

  if (isCursorMissing) {
    return { valid: false, reason: "Cursor가 비어 있습니다." };
  }

  const parsed = parseCursorPayload(cursorStr);

  const isPayloadInvalid = !parsed || typeof parsed !== "object";

  if (isPayloadInvalid) {
    return { valid: false, reason: "잘못된 Cursor 형식입니다." };
  }

  const isVersionMismatch = parsed.v !== SEARCH_VERSION;

  if (isVersionMismatch) {
    return { valid: false, reason: "지원되지 않는 Cursor 버전입니다." };
  }

  const isQueryMismatch = parsed.q !== canonicalQuery;

  if (isQueryMismatch) {
    return { valid: false, reason: "검색어가 변경되어 Cursor를 사용할 수 없습니다." };
  }

  const isLimitMismatch = parsed.l !== limit;

  if (isLimitMismatch) {
    return { valid: false, reason: "limit이 변경되어 Cursor를 사용할 수 없습니다." };
  }

  const isScoreInvalid = typeof parsed.b !== "number" || Number.isNaN(parsed.b);

  if (isScoreInvalid) {
    return { valid: false, reason: "Cursor의 점수 정보가 유효하지 않습니다." };
  }

  const isRowidInvalid = typeof parsed.r !== "number" || Number.isNaN(parsed.r);

  if (isRowidInvalid) {
    return { valid: false, reason: "Cursor의 rowid 정보가 유효하지 않습니다." };
  }

  return {
    valid: true,
    data: {
      score: parsed.b,
      rowid: parsed.r,
    },
  };
}
