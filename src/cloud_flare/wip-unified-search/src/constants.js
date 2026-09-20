export const DEFAULT_LIMIT = 300;
export const MIN_LIMIT = 50;

export const MIN_KEYWORDS_COUNT = 1;
export const MAX_KEYWORDS_COUNT = 5;

export const MAX_RAW_INPUT = 50;
export const MAX_TOKENS = 5;
export const MIN_ENG_TOKENS = 1;

// 한글, 영문, 숫자, 공백 및 지정된 특수문자({}, (), [], <>, \, /, -, _, %, ., ,) 허용 정규식
export const VALID_CHARACTERS_REGEX =
  /^[A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\s{}()[\]<>\\/\-_%.,]+$/;

export const TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10분
