// 내가 누구인가 — 토큰 하나로 물어본다.  화면은 이 답에 맞춰 보여 줄 것만 보여 준다.
//
//   GET /api/whoami   헤더 x-bsp-key: BSP.…   또는   x-admin-token: <ADMIN_TOKEN>
//     -> { ok:true, role, name, org, can:{ users, entitle, publish, stats }, apps:[…] }

const { verifyKey, adminOk } = require("./_lib");
const { readFile } = require("./_store");

const CAN = {
  super:     { users: true,  entitle: true,  publish: true, stats: true },
  admin:     { users: true,  entitle: true,  publish: true, stats: true },
  publisher: { users: false, entitle: false, publish: true, stats: false },
  user:      { users: false, entitle: false, publish: false, stats: false },
};

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");

  if (adminOk(req)) {
    res.status(200).json({ ok: true, role: "super", name: "환경변수 토큰", org: "", can: CAN.super, apps: [] });
    return;
  }

  const key = String(req.headers["x-bsp-key"] || "").trim();
  if (!key) { res.status(401).json({ ok: false, reason: "토큰이 필요합니다" }); return; }
  if (!verifyKey(key).ok) { res.status(401).json({ ok: false, reason: "토큰 서명이 맞지 않습니다" }); return; }

  let list = [];
  try {
    const f = await readFile("data/users.json");
    list = f && f.text ? JSON.parse(f.text) : [];
  } catch {}

  const u = (Array.isArray(list) ? list : []).find((x) => x.key === key);
  if (!u) { res.status(401).json({ ok: false, reason: "없는 계정" }); return; }
  if (u.status === "revoked") { res.status(401).json({ ok: false, reason: "끊긴 계정" }); return; }
  if (new Date(u.expires) < new Date()) { res.status(401).json({ ok: false, reason: "만료된 토큰" }); return; }

  res.status(200).json({
    ok: true,
    role: u.role, name: u.name, org: u.org || "",
    expires: u.expires,
    can: CAN[u.role] || CAN.user,
    apps: u.apps || [],
  });
};
