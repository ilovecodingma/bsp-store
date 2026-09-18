// 라이선스 확인 — 서명한 키를 그 자리에서 검증한다 (DB 없이 돈다)
//
//   키 꼴 :  BSP.<payload>.<mac>
//            payload = base64url("org|seats|expires")
//            mac     = HMAC-SHA256(payload, LICENSE_SECRET) 앞 10자
//   관리자가 /admin.html 에서 발급한다.  발급 기록을 남기거나 회수하려면 DB 가 필요하다
//   (지금은 만료일로만 막는다 — 회수는 LICENSE_SECRET 을 바꾸면 전부 무효가 된다).
//
//   POST /api/license  { key, machine }
//     -> { ok:true, org, seats, expires, token }
//     -> { ok:false, reason }

const { verifyKey, sign } = require("./_lib");

// 시연용 고정 키 (서명 키가 아직 없을 때).  운영에서는 지워도 된다.
const DEMO = {
  "BSP-DEMO-0000-0001": { org: "BSP Engineering (사내)", seats: 50, expires: "2027-12-31" },
};

module.exports = (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "POST 로 보내세요" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const key = String((body && body.key) || "").trim();
  const machine = String((body && body.machine) || "unknown").slice(0, 80);

  let rec = DEMO[key.toUpperCase()] || null;
  if (!rec) {
    const v = verifyKey(key);
    if (!v.ok) { res.status(200).json({ ok: false, reason: v.reason }); return; }
    rec = v.rec;
  }

  if (new Date(rec.expires) < new Date()) {
    res.status(200).json({ ok: false, reason: `만료됨 (${rec.expires})` });
    return;
  }

  res.status(200).json({
    ok: true,
    org: rec.org,
    seats: rec.seats,
    expires: rec.expires,
    token: sign(`${key}|${machine}|${rec.expires}`),
  });
};
