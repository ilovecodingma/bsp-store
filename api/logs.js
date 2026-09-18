// 런처가 애드온(오토캐드 플러그인) 기록을 모아 보내면 받아서 요약을 남긴다.
//
//   POST /api/logs
//     { machine, key, launcher, files:[{ name, mtime, size, gz(base64 gzip) }] }
//     -> { ok:true, got:N, stored:bool }
//
//   원문은 안 쌓는다 (용량·개인정보).  구간 수·치수 수·오류 줄만 뽑아 events 에 붙인다.

const zlib = require("zlib");
const { append, enabled } = require("./_store");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const machine = String((body && body.machine) || "unknown").slice(0, 60);
  const files = Array.isArray(body && body.files) ? body.files : [];
  if (files.length === 0) { res.status(200).json({ ok: true, got: 0 }); return; }

  const rows = [];
  for (const f of files.slice(0, 20)) {
    let text = "";
    try { text = zlib.gunzipSync(Buffer.from(String(f.gz || ""), "base64")).toString("utf8"); }
    catch { text = ""; }

    const runs = (text.match(/구간 (\d+)개/) || [])[1] || "";
    const dims = (text.match(/치수 (\d+)/g) || []).length;
    const blocks = (text.match(/블록 ([\d,]+)개/) || [])[1] || "";
    const err = (text.match(/^.*(오류|실패|error).*$/im) || [""])[0].trim().slice(0, 200);

    rows.push({
      t: new Date().toISOString(),
      type: err ? "error" : "addon",
      app: "bsp-solution",
      version: String((body && body.appVersion) || ""),
      machine,
      ok: !err,
      note: `${String(f.name || "").slice(0, 40)} 블록 ${blocks} 구간 ${runs} 치수줄 ${dims}${err ? " | " + err : ""}`.slice(0, 300),
      ip: String(req.headers["x-forwarded-for"] || "").split(",")[0],
    });
  }

  const r = await append(rows);
  console.log("[logs]", machine, files.length, "개");
  res.status(200).json({ ok: true, got: files.length, stored: !!r.ok, store: enabled() ? "github" : "off" });
};
