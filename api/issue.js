// 라이선스 발급 — 관리자만.  Vercel 환경변수 ADMIN_TOKEN 을 헤더로 보내야 한다.
//
//   POST /api/issue   헤더 x-admin-token: <ADMIN_TOKEN>
//     { org, seats, expires }   expires = "2027-12-31"
//     -> { ok:true, key }
//
//   발급 기록은 아직 안 남긴다 (키 자체가 내용을 담는다).  누구에게 언제 줬는지 남기려면
//   여기서 DB 에 한 줄 적으면 된다 — Vercel KV / Postgres.

const { makeKey, adminOk } = require("./_lib");

module.exports = (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }
  if (!adminOk(req)) { res.status(401).json({ ok: false, reason: "관리자 토큰이 필요합니다" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const org = String((body && body.org) || "").trim();
  const seats = Number((body && body.seats) || 1);
  const expires = String((body && body.expires) || "").trim();

  if (!org) { res.status(200).json({ ok: false, reason: "회사·팀 이름을 넣으세요" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) { res.status(200).json({ ok: false, reason: "만료일은 2027-12-31 꼴" }); return; }
  if (org.includes("|")) { res.status(200).json({ ok: false, reason: "이름에 | 는 못 씁니다" }); return; }

  res.status(200).json({ ok: true, key: makeKey(org, seats, expires), org, seats, expires });
};
