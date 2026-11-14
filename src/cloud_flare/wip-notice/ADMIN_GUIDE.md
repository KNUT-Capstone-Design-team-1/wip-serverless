# 공지사항 관리자 권한 가이드

## 권한 구조

공지 조회는 기존 `SECRET_KEY` 인증을 사용합니다. 생성·수정·삭제에는 별도로
`ADMIN_SECRET_KEY`로 서명한 토큰이 필요합니다.

| 요청 | 일반 인증 헤더 | 관리자 인증 헤더 |
| --- | --- | --- |
| `GET /notices` | `x-auth-token` 필요 | 불필요 |
| `POST /notices` | `x-auth-token` 필요 | `x-admin-token` 필요 |
| `PUT /notices/{idx}` | `x-auth-token` 필요 | `x-admin-token` 필요 |
| `DELETE /notices/{idx}` | `x-auth-token` 필요 | `x-admin-token` 필요 |

`POST /notices/`도 같은 관리자 검사를 적용합니다. 본문이나 URL에
`role=admin`, `admin=true`를 넣는 것으로는 권한을 얻을 수 없습니다.
권한 검사는 본문 파싱과 D1/KV 접근 전에 실행됩니다.

이 방식은 관리자 도구를 위한 별도 자격 증명입니다. 관리자별 계정·로그인·역할 관리나
SSO는 포함하지 않습니다.

## 1. 관리자 Secret 준비

`ADMIN_SECRET_KEY`에는 일반 앱의 `SECRET_KEY`와 다른 무작위 값을 사용합니다.
코드는 최소 32 UTF-8 바이트를 요구합니다. 다음 명령으로 32바이트 난수의
Base64URL 문자열을 생성할 수 있습니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

생성한 값은 비밀 저장소에 보관하고, 일반 사용자 앱·브라우저 코드·Git·공유 로그에
넣지 않습니다. 관리자 토큰은 신뢰할 수 있는 서버나 관리자 PC에서만 생성합니다.

## 2. Cloudflare에 등록하고 코드 배포

Cloudflare Dashboard에서 대상 Worker `wip-notice`의 Settings → Variables and Secrets에
다음 값을 **Secret**으로 등록합니다.

| 이름 | 값 |
| --- | --- |
| `SECRET_KEY` | 기존 조회용 값 유지 |
| `ADMIN_SECRET_KEY` | 새로 생성한 관리자용 값 |

Wrangler를 사용하는 환경에서는 대상 계정과 Worker 이름을 확인한 뒤 등록할 수 있습니다.
값은 명령 인수가 아닌 대화형 입력으로 전달합니다.

```powershell
npx wrangler secret put ADMIN_SECRET_KEY --name wip-notice
```

등록 후 권한 분리 코드가 포함된 Worker를 기존 배포 방식으로 배포합니다. 운영·개발
환경이 분리되어 있다면 각각 올바른 환경의 Secret을 설정해야 합니다.
Secret 등록 방법은 [Cloudflare 공식 문서](https://developers.cloudflare.com/workers/configuration/secrets/)를 참고하세요.

관리자 키가 없거나 32바이트보다 짧거나 조회용 키와 같으면 쓰기 요청은 `403`으로
차단됩니다. 조회는 계속 기존 인증으로 사용할 수 있습니다. 기존 관리자 도구도
`x-admin-token`을 추가하기 전까지는 쓰기 요청이 차단됩니다.

## 3. 관리자 요청 헤더 생성

저장소에 포함된 `scripts/create-admin-token.cjs`를 사용합니다. 외부 패키지 설치 없이
Node.js만 있으면 실행할 수 있습니다. 아래 PowerShell 예시는 저장소 루트에서 시작합니다.

```powershell
Set-Location src/cloud_flare/wip-notice

# 입력값이 화면이나 명령 기록에 그대로 남지 않도록 입력합니다.
$env:SECRET_KEY = [System.Net.NetworkCredential]::new('', (Read-Host '조회용 SECRET_KEY' -AsSecureString)).Password
$env:ADMIN_SECRET_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'ADMIN_SECRET_KEY' -AsSecureString)).Password

$tokensJson = node .\scripts\create-admin-token.cjs
if ($LASTEXITCODE -ne 0) { throw '토큰 생성 실패' }
$tokens = $tokensJson | ConvertFrom-Json
$headers = @{
    'x-auth-token' = $tokens.'x-auth-token'
    'x-admin-token' = $tokens.'x-admin-token'
}
```

토큰 형식은 두 헤더 모두 다음과 같습니다. 각 토큰의 서명 키만 다릅니다.

```text
Base64(밀리초 타임스탬프).Base64URL(HMAC-SHA256(타임스탬프 문자열, 해당 Secret))
```

토큰 유효기간은 10분입니다. 서버보다 30초를 넘게 미래인 타임스탬프는 거부하므로
관리자 PC/서버의 시간을 동기화하세요. 만료되면 위 토큰 생성 부분을 다시 실행합니다.
출력된 헤더 값도 유효기간 동안 관리자 자격 증명이므로 공유하지 않습니다.

## 4. 요청 예시

아래 URL은 실제 Worker 주소로 바꿉니다. 생성·수정·삭제 예시는 테스트 환경에서
테스트 공지에 대해 실행합니다.

```powershell
$baseUrl = 'https://<your-worker-host>'
```

### 조회

일반 앱은 기존과 같이 `x-auth-token`만 전달하면 됩니다.

```powershell
Invoke-RestMethod -Method Get -Uri "$baseUrl/notices" -Headers @{
    'x-auth-token' = $headers.'x-auth-token'
}
```

### 생성

```powershell
$body = @{
    title = '테스트 공지'
    contents = '관리자 권한 분리 테스트입니다.'
    mustRead = $false
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$baseUrl/notices" -Headers $headers `
    -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

현재 API는 성공 시 `201 Created`와 `Created` 본문을 반환하며 새 idx를 반환하지 않습니다.
목록이나 D1에서 테스트로 생성한 공지의 idx를 확인한 후 아래 값을 지정합니다.

### 수정

```powershell
$noticeId = 123 # 반드시 테스트로 생성한 공지의 idx로 변경
$body = @{ title = '수정된 테스트 공지'; mustRead = $false } | ConvertTo-Json -Compress

Invoke-RestMethod -Method Put -Uri "$baseUrl/notices/$noticeId" -Headers $headers `
    -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

### 삭제

```powershell
Invoke-RestMethod -Method Delete -Uri "$baseUrl/notices/$noticeId" -Headers $headers
```

작업을 마치면 현재 PowerShell 세션의 키·토큰 변수를 정리합니다.

```powershell
Remove-Item Env:SECRET_KEY, Env:ADMIN_SECRET_KEY
Remove-Variable tokensJson, tokens, headers -ErrorAction SilentlyContinue
```

## 오류와 점검

| 상태 | 확인할 내용 |
| --- | --- |
| `401 Unauthorized` | `x-auth-token` 누락·오류·만료, 조회용 `SECRET_KEY` 불일치 |
| `403 Forbidden` | `x-admin-token` 누락·오류·만료, 관리자 키 미설정·길이 부족·조회 키와 동일 |
| `400 Bad Request` | JSON 요청 형식, 필수 필드, idx 등 요청값 확인 |

`403` 응답에는 `Cache-Control: no-store`를 설정합니다. 응답은 어떤 Secret 설정이
잘못되었는지 노출하지 않습니다. 조회는 되는데 쓰기만 `403`이면 관리자 키와
관리자 헤더를 먼저 확인합니다.

## 검증과 키 교체

저장소 루트에서 다음 테스트를 실행합니다. `node:sqlite`와 FTS5를 제공하는 Node.js가
필요합니다. 운영 D1이나 실제 공지 데이터에는 접근하지 않습니다.

```powershell
node --experimental-default-type=module --test src/cloud_flare/wip-notice/test/admin.test.js test/cloudflare_auth.test.mjs src/cloud_flare/wip-notice/test/notices.test.js
```

배포 후에는 일반 토큰만으로 조회가 되는지, 같은 토큰으로 생성·수정·삭제가 `403`인지,
두 종류의 정상 토큰으로 테스트 공지를 관리할 수 있는지 확인합니다.

관리자 키가 노출되면 새로운 무작위 키를 생성해 대상 Worker의 `ADMIN_SECRET_KEY`와
관리자 도구의 값을 교체합니다. 새 키가 반영된 Worker는 이전 관리자 키로 서명한
토큰을 거부합니다. 점진 배포 중이면 이전 키를 사용하는 배포가 남아 있지 않은지도
확인합니다. 조회용 키는 관리자 키와 별도로 관리합니다.

## 남아 있는 제한

- 두 토큰은 유효기간 동안 재사용할 수 있습니다. 관리자 토큰은 특정 메서드·경로·본문에
  묶여 있지 않으므로 탈취되면 다른 공지 쓰기 요청에도 사용될 수 있습니다.
- 관리자별 계정 식별, 개별 권한 회수, 작업자별 감사 로그는 제공하지 않습니다.
- 호출량 제한·WAF·비용 상한은 이 권한 분리와 별도로 설정해야 합니다.
- 공지 변경은 기존 캐시 버전 갱신 경로를 유지합니다. KV 전파와 클라이언트의 1일 응답
  캐시 때문에 모든 클라이언트에 즉시 표시된다고 보장하지 않습니다.
