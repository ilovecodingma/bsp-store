# BSP Store — 개발자 안내

애드인을 만들었으면 여기 올리세요. 심사 없습니다. 올리는 즉시 런처와 리빗 스토어 패널에 뜹니다.

- 스토어 : <https://bsp-store.vercel.app>
- 올리는 곳 : `POST https://bsp-admin-nine.vercel.app/api/publish`
- 웹으로 올리기 : <https://bsp-admin-nine.vercel.app/publish.html>

---

## 1. 토큰 받기

관리자에게 **개발자 계정**을 요청하면 토큰이 나옵니다. 생김새는 이렇습니다.

```
BSP.QlNQIOyEpOqzhDLtjIB8MjB8MjAyNy0xMi0zMQ.COoTEPivyc
```

- 사람마다 다른 토큰입니다. 남에게 주지 마세요.
- 올릴 때 `x-bsp-key` 헤더에 그대로 넣습니다.
- 토큰에 만료일이 있습니다. 끊기면 관리자가 되살려 줍니다.

---

## 2. 올리기

### 웹으로 (제일 쉬움)

<https://bsp-admin-nine.vercel.app/publish.html> 에서 토큰 넣고 파일 고르고 [올리기].

### 명령으로

```bash
# 4MB 이하 — 파일을 그대로 실어 보낸다
curl -X POST https://bsp-admin-nine.vercel.app/api/publish \
  -H "content-type: application/json" \
  -H "x-bsp-key: BSP.여기에.내토큰" \
  -d @- <<JSON
{
  "id": "my-addin",
  "name": "우리 애드인",
  "summary": "한 줄 소개",
  "host": "revit",
  "kind": "addin",
  "version": "1.0.0",
  "fileName": "my-addin-1.0.0.zip",
  "fileB64": "$(base64 -w0 my-addin-1.0.0.zip)"
}
JSON
```

```powershell
# PowerShell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("my-addin-1.0.0.zip"))
$body = @{ id="my-addin"; name="우리 애드인"; summary="한 줄 소개";
           host="revit"; kind="addin"; version="1.0.0";
           fileName="my-addin-1.0.0.zip"; fileB64=$b64 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://bsp-admin-nine.vercel.app/api/publish" `
  -Headers @{ "x-bsp-key"="BSP.여기에.내토큰" } -ContentType "application/json" -Body $body
```

4MB 가 넘으면 CDN 에 먼저 올리고 주소만 넘기세요.

```json
{ "id":"my-addin", "name":"우리 애드인", "host":"revit", "kind":"addin",
  "version":"1.0.0", "fileUrl":"https://cdn.example.com/my-addin-1.0.0.zip",
  "size": 12345678, "sha256":"a1b2c3…" }
```

---

## 3. 넣는 값

| 이름 | 뜻 | 보기 |
|---|---|---|
| `id` | 앱 아이디 (영문·숫자·하이픈). 같은 id 로 다시 올리면 **판올림** | `my-addin` |
| `name` | 사람이 보는 이름 | `우리 애드인` |
| `summary` | 한 줄 소개 | `배관 태그를 한 번에 붙입니다` |
| `host` | `revit` · `autocad` · `windows` | `revit` |
| `kind` | `addin` · `bundle` · `msi` | `addin` |
| `version` | 버전. 올릴 때마다 올리세요 | `1.0.0` |
| `target` | 대상 (안 넣으면 자동) | `Revit 2024+` |
| `fileB64` / `fileUrl` | 설치본 (둘 중 하나) | |

### `kind` 가 하는 일

| kind | 파일 | 런처가 하는 일 |
|---|---|---|
| `addin` | zip (`.addin` + dll) | 이 PC 에 깔린 **리빗 버전마다** `%APPDATA%\Autodesk\Revit\Addins\<버전>\` 에 풉니다 |
| `bundle` | zip (오토캐드 번들 구조) | `%APPDATA%\Autodesk\ApplicationPlugins\<id>.bundle\` 에 풉니다 |
| `msi` | msi | `msiexec /i <파일> /qn` 로 조용히 설치합니다 |

---

## 4. 리빗 애드인 zip 만들기

zip 안은 이렇게만 되어 있으면 됩니다. 폴더 없이 평평하게.

```
my-addin-1.0.0.zip
├── MyAddin.addin
└── MyAddin.dll
```

`.addin` 은 이 꼴입니다.

```xml
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Command">
    <Name>우리 애드인</Name>
    <Assembly>MyAddin.dll</Assembly>
    <AddInId>여기에-새-GUID</AddInId>
    <FullClassName>MyAddin.Command</FullClassName>
    <Text>우리 애드인</Text>
    <VendorId>DAMDAM</VendorId>
  </AddIn>
</RevitAddIns>
```

`AddInId` 는 **새 GUID** 를 쓰세요. 남의 것과 겹치면 리빗이 하나만 읽습니다.
`Assembly` 는 파일 이름만 적습니다 (경로 없이).

---

## 5. 올린 뒤

- 런처와 리빗 스토어 패널이 10분 안에, 새로고침하면 바로 봅니다.
- 설치·실행 횟수는 집계에 쌓입니다 : <https://bsp-admin-nine.vercel.app/stats.html>
- 같은 `id` 로 버전만 올려 다시 올리면 판올림입니다. 쓰던 사람은 다음에 설치할 때 새 판을 받습니다.
- 잘못 올렸으면 같은 id 로 고쳐서 다시 올리면 덮어씁니다.

## 6. 규칙 몇 가지

- 설치본은 **본인이 만든 것만**. 남의 dll 을 다시 포장해 올리지 마세요.
- `.addin` 의 `AddInId` 와 `id` 는 바꾸지 마세요. 바꾸면 다른 앱이 됩니다.
- 리빗은 켤 때 애드인을 읽습니다. 설치는 즉시여도 **리본에 뜨는 것은 리빗을 다시 켠 뒤**입니다.
- 앱이 남기는 기록을 `%APPDATA%\BSP\outbox\` 에 떨구면 런처가 서버로 올려 줍니다
  (`*.json` 은 사건 한 줄, `*.txt` 는 기록 원문).

막히면 관리자에게 말씀 주세요.
