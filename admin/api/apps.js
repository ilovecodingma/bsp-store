// 앱 목록 — 기본 목록(apps.json) + 판매자가 올린 것(data/published.json) 을 합쳐 준다.
//   런처와 스토어는 이 길만 본다.  판매자가 올리면 다시 배포하지 않아도 바로 보인다.
//
//   GET /api/apps

const base = require("../apps.json");
const { readFile, enabled } = require("./_store");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");

  let extra = [];
  let store = enabled() ? "github" : "off";
  try {
    const f = await readFile("data/published.json");
    if (f && f.text) {
      const j = JSON.parse(f.text);
      extra = Array.isArray(j) ? j : (j.apps || []);
    }
  } catch (e) {
    store = "err:" + String(e.message).slice(0, 60);
  }

  // 같은 id 면 나중 것(판매자가 올린 것)이 이긴다
  const byId = new Map();
  for (const a of base.apps || []) byId.set(a.id, a);
  for (const a of extra) byId.set(a.id, a);

  res.status(200).json({
    updated: new Date().toISOString().slice(0, 19).replace("T", " "),
    cdn: base.cdn || "",
    launcher: base.launcher || {},
    store,
    apps: Array.from(byId.values()),
  });
};
