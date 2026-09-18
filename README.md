# BSP Store — 플랫폼 → 런처 → 앱

사내 배포용 스토어. 앱 파일은 **런처로만** 내려간다.

```
  플랫폼(Vercel)            런처(BSPLauncher.exe)            앱
  ─────────────            ────────────────────            ───
  index.html   앱 목록  →   apps.json 읽기
  /api/license             키 확인 → 토큰                  msiexec /qn 설치
  /api/issue   관리자 발급   CDN 에서 내려받기 + SHA-256
  /api/logs    기록 받기  ←  10분마다 앱 기록 보내기
  /downloads   설치본(임시로 여기서 서빙, 나중에 CDN 으로)
```

## 폴더

| 파일 | 하는 일 |
|---|---|
| `index.html` | 스토어 앞면 (앱 목록·설치 안내·라이선스 확인·변경내역) |
| `admin.html` | 관리자 발급 페이지 (`ADMIN_TOKEN` 필요) |
| `apps.json` | 앱 목록 — 버전·크기·SHA-256·받는 주소. **런처가 이 파일만 본다** |
| `api/_lib.js` | 키 서명·검증 공통 |
| `api/license.js` | 키 확인 → 토큰 |
| `api/issue.js` | 관리자 키 발급 |
| `api/logs.js` | 런처가 보낸 기록 받기 (지금은 Vercel 로그에 요약만) |
| `launcher/` | 런처 C# 소스 (.NET Framework 4.8, WinForms) |
| `downloads/` | 런처 exe + 설치본 msi |

## 올리는 법 (이 PC 에 Node 가 없어서 CLI 는 못 쓴다)

1. 이 폴더를 깃 저장소로 만들어 GitHub 에 올린다
   ```
   cd C:\Users\k\Desktop\bsp-store
   git init && git add -A && git commit -m "BSP Store 첫 판"
   gh repo create bsp-store --private --source . --push
   ```
2. vercel.com → **Add New… → Project → Import** 에서 그 저장소를 고른다
   (프레임워크 없음 / Build Command 비움 / Output Directory 비움)
3. **Settings → Environment Variables** 에 두 개를 넣는다
   - `LICENSE_SECRET` : 아무 긴 문자열 (키 서명용, 바꾸면 이전 키가 전부 무효)
   - `ADMIN_TOKEN` : 관리자 페이지에서 쓸 토큰
4. 배포되면 주소가 나온다. 런처의 `STORE` 기본값(`https://bsp-store.vercel.app`)을
   그 주소로 바꿔 다시 빌드한다 — `launcher/Program.cs` 의 `STORE` 한 줄.
   (시험만 할 때는 환경변수 `BSP_STORE` 로 덮어써도 된다)

Node 를 깔면 `npx vercel --prod` 한 줄로도 된다. 지금은 이 PC 에 node/npm/npx 가 없다.

## 새 판 올릴 때

1. msi 를 `downloads/` 에 넣는다
2. `apps.json` 의 `version` · `size` · `sha256` · `download` · `released` 를 고친다
   (해시 : `sha256sum BSP_Solution_7.8.3.msi`)
3. push 하면 Vercel 이 자동으로 다시 올린다. 런처는 다음에 켤 때 새 판을 본다.

## 아직 안 한 것

- **CDN** : 지금은 Vercel 이 `/downloads` 를 그냥 서빙한다. 파일이 커지면 `apps.json` 의
  `download` 를 CDN 주소(절대 URL)로 바꾸기만 하면 런처는 그대로 돈다.
- **토큰 검사** : 런처는 내려받을 때 `x-bsp-token` 을 보내지만 `/downloads` 는 아직 아무나 받는다.
  막으려면 `/api/download?id=` 를 하나 만들어 토큰을 확인하고 CDN 서명 URL 로 넘기면 된다.
- **기록 보관** : `/api/logs` 는 요약만 Vercel 로그에 남긴다. 오래 두려면 KV/Blob/Postgres.
- **발급 이력·회수** : 키가 스스로 내용을 담고 있어 DB 가 없다. 이력이 필요하면 `/api/issue` 에서 한 줄 적는다.
- 런처 자동 시작(로그인 시), 코드 서명(지금은 서명 없는 exe 라 SmartScreen 이 경고할 수 있다).
