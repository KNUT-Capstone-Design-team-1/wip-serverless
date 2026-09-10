import wordData from "../words.js";
import { decodeAndValidateCursor } from "./cursor.js";

const STOP_WORDS = new Set(wordData.stoppedWords.map((w) => w.toLowerCase()));
const BANNED_WORDS = new Set(wordData.bannedWords.map((w) => w.toLowerCase()));

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

const MIN_KEYWORDS_COUNT = 1;
const MAX_KEYWORDS_COUNT = 5;

const MAX_RAW_INPUT = 50;
const MAX_TOKENS = 5;
const MIN_ENG_TOKENS = 3;

/**
 * URI 컴포넌트 디코딩
 * @param {string} keyword 대상 키워드
 * @returns {string|null}
 */
function getDecodedURIComponent(keyword) {
  try {
    return decodeURIComponent(keyword);
  } catch {
    return null;
  }
}

/**
 * 단일 키워드 유효성 검증 및 토큰 추출
 * @param {string} normalizedKeyword
 * @returns {{ valid: boolean, reason?: string, tokens?: string[] }}
 */
function validateKeywordTokens(normalizedKeyword) {
  const isNotString = typeof normalizedKeyword !== "string";

  if (isNotString) {
    return { valid: false, reason: "문자열만 허용됩니다." };
  }

  const isEmpty = normalizedKeyword.length === 0;

  if (isEmpty) {
    return { valid: false, reason: "값이 비어 있습니다." };
  }

  const hasEdgeSpaces = normalizedKeyword !== normalizedKeyword.trim();

  if (hasEdgeSpaces) {
    return { valid: false, reason: "앞뒤 공백은 허용되지 않습니다." };
  }

  const hasConsecutiveSpaces = /\s{2,}/.test(normalizedKeyword);

  if (hasConsecutiveSpaces) {
    return { valid: false, reason: "연속 공백은 허용되지 않습니다." };
  }

  const hasInvalidCharacters = !/^[A-Za-z가-힣\s]+$/.test(normalizedKeyword);

  if (hasInvalidCharacters) {
    return { valid: false, reason: "한글과 영어만 입력 가능합니다." };
  }

  const isExceedingMaxLength = normalizedKeyword.length > MAX_RAW_INPUT;

  if (isExceedingMaxLength) {
    return {
      valid: false,
      reason: `검색어는 ${MAX_RAW_INPUT}자 이하로 입력해주세요.`,
    };
  }

  const tokens = normalizedKeyword
    .split(/\s+/)
    .filter((t) => !STOP_WORDS.has(t));

  const hasNoMeaningfulTokens = tokens.length === 0;

  if (hasNoMeaningfulTokens) {
    return { valid: false, reason: "의미 있는 검색어를 입력해주세요." };
  }

  const isExceedingTokenLimit = tokens.length > MAX_TOKENS;

  if (isExceedingTokenLimit) {
    return {
      valid: false,
      reason: `검색어는 최대 ${MAX_TOKENS}개 단어까지 입력 가능합니다.`,
    };
  }

  const hasDuplicateTokens = new Set(tokens).size !== tokens.length;

  if (hasDuplicateTokens) {
    return { valid: false, reason: "동일 단어를 반복할 수 없습니다." };
  }

  const isAllBannedWords = tokens.every((t) => BANNED_WORDS.has(t));

  if (isAllBannedWords) {
    return { valid: false, reason: "너무 일반적인 검색어입니다." };
  }

  for (const token of tokens) {
    const isRepeatedChar = /^(.)\1+$/.test(token);

    if (isRepeatedChar) {
      return { valid: false, reason: "의미 있는 검색어를 입력해주세요." };
    }

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
    Number.isNaN(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT;

  if (isInvalidLimit) {
    return {
      valid: false,
      reason: "Invalid limit. It must be an integer between 1 and 50.",
    };
  }

  const hasNoKeywords = !keywords || keywords.length < MIN_KEYWORDS_COUNT;

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

  const decodedKeywords = [];

  for (const keyword of keywords) {
    const decoded = getDecodedURIComponent(keyword);

    const isInvalidEncoding = decoded === null;

    if (isInvalidEncoding) {
      return { valid: false, reason: "잘못된 인코딩입니다." };
    }

    decodedKeywords.push(decoded);
  }

  const normalizedKeywords = decodedKeywords.map((k) =>
    k.normalize("NFC").trim().toLowerCase(),
  );

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
