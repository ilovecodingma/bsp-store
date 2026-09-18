// 내려받기는 여기를 거친다 — 세어 두고 파일로 넘긴다.
//
//   GET /api/download?id=bsp-solution&v=7.8.3&machine=...&key=...
//     -> 302 /downloads/<파일>
//
//   런처가 x-bsp-token 을 싣고 온다.  토큰을 꼭 받아야 하게 막으려면 아래 REQUIRE 를 켠다
//   (지금은 사내용이라 열어 둔다 — 세는 것이 먼저다).

const { append, readFile } = require("./_store");
const apps = require("../apps.json");

// 기본 목록 + 판매자가 올린 것
async function findApp(id) {
  let a = (apps.apps || []).find((x) => x.id === id);
  try {
    const f = await readFile("data/published.json");
    if (f && f.text) {
      const j = JSON.parse(f.text);
      const list = Array.isArray(j) ? j : (j.apps || []);
      const p = list.find((x) => x.id === id);
      if (p) a = p;
    }
  } catch {}
  return a;
}

const REQUIRE_TOKEN = false;

module.exports = async (req, res) => {
  const url = new URL(req.url, "https://x");
  const id = url.searchParams.get("id") || "";
  const app = await findApp(id);

  if (!app || app.status !== "live" || !app.file) {
    res.status(404).json({ ok: false, reason: "그런 앱이 없습니다" });
    return;
  }
  if (REQUIRE_TOKEN && !req.headers["x-bsp-token"]) {
    res.status(401).json({ ok: false, reason: "런처로 받으세요" });
    return;
  }

  await append([{
    t: new Date().toISOString(),
    type: "download",
    app: id,
    version: app.version,
    machine: String(url.searchParams.get("machine") || "").slice(0, 60),
    org: String(url.searchParams.get("org") || "").slice(0, 60),
    ok: true,
    note: req.headers["x-bsp-token"] ? "런처" : "직접",
    ip: String(req.headers["x-forwarded-for"] || "").split(",")[0],
  }]);

  res.writeHead(302, { location: app.file, "cache-control": "no-store" });
  res.end();
};
