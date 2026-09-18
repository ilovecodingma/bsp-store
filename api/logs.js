// 런처가 모아 보낸 앱 기록을 받는다.
//
//   POST /api/logs
//     { machine, key, launcher, files:[{ name, mtime, size, gz(base64 gzip) }] }
//     -> { ok:true, got:N }
//
//   지금은 받아서 요약만 Vercel 로그에 남긴다 (배포 대시보드 > Logs 에서 보인다).
//   오래 두려면 아래 SAVE 자리에 한 줄 붙이면 된다 :
//     - Vercel Blob / S3 : 파일 그대로
//     - Vercel KV / Postgres : 줄 단위 요약
//   보관 기간·용량 규칙을 정하기 전에는 일부러 저장하지 않는다.

const zlib = require("zlib");

module.exports = (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const machine = String((body && body.machine) || "unknown").slice(0, 80);
  const files = Array.isArray(body && body.files) ? body.files : [];
  if (files.length === 0) { res.status(200).json({ ok: true, got: 0 }); return; }

  const lines = [];
  for (const f of files.slice(0, 20)) {
    let text = "";
    try { text = zlib.gunzipSync(Buffer.from(String(f.gz || ""), "base64")).toString("utf8"); }
    catch { text = ""; }

    // 요약만 뽑는다 — 구간 수·치수 수·오류 줄
    const runs = (text.match(/구간 (\d+)개/) || [])[1] || "";
    const dims = (text.match(/치수 (\d+)/g) || []).length;
    const err = (text.match(/^.*(오류|실패|error).*$/im) || [])[0] || "";
    lines.push({
      machine,
      name: String(f.name || "").slice(0, 80),
      mtime: String(f.mtime || ""),
      size: Number(f.size) || 0,
      runs, dims,
      err: err.slice(0, 200),
    });
  }

  // SAVE : 오래 두려면 여기서 저장한다
  console.log("[logs]", JSON.stringify({ machine, n: files.length, lines }));

  res.status(200).json({ ok: true, got: files.length });
};
