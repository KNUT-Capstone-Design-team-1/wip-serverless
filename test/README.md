# 성능·캐시 검증

```sh
node --test test/performance.test.cjs
node --experimental-default-type=module --test test/cloudflare_auth.test.mjs src/cloud_flare/wip-notice/test/admin.test.js src/cloud_flare/wip-notice/test/notices.test.js src/cloud_flare/wip-unified-search/test/search_query.test.js
```

첫 명령은 Node 내장 모듈만 사용합니다. 프레임워크와 외부 API는 테스트 대역으로
교체하며, JSON 압축·해제, 해시 계산, 캐시 만료와 요청 공유는 실제 구현으로 검증합니다.
두 번째 명령은 `node:sqlite`와 FTS5를 제공하는 Node.js에서 실행합니다.
실제 D1/GCS/Gemini/API의 지연 시간과 배포 환경에서의 HTTP 전송은 별도 확인이 필요합니다.

통합 검색 v2의 deployer SQL·문서 실패·재시도 검증은 다음으로 실행합니다.
읽기 전용 `C:/project/wip-resource-deployer`에 설치된 TypeScript를 사용합니다.
다른 위치에서는 `WIP_DEPLOYER_ROOT`를 설정합니다.

```sh
node changes/validate-search-v2.cjs
node --test test/search_v2_deployer.test.cjs
```

새 Worker 배포 전에 [검색 v2 적용 가이드](../changes/SEARCH_V2_GUIDE.md)의
deployer 패치 적용, 스키마 생성, 백필, 검증을 먼저 완료해야 합니다.

## 적용 동작

- `wip-pill-detail`: 성공 응답을 품목 코드별로 최대 1일 저장합니다. 장애 안내
  응답은 저장하지 않습니다. 대체 API 3개는 병렬 호출하고 각 요청 제한 시간은
  8초입니다. HTTP 연결과 진행 중인 동일 품목 요청을 재사용합니다.
- `wip-pill-image-feature-extraction`: 앞·뒷면 이미지 바이트와 순서, 모델, 프롬프트
  버전으로 SHA-256 키를 생성합니다. 같은 사진의 응답만 최대 1일 재사용하며,
  서로 다른 사진이나 앞·뒷면 순서가 바뀐 요청은 구분합니다. JPEG/PNG/WebP/HEIC/HEIF를
  판별하고 이미지 한 장당 10 MiB까지 받습니다. POST는 본문을 HTTP 캐시 키로
  사용하지 않으므로 서버에서 사진 해시로 캐싱합니다.
- 위 두 캐시는 인스턴스 메모리 안에서만 공유됩니다. 상세정보는 최대 500개·8 MiB,
  이미지 분석은 최대 500개·4 MiB의 응답 본문을 보관하며 원본 사진은 보관하지
  않습니다. 재시작·퇴거 시 다시 조회합니다. 응답은 인증이 필요하므로
  `private, max-age=86400`을 사용하고, 캐시 적중 시 남은 TTL만 전달합니다.
- `wip-resource-data`: 파일 다운로드를 공유하며 5분간 재사용합니다. 파일 캐시는
  최대 10개·원본 크기 기준 약 64 MiB(파싱 객체 크기는 추정), 직렬화된 페이지는
  최대 32개·16 MiB입니다. 각 페이지의 압축 결과도 재사용합니다.
- `wip-table-schema`: 인스턴스 시작 시 JSON을 한 번 직렬화하고 요청된 압축
  결과를 재사용합니다.
- 리소스·스키마는 `Accept-Encoding`에 맞춰 Brotli 품질 11, gzip/deflate 레벨 9를
  비동기로 생성합니다. `Vary: Accept-Encoding`과 ETag/304를 지원하고 JSON
  구조는 유지합니다. 최고 압축은 최초 요청의 CPU 비용이 더 높을 수 있습니다.
- 일곱 GCP 함수의 RSA 키 파일 읽기와 키 파싱은 인스턴스당 한 번만 수행합니다.
  키 교체 후에는 인스턴스를 재시작해야 합니다.
- 두 Cloudflare Worker는 HMAC 키와 진행 중인 키 import를 재사용하고 시크릿이
  바뀌면 새 키를 사용합니다. 검증 결과는 저장하지 않고 요청마다 서명과 만료를
  검사합니다. 두 플랫폼 모두 서버보다 30초 이상 미래인 토큰을 거부합니다.
  10분 유효기간과 기존 토큰 형식은 유지합니다.

공지 KV 바인딩은 `WIP_NOTICE`이며 기존 `WIP_NOTICCE`도 지원합니다.
[공지 관리자 권한 가이드](../src/cloud_flare/wip-notice/ADMIN_GUIDE.md)에서
별도 관리자 Secret과 `x-admin-token` 설정을 확인할 수 있습니다.
[공지 인덱스 SQL](../src/cloud_flare/wip-notice/migrations/0001_notice_query_indexes.sql)은
배포 대상 D1에 한 번 적용합니다.

## 기존 코드와의 비교

기준 커밋 `37dd144`를 불러와 정상 인증·만료 판정, 스키마 10종, 리소스 페이징,
상세·이미지 응답과 Gemini 요청 구성 등 64개 입력의 변경 전후 결과를 비교했습니다.
정상 경로의 결과는 모두 일치했습니다. 외부 라이브러리·API는 대역을 사용한 비교이며,
실제 서버나 배포 환경에 대한 통합 검증은 아닙니다.

회귀 점검에서 리소스의 0·음수 페이지/크기 보정과 저장소 장애 메시지를 복원했고,
통합 검색의 손상된 KV JSON은 DB 재조회로 처리하도록 보완했습니다.
인증 예외를 `false`로 처리하고 과도한 미래 토큰을 거부하는 변경은 의도한 검증 강화입니다.
잘못된 토큰 때문에 500이 발생하던 경로는 401로 처리합니다.

관련 사양: [Node.js zlib](https://nodejs.org/api/zlib.html),
[Express 응답 협상](https://expressjs.com/en/4x/api.html#req.acceptsEncodings),
[D1 배치](https://developers.cloudflare.com/d1/reference/faq/),
[SQLite row value](https://www.sqlite.org/rowvalue.html),
[Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
[Gemini 이미지 형식](https://ai.google.dev/gemini-api/docs/image-understanding).
