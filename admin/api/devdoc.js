// 개발자 안내서 — 그 사람 토큰이 박힌 MD 를 만들어 준다.
//   대표님이 개발자를 추가하면 이 파일 하나만 건네면 된다.
//
//   GET /api/devdoc?uid=u1234        (관리자)
//     -> text/markdown  (내려받기용 파일 이름까지 붙여서)

const { adminAuth } = require("./_lib");
const { readFile } = require("./_store");

const STORE = "https://bsp-store.vercel.app";
const ADMIN = "https://bsp-admin-nine.vercel.app";

function doc(u) {
  const apps = (u.apps && u.apps.length) ? u.apps.join(", ") : "(처음 올리는 id 가 당신 것이 됩니다)";
  return `# BSP Store — ${u.name} 님 개발자 안내

이 문서에는 **당신 토큰**이 들어 있습니다. 남에게 주지 마세요.

| | |
|---|---|
| 이름 | ${u.name} |
| 소속 | ${u.org || "-"} |
| 권한 | 올리기만 (다른 앱·계정·라이선스는 볼 수도 없습니다) |
| 올릴 수 있는 앱 | ${apps} |
| 토큰 만료 | ${u.expires} |

## 토큰

\`\`\`
${u.key}
\`\`\`

## 올리기 — 한 줄

빌드가 끝나면 이 명령 하나로 스토어에 올라갑니다. 올리는 즉시 런처와 리빗 스토어에 뜹니다.

\`\`\`powershell
# publish.ps1 — 빌드 뒤에 실행
$id      = "my-addin"          # 앱 id (처음 올린 사람이 주인)
$name    = "우리 애드인"
$version = "1.0.0"             # 올릴 때마다 올리세요
$zip     = ".\\dist\\my-addin-$version.zip"

$b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
$body = @{ id=$id; name=$name; summary="한 줄 소개"; host="revit"; kind="addin";
           version=$version; fileName=(Split-Path $zip -Leaf); fileB64=$b64 } | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method Post -Uri "${ADMIN}/api/publish" \`
  -Headers @{ "x-bsp-key" = "${u.key}" } \`
  -ContentType "application/json" -Body $body
\`\`\`

파일이 4MB 를 넘으면 CDN 에 먼저 올리고 \`fileB64\` 대신 \`fileUrl\`·\`size\`·\`sha256\` 을 넣으세요.

## 넣는 값

| 이름 | 뜻 |
|---|---|
| \`id\` | 앱 아이디 (영문·숫자·하이픈). 같은 id 로 다시 올리면 판올림 |
| \`name\` | 사람이 보는 이름 |
| \`summary\` | 한 줄 소개 |
| \`host\` | \`revit\` · \`autocad\` · \`windows\` |
| \`kind\` | \`addin\`(리빗 zip) · \`bundle\`(캐드 zip) · \`msi\` |
| \`version\` | 올릴 때마다 올릴 것 |

## 리빗 애드인 zip

폴더 없이 평평하게 두 개만 넣습니다.

\`\`\`
my-addin-1.0.0.zip
├── MyAddin.addin      (AddInId 는 새 GUID, Assembly 는 파일 이름만)
└── MyAddin.dll
\`\`\`

## 알아 둘 것

- 올린 뒤 런처·리빗 스토어는 새로고침하면 바로 봅니다.
- **리빗은 켤 때 애드인을 읽습니다.** 설치는 즉시여도 리본에 뜨는 건 리빗을 다시 켠 뒤입니다.
- 남의 앱 id 로는 못 올립니다. 우리 내부 앱(\`hts\`, \`revit-store\` 등) id 도 막혀 있습니다.
- 앱이 기록을 \`%APPDATA%\\BSP\\outbox\\\` 에 떨구면 런처가 서버로 올려 줍니다.
- 설치·실행 수는 관리자 집계에 쌓입니다 (당신 화면에는 안 보입니다).

## 막히면

| 답 | 뜻 |
|---|---|
| \`개발자 권한이 아닙니다\` | 토큰이 개발자 계정이 아닙니다 |
| \`끊긴 계정\` / \`만료된 토큰\` | 관리자에게 되살려 달라고 하세요 |
| \`다른 개발자의 앱입니다\` | 그 id 는 다른 사람이 먼저 올렸습니다 |
| \`그 id 는 내부 전용입니다\` | 우리 앱 id 입니다. 다른 id 를 쓰세요 |

스토어 : ${STORE}
`;
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }

  const url = new URL(req.url, "https://x");
  const uid = String(url.searchParams.get("uid") || "");

  const f = await readFile("data/users.json");
  let list = [];
  try { list = f && f.text ? JSON.parse(f.text) : []; } catch {}
  const u = (Array.isArray(list) ? list : []).find((x) => x.uid === uid);
  if (!u) { res.status(404).json({ ok: false, reason: "없는 계정" }); return; }

  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("content-disposition",
    `attachment; filename="BSP-dev-${encodeURIComponent(u.name)}.md"`);
  res.status(200).send(doc(u));
};
