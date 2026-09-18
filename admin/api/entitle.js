// 계약(엔타이틀먼트) — 라이선스를 만드는 곳은 여기 하나뿐이다.
//   구매가 일어나면 여기에 한 줄이 생기고 시리얼이 나온다.
//   사람에게 주는 것은 시리얼까지.  실제 라이선스는 서버가 런처에 직접 발급한다(/api/activate).
//
//   GET    /api/entitle              (관리자)  계약 + 자리 현황
//   POST   /api/entitle              (관리자)  { org, product, seats, expires, note } -> 시리얼
//   PATCH  /api/entitle              (관리자)  { eid, status }  active | revoked
//   PATCH  /api/entitle              (관리자)  { eid, machine, release:true }  자리 강제 반납

const crypto = require("crypto");
const { adminAuth } = require("./_lib");
const { makeSerial, loadEnts, loadActs, saveEnts, saveActs } = require("./_lic");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const ents = await loadEnts();
  const acts = await loadActs();

  if (req.method === "GET") {
    const rows = ents.map((e) => {
      const seats = acts.filter((a) => a.eid === e.eid && a.status === "active");
      return { ...e, used: seats.length, machines: seats.map((s) => ({ machine: s.machine, user: s.user, until: s.leaseUntil })) };
    });
    res.status(200).json({ ok: true, entitlements: rows, count: rows.length });
    return;
  }

  if (req.method === "POST") {
    const org = String(b.org || "").trim();
    const product = String(b.product || "bsp-solution").trim();
    const seats = Number(b.seats) || 1;
    const expires = String(b.expires || "").trim();
    if (!org) { res.status(200).json({ ok: false, reason: "회사·팀 이름이 필요합니다" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) { res.status(200).json({ ok: false, reason: "만료일은 2027-12-31 꼴" }); return; }

    const ent = {
      eid: "e" + crypto.randomBytes(4).toString("hex"),
      serial: makeSerial(),
      org, product, seats, expires,
      status: "active",
      note: String(b.note || "").slice(0, 120),
      issuedBy: who.by,
      created: new Date().toISOString().slice(0, 10),
    };
    ents.push(ent);
    const w = await saveEnts(ents, `entitle ${org} ${product}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, entitlement: ent });
    return;
  }

  if (req.method === "PATCH") {
    const eid = String(b.eid || "");
    const ent = ents.find((e) => e.eid === eid);
    if (!ent) { res.status(200).json({ ok: false, reason: "없는 계약" }); return; }

    if (b.release && b.machine) {          // 자리 강제 반납
      const a = acts.find((x) => x.eid === eid && x.machine === b.machine);
      if (!a) { res.status(200).json({ ok: false, reason: "그 PC 자리가 없습니다" }); return; }
      a.status = "released";
      await saveActs(acts, `admin release ${b.machine}`);
      res.status(200).json({ ok: true, released: b.machine });
      return;
    }

    ent.status = b.status === "revoked" ? "revoked" : "active";
    const w = await saveEnts(ents, `entitle ${ent.status} ${ent.org}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, entitlement: ent });
    return;
  }

  res.status(405).json({ ok: false, reason: "GET / POST / PATCH" });
};
