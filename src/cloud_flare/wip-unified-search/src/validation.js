import wordData from "../words.js";

const STOP_WORDS = new Set(wordData.stoppedWords.map((w) => w.toLowerCase()));
const BANNED_WORDS = new Set(wordData.bannedWords.map((w) => w.toLowerCase()));

const MAX_KEYWORDS = 5;
const MIN_RAW_INPUT = 3;
const MAX_RAW_INPUT = 50;
const MIN_TOKENS = 2;
const MAX_TOKENS = 5;
const MIN_ENG_TOKENS = 3;

/**
 * URI 컴포넌트 디코딩
 * @param {string} keyword 대상 키워드
 * @returns
 */
function getDecodedURIComponent(keyword) {
  try {
    const result = decodeURIComponent(keyword);
    return result;
  } catch {
    return null;
  }
}

/**
 * 요청 밸리데이션
 * @param {string[]} keywords 검색 키워드 목록
 * @returns
 */
function validate(keywords) {
  if (!keywords || keywords.length === 0) {
    return { valid: false, reason: "keyword는 최소 1개 이상 필요합니다." };
  }

  if (keywords.length > MAX_KEYWORDS) {
    return {
      valid: false,
      reason: `검색어는 최대 ${MAX_KEYWORDS}개까지 입력 가능합니다.`,
    };
  }

  const decodedKeywords = [];
  const finalTokens = [];

  for (const keyword of keywords) {
    const decoded = getDecodedURIComponent(keyword);

    if (decoded === null) {
      return { valid: false, reason: "잘못된 인코딩입니다." };
    }

    decodedKeywords.push(decoded);
  }

  const normalizedKeywords = decodedKeywords.map((k) =>
    k.normalize("NFC").trim().toLowerCase(),
  );

  if (new Set(normalizedKeywords).size !== normalizedKeywords.length) {
    return { valid: false, reason: "동일한 검색어를 반복할 수 없습니다." };
  }

  for (const rawInput of normalizedKeywords) {
    if (typeof rawInput !== "string") {
      return { valid: false, reason: "문자열만 허용됩니다." };
    }

    if (rawInput.length === 0) {
      return { valid: false, reason: "값이 비어 있습니다." };
    }

    if (rawInput !== rawInput.trim()) {
      return { valid: false, reason: "앞뒤 공백은 허용되지 않습니다." };
    }

    if (/\s{2,}/.test(rawInput)) {
      return { valid: false, reason: "연속 공백은 허용되지 않습니다." };
    }

    if (!/^[A-Za-z가-힣\s]+$/.test(rawInput)) {
      return { valid: false, reason: "한글과 영어만 입력 가능합니다." };
    }

    if (rawInput.length < MIN_RAW_INPUT) {
      return { valid: false, reason: "검색어가 너무 짧습니다." };
    }

    if (rawInput.length > MAX_RAW_INPUT) {
      return {
        valid: false,
        reason: `검색어는 ${MAX_RAW_INPUT}자 이하로 입력해주세요.`,
      };
    }

    const tokens = rawInput.split(/\s+/).filter((t) => !STOP_WORDS.has(t));

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
      return {
        valid: false,
        reason: "동일 단어를 반복할 수 없습니다.",
      };
    }

    if (tokens.every((t) => BANNED_WORDS.has(t))) {
      return { valid: false, reason: "너무 일반적인 검색어입니다." };
    }

    for (const token of tokens) {
      if (/^(.)\1+$/.test(token)) {
        return { valid: false, reason: "의미 있는 검색어를 입력해주세요." };
      }

      if (token.length < MIN_TOKENS) {
        return {
          valid: false,
          reason: `각 단어는 ${MIN_TOKENS}글자 이상이어야 합니다.`,
        };
      }

      if (/^[a-z]+$/.test(token) && token.length < MIN_ENG_TOKENS) {
        return {
          valid: false,
          reason: `영어 검색어는 최소 ${MIN_ENG_TOKENS}글자 이상 입력해주세요.`,
        };
      }
    }

    finalTokens.push(...tokens);
  }

  return { valid: true, reason: "", tokens: [...new Set(finalTokens)] };
}

export default validate;
