// 되돌리기 — 사고 쳤을 때 대표(super)가 직전 배포로 즉시 돌린다.
//
//   GET  /api/rollback?project=bsp-store     최근 배포 목록 (언제·누가·어떤 커밋)
//   POST /api/rollback { project, uid }      그 배포를 다시 운영으로 올린다
//
//   깃이 원본이다 : 코드를 되돌리려면 git revert 하고 push 하면 자동 배포가 다시 돈다.
//   이 길은 "지금 당장" 화면을 되돌릴 때 쓴다.  누른 기록은 깃에 남는다.

const { adminAuth } = require("./_lib");
const { append } = require("./_store");

const TOKEN = process.env.VERCEL_DEPLOY_TOKEN || "";
const API = "https://api.vercel.com";

async function vc(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, json: j, text: t };
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }
  if (who.rank < 3) { res.status(403).json({ ok: false, reason: "되돌리기는 대표 토큰으로만 됩니다" }); return; }
  if (!TOKEN) { res.status(200).json({ ok: false, reason: "VERCEL_DEPLOY_TOKEN 이 없습니다" }); return; }

  const url = new URL(req.url, "https://x");
  const project = String(url.searchParams.get("project") || "bsp-store");

  if (req.method === "GET") {
    const r = await vc("GET", `/v6/deployments?app=${project}&target=production&limit=10`);
    if (!r.ok) { res.status(200).json({ ok: false, reason: r.status + " " + r.text.slice(0, 120) }); return; }
    const rows = (r.json.deployments || []).map((d) => ({
      uid: d.uid, url: d.url, state: d.state || d.readyState,
      created: new Date(d.created || d.createdAt).toISOString().slice(0, 16).replace("T", " "),
      commit: (d.meta && (d.meta.githubCommitMessage || d.meta.redeployedFrom)) || "",
    }));
    res.status(200).json({ ok: true, project, deployments: rows });
    return;
  }

  if (req.method === "POST") {
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    const proj = String((b && b.project) || project);
    const uid = String((b && b.uid) || "");
    if (!uid) { res.status(200).json({ ok: false, reason: "어느 배포로 돌릴지 골라 주세요" }); return; }

    const made = await vc("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
      name: proj, deploymentId: uid, target: "production", meta: { rollbackFrom: uid, by: who.by },
    });
    if (!made.ok) { res.status(200).json({ ok: false, reason: made.status + " " + made.text.slice(0, 160) }); return; }

    await append([{
      t: new Date().toISOString(), type: "launch", app: "rollback", machine: who.by,
      ok: true, note: `${proj} -> ${uid} (${made.json.url})`,
    }]);

    res.status(200).json({ ok: true, project: proj, url: made.json.url, state: made.json.readyState || "QUEUED" });
    return;
  }

  res.status(405).json({ ok: false, reason: "GET / POST" });
};
