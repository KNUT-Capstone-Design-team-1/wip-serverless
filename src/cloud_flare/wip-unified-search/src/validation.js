import wordData from "../words.js";
import { decodeAndValidateCursor } from "./cursor.js";
import {
  MIN_LIMIT,
  MAX_LIMIT,
  MIN_KEYWORDS_COUNT,
  MAX_KEYWORDS_COUNT,
  MAX_RAW_INPUT,
  MAX_TOKENS,
  VALID_CHARACTERS_REGEX,
} from "./constants.js";

const STOP_WORDS = new Set([...wordData.stoppedWords, ...wordData.queryWords]);
const BANNED_WORDS = new Set(wordData.bannedWords);

/** URLSearchParams로 이미 디코딩한 입력을 deployer와 같은 단위로 토큰화한다. */
export default function validate(
  keywords,
  limit,
  cursor = null,
  dataVersion = "default",
) {
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    return {
      valid: false,
      reason: `limit은 ${MIN_LIMIT}~${MAX_LIMIT} 사이의 정수여야 합니다.`,
    };
  }
  if (!Array.isArray(keywords) || keywords.length < MIN_KEYWORDS_COUNT) {
    return { valid: false, reason: "검색어는 최소 1개 이상 필요합니다." };
  }
  if (keywords.length > MAX_KEYWORDS_COUNT) {
    return {
      valid: false,
      reason: `검색어는 최대 ${MAX_KEYWORDS_COUNT}개까지 입력 가능합니다.`,
    };
  }

  const tokens = [];
  for (const keyword of keywords) {
    if (typeof keyword !== "string" || !keyword.trim()) {
      return { valid: false, reason: "값이 비어 있습니다." };
    }
    const normalized = keyword.normalize("NFC").trim().toLowerCase();
    if (normalized.length > MAX_RAW_INPUT) {
      return {
        valid: false,
        reason: `검색어는 ${MAX_RAW_INPUT}자 이하로 입력해주세요.`,
      };
    }
    if (!VALID_CHARACTERS_REGEX.test(normalized)) {
      return {
        valid: false,
        reason: "허용되지 않는 특수문자가 포함되어 있습니다.",
      };
    }
    tokens.push(
      ...normalized
        .replace(/[^ㄱ-ㅎ가-힣a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token && !STOP_WORDS.has(token)),
    );
  }

  // AND 조건은 입력 순서/중복과 무관하다. 캐시와 커서도 같은 키를 사용한다.
  const finalTokens = [...new Set(tokens)].sort();
  if (!finalTokens.length) {
    return { valid: false, reason: "의미 있는 검색어를 입력해주세요." };
  }
  if (finalTokens.length > MAX_TOKENS) {
    return {
      valid: false,
      reason: `검색어는 전체 ${MAX_TOKENS}개 단어까지 입력 가능합니다.`,
    };
  }
  if (finalTokens.every((token) => BANNED_WORDS.has(token))) {
    return { valid: false, reason: "너무 일반적인 검색어입니다." };
  }

  const canonicalQuery = finalTokens.join(" ");
  let cursorData = null;
  if (cursor) {
    const result = decodeAndValidateCursor(
      cursor,
      canonicalQuery,
      limit,
      dataVersion,
    );
    if (!result.valid) return { valid: false, reason: result.reason };
    cursorData = result.data;
  }
  return { valid: true, reason: "", finalTokens, canonicalQuery, cursorData };
}
