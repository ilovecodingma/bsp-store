// 재배포 — 대표(super)가 토큰으로 누른다.  누가 언제 눌렀는지 깃에 남는다.
//
//   POST /api/redeploy   { target: "store" | "admin" | "both" }
//     -> { ok:true, deployments:[{ project, url, state }] }
//
//   코드를 고쳤을 때만 쓴다.  글귀·공지·라이선스 모드는 /api/config 로 바뀌고 재배포가 필요 없다.
//   Vercel 토큰은 환경변수 VERCEL_DEPLOY_TOKEN 에 둔다.

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

// 그 프로젝트의 마지막 운영 배포를 그대로 다시 올린다
async function redeploy(project) {
  const list = await vc("GET", `/v6/deployments?app=${project}&target=production&limit=1`);
  if (!list.ok || !list.json || !list.json.deployments || !list.json.deployments.length) {
    return { project, error: "배포 이력을 못 읽었습니다 (" + list.status + ")" };
  }
  const last = list.json.deployments[0];
  const made = await vc("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
    name: project,
    deploymentId: last.uid,
    target: "production",
    meta: { redeployedFrom: last.uid },
  });
  if (!made.ok) return { project, error: made.status + " " + made.text.slice(0, 160) };
  return { project, url: made.json.url, state: made.json.readyState || "QUEUED" };
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }

  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }
  if (who.rank < 3) { res.status(403).json({ ok: false, reason: "재배포는 대표 토큰으로만 됩니다" }); return; }
  if (!TOKEN) { res.status(200).json({ ok: false, reason: "VERCEL_DEPLOY_TOKEN 이 없습니다" }); return; }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const target = (b && b.target) || "both";

  const jobs = [];
  if (target === "store" || target === "both") jobs.push(redeploy("bsp-store"));
  if (target === "admin" || target === "both") jobs.push(redeploy("bsp-admin"));
  const out = await Promise.all(jobs);

  await append([{
    t: new Date().toISOString(), type: "launch", app: "redeploy", machine: who.by,
    ok: !out.some((x) => x.error),
    note: out.map((x) => x.project + " " + (x.error || x.url)).join(" | ").slice(0, 300),
  }]);

  res.status(200).json({ ok: true, by: who.by, deployments: out });
};
