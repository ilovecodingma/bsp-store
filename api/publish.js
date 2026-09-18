// 판매자가 앱을 올린다.
//
//   POST /api/publish   헤더 x-publisher-token: <PUBLISHER_TOKEN>
//     {
//       id, name, summary, host(autocad|revit|windows), kind(msi|bundle|addin),
//       version, target, fileName, fileB64
//     }
//     -> { ok:true, app:{...} }
//
//   설치본은 저장소의 downloads/ 에 넣고, 목록은 data/published.json 에 쌓는다.
//   /api/apps 가 그 둘을 합쳐 주므로 런처는 다시 배포하지 않아도 바로 본다.
//
//   ※ Vercel 함수는 본문이 4.5MB 까지다.  더 큰 설치본은 CDN 에 먼저 올리고
//     fileUrl 로 주소만 넘기면 된다 (아래 fileUrl 갈래).

const crypto = require("crypto");
const { readFile, writeFile, enabled } = require("./_store");

const TOKEN = process.env.PUBLISHER_TOKEN || "";
const HOSTS = new Set(["autocad", "revit", "windows"]);
const KINDS = new Set(["msi", "bundle", "addin"]);

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }
  if (!TOKEN || req.headers["x-publisher-token"] !== TOKEN) {
    res.status(401).json({ ok: false, reason: "판매자 토큰이 필요합니다" }); return;
  }
  if (!enabled()) { res.status(200).json({ ok: false, reason: "저장소(GH_TOKEN/GH_REPO)가 연결돼 있지 않습니다" }); return; }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const id = String(b.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const name = String(b.name || "").trim();
  const host = String(b.host || "windows");
  const kind = String(b.kind || "msi");
  const version = String(b.version || "").trim();

  if (!id || !name) { res.status(200).json({ ok: false, reason: "id 와 이름이 필요합니다" }); return; }
  if (!HOSTS.has(host)) { res.status(200).json({ ok: false, reason: "host 는 autocad/revit/windows" }); return; }
  if (!KINDS.has(kind)) { res.status(200).json({ ok: false, reason: "kind 는 msi/bundle/addin" }); return; }
  if (!version) { res.status(200).json({ ok: false, reason: "버전이 필요합니다" }); return; }

  let filePath = String(b.fileUrl || "");
  let size = Number(b.size) || 0;
  let sha = String(b.sha256 || "");

  if (b.fileB64) {
    const buf = Buffer.from(String(b.fileB64), "base64");
    if (buf.length === 0) { res.status(200).json({ ok: false, reason: "파일이 비었습니다" }); return; }
    const fname = String(b.fileName || `${id}-${version}` + (kind === "msi" ? ".msi" : ".zip"))
      .replace(/[^A-Za-z0-9._-]/g, "_");
    const w = await writeFile("downloads/" + fname, buf, `publish ${id} ${version}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "설치본 저장 실패 : " + w.err }); return; }
    filePath = "/downloads/" + fname;
    size = buf.length;
    sha = crypto.createHash("sha256").update(buf).digest("hex");
  }
  if (!filePath) { res.status(200).json({ ok: false, reason: "파일이나 fileUrl 이 필요합니다" }); return; }

  const app = {
    id, name,
    summary: String(b.summary || "").slice(0, 120),
    icon: String(b.icon || "◻"),
    status: "live",
    host, kind, version,
    target: String(b.target || (host === "revit" ? "Revit" : host === "autocad" ? "AutoCAD" : "Windows")),
    released: new Date().toISOString().slice(0, 10),
    size, sha256: sha,
    download: `/api/download?id=${id}&v=${encodeURIComponent(version)}`,
    file: filePath,
    publisher: String(b.publisher || "").slice(0, 60),
  };

  // 목록 갱신 (같은 id 는 덮어쓴다)
  let list = [];
  const cur = await readFile("data/published.json");
  if (cur && cur.text) { try { const j = JSON.parse(cur.text); list = Array.isArray(j) ? j : (j.apps || []); } catch {} }
  list = list.filter((x) => x.id !== id);
  list.push(app);

  const w2 = await writeFile("data/published.json", JSON.stringify(list, null, 2), `publish ${id} ${version} (목록)`);
  if (!w2.ok) { res.status(200).json({ ok: false, reason: "목록 저장 실패 : " + w2.err }); return; }

  res.status(200).json({ ok: true, app });
};
