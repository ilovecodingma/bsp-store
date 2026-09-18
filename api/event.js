// 런처가 보내는 사건 한 줄 — 내려받기·설치·애드온 기록.
//
//   POST /api/event   { type, app, version, machine, key, ok, note }
//     type : download | install | launch | addon | error
//   여러 개면 { events:[ {...}, ... ] } 로 보내도 된다 (런처가 모아 보낸다).

const { append, enabled } = require("./_store");

const TYPES = new Set(["download", "install", "launch", "addon", "error"]);

function clean(e, ip) {
  return {
    t: new Date().toISOString(),
    type: TYPES.has(String(e.type)) ? String(e.type) : "error",
    app: String(e.app || "").slice(0, 40),
    version: String(e.version || "").slice(0, 20),
    machine: String(e.machine || "").slice(0, 60),
    org: String(e.org || "").slice(0, 60),
    ok: e.ok === false ? false : true,
    note: String(e.note || "").slice(0, 300),
    ip: String(ip || "").split(",")[0].slice(0, 45),
  };
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const ip = req.headers["x-forwarded-for"] || "";
  const list = Array.isArray(body && body.events) ? body.events : [body || {}];
  const rows = list.slice(0, 50).map((e) => clean(e, ip));

  const r = await append(rows);
  console.log("[event]", JSON.stringify(rows));
  res.status(200).json({ ok: true, got: rows.length, stored: !!r.ok, store: enabled() ? "github" : "off" });
};
