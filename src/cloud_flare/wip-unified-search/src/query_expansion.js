import wordData from "../words.js";

const SUFFIXES = ["시럽", "약"];
const GENERIC_WORDS = new Set([
  ...wordData.stoppedWords,
  ...wordData.queryWords,
  ...wordData.bannedWords,
]);
const SYNONYMS = new Map(
  wordData.synonymGroups.flatMap((group) =>
    group.map((word) => [word, group]),
  ),
);

/** 원문을 보존하면서 붙여 쓴 검색 대상 표현과 동의어를 확장한다. */
export function expandSearchToken(token) {
  const variants = new Set([token]);
  for (const suffix of SUFFIXES) {
    if (!token.endsWith(suffix)) continue;

    const stem = token.slice(0, -suffix.length);
    // 생약/한약/마약 같은 단어를 한 글자로 잘라 검색 범위를 넓히지 않는다.
    if (/^[가-힣]{2,}$/.test(stem) && !GENERIC_WORDS.has(stem)) {
      variants.add(stem);
    }
    break;
  }

  for (const variant of [...variants]) {
    for (const synonym of SYNONYMS.get(variant) || []) {
      variants.add(synonym);
    }
  }
  return [...variants];
}
