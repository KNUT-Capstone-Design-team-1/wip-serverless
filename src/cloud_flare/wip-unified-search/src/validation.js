import wordData from "../words.js";
import { decodeAndValidateCursor } from "./cursor.js";
import {
  MIN_LIMIT,
  MIN_KEYWORDS_COUNT,
  MAX_KEYWORDS_COUNT,
  MAX_RAW_INPUT,
  MAX_TOKENS,
  MIN_ENG_TOKENS,
  VALID_CHARACTERS_REGEX,
} from "./constants.js";

const STOP_WORDS = new Set(wordData.stoppedWords.map((w) => w.toLowerCase()));
const BANNED_WORDS = new Set(wordData.bannedWords.map((w) => w.toLowerCase()));

/**
 * URI 컴포넌트 디코딩
 * @param {string} keyword 대상 키워드
 * @returns {string|null}
 */
function getDecodedURIComponent(keyword) {
  if (typeof keyword !== "string") {
    return null;
  }

  try {
    return decodeURIComponent(keyword);
  } catch {
    return keyword;
  }
}

/**
 * 단일 키워드 유효성 검증 및 토큰 추출
 * @param {string} normalizedKeyword
 * @returns {{ valid: boolean, reason?: string, tokens?: string[] }}
 */
function validateKeywordTokens(normalizedKeyword) {
  if (!normalizedKeyword || normalizedKeyword.length === 0) {
    return { valid: false, reason: "값이 비어 있습니다." };
  }

  if (normalizedKeyword.length > MAX_RAW_INPUT) {
    return {
      valid: false,
      reason: `검색어는 ${MAX_RAW_INPUT}자 이하로 입력해주세요.`,
    };
  }

  if (!VALID_CHARACTERS_REGEX.test(normalizedKeyword)) {
    return {
      valid: false,
      reason: "허용되지 않는 특수문자가 포함되어 있습니다.",
    };
  }

  const tokens = normalizedKeyword
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  if (tokens.length === 0) {
    return { valid: false, reason: "의미 있는 검색어를 입력해주세요." };
  }

  if (tokens.length > MAX_TOKENS) {
    return {
      valid: false,
      reason: `검색어는 최대 ${MAX_TOKENS}개 단어까지 입력 가능합니다.`,
    };
  }

  if (new Set(tokens).size !== tokens.length) {
    return { valid: false, reason: "동일 단어를 반복할 수 없습니다." };
  }

  if (tokens.every((t) => BANNED_WORDS.has(t))) {
    return { valid: false, reason: "너무 일반적인 검색어입니다." };
  }

  for (const token of tokens) {
    const isShortEnglishToken =
      /^[a-z]+$/.test(token) && token.length < MIN_ENG_TOKENS;

    if (isShortEnglishToken) {
      return {
        valid: false,
        reason: `영어 검색어는 최소 ${MIN_ENG_TOKENS}글자 이상 입력해주세요.`,
      };
    }
  }

  return { valid: true, tokens };
}

/**
 * 요청 밸리데이션
 * @param {string[]} keywords 검색 키워드 목록
 * @param {number} limit 검색 결과 최대 개수
 * @param {string|null} [cursor=null] 페이지네이션 커서
 * @returns {{ valid: boolean, reason?: string, finalTokens?: string[], canonicalQuery?: string, cursorData?: Object|null }}
 */
function validate(keywords, limit, cursor = null) {
  const isInvalidLimit =
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < MIN_LIMIT;

  if (isInvalidLimit) {
    return {
      valid: false,
      reason: `Invalid limit. It must be an integer greater than or equal to ${MIN_LIMIT}.`,
    };
  }

  const hasNoKeywords =
    !Array.isArray(keywords) || keywords.length < MIN_KEYWORDS_COUNT;

  if (hasNoKeywords) {
    return { valid: false, reason: "검색어는 최소 1개 이상 필요합니다." };
  }

  const isExceedingKeywordCount = keywords.length > MAX_KEYWORDS_COUNT;

  if (isExceedingKeywordCount) {
    return {
      valid: false,
      reason: `검색어는 최대 ${MAX_KEYWORDS_COUNT}개까지 입력 가능합니다.`,
    };
  }

  const normalizedKeywords = [];

  for (const keyword of keywords) {
    const decoded = getDecodedURIComponent(keyword);

    if (decoded === null) {
      return { valid: false, reason: "잘못된 인코딩입니다." };
    }

    normalizedKeywords.push(decoded.normalize("NFC").trim().toLowerCase());
  }

  const hasDuplicateKeywords =
    new Set(normalizedKeywords).size !== normalizedKeywords.length;

  if (hasDuplicateKeywords) {
    return { valid: false, reason: "동일한 검색어를 반복할 수 없습니다." };
  }

  const finalTokens = [];

  for (const normalizedKeyword of normalizedKeywords) {
    const keywordValidation = validateKeywordTokens(normalizedKeyword);

    if (!keywordValidation.valid) {
      return { valid: false, reason: keywordValidation.reason };
    }

    finalTokens.push(...keywordValidation.tokens);
  }

  const canonicalQuery = finalTokens.join(" ");

  const hasCursor = Boolean(cursor);

  if (!hasCursor) {
    return {
      valid: true,
      reason: "",
      finalTokens,
      canonicalQuery,
      cursorData: null,
    };
  }

  const cursorResult = decodeAndValidateCursor(cursor, canonicalQuery, limit);

  if (!cursorResult.valid) {
    return { valid: false, reason: cursorResult.reason };
  }

  return {
    valid: true,
    reason: "",
    finalTokens,
    canonicalQuery,
    cursorData: cursorResult.data,
  };
}

export default validate;
