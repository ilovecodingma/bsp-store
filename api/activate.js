// 활성화 — 런처가 시리얼을 내밀면 서버가 그 PC 앞으로 라이선스를 발급한다.
//   사람이 라이선스를 옮겨 적는 길은 없다 (오토데스크와 같은 방식).
//
//   POST /api/activate    { serial, machine, user, product }
//     -> { ok:true, lease, until, org, product, seats, used }
//     -> { ok:false, reason }   좌석 다 참 / 끊긴 계약 / 만료 / 없는 시리얼
//
//   POST /api/activate    { lease }          갱신 (런처가 주기적으로)
//   POST /api/activate    { lease, release:true }   반납 (PC 교체)

const {
  LEASE_DAYS, GRACE_DAYS, makeLease, readLease,
  loadEnts, loadActs, saveActs, days,
} = require("./_lic");
const { append } = require("./_store");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "POST" }); return; }

  // 내부 배포 모드 — 라이선스를 안 본다 (PROD 로 갈 때 LICENSE_MODE=on)
  if (process.env.LICENSE_MODE !== "on") {
    res.status(200).json({
      ok: true, mode: "internal", lease: "internal",
      until: "-", grace: 365, org: "내부 배포", product: "all",
      note: "내부 배포 모드입니다.  시리얼 없이 씁니다.",
    });
    return;
  }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const ents = await loadEnts();
  const acts = await loadActs();
  const now = new Date().toISOString().slice(0, 10);

  // ── 갱신·반납 ──────────────────────────────────────────────────
  if (b.lease) {
    const L = readLease(b.lease);
    if (!L) { res.status(200).json({ ok: false, reason: "대여증이 위조됐거나 깨졌습니다" }); return; }
    const ent = ents.find((e) => e.eid === L.eid);
    if (!ent || ent.status !== "active") { res.status(200).json({ ok: false, reason: "끊긴 계약입니다" }); return; }
    if (ent.expires < now) { res.status(200).json({ ok: false, reason: `계약 만료 (${ent.expires})` }); return; }

    const a = acts.find((x) => x.eid === L.eid && x.machine === L.machine);
    if (!a) { res.status(200).json({ ok: false, reason: "이 PC 의 자리가 반납돼 있습니다.  다시 활성화하세요" }); return; }

    if (b.release) {
      a.status = "released";
      a.releasedAt = now;
      await saveActs(acts, `release ${L.machine}`);
      await append([{ t: new Date().toISOString(), type: "license", app: L.product, machine: L.machine, ok: true, note: "자리 반납" }]);
      res.status(200).json({ ok: true, released: true });
      return;
    }

    if (a.status !== "active") { res.status(200).json({ ok: false, reason: "회수된 자리입니다" }); return; }
    const until = days(LEASE_DAYS) < ent.expires ? days(LEASE_DAYS) : ent.expires;
    a.leaseUntil = until;
    a.lastSeen = now;
    await saveActs(acts, `renew ${L.machine}`);
    res.status(200).json({
      ok: true, renewed: true, lease: makeLease(ent, L.machine, until),
      until, grace: GRACE_DAYS, org: ent.org, product: ent.product,
    });
    return;
  }

  // ── 첫 활성화 ──────────────────────────────────────────────────
  const serial = String(b.serial || "").trim().toUpperCase();
  const machine = String(b.machine || "").trim().slice(0, 60);
  const user = String(b.user || "").trim().slice(0, 40);
  if (!serial || !machine) { res.status(200).json({ ok: false, reason: "시리얼과 PC 이름이 필요합니다" }); return; }

  const ent = ents.find((e) => e.serial === serial);
  if (!ent) { res.status(200).json({ ok: false, reason: "없는 시리얼입니다" }); return; }
  if (ent.status !== "active") { res.status(200).json({ ok: false, reason: "끊긴 계약입니다" }); return; }
  if (ent.expires < now) { res.status(200).json({ ok: false, reason: `계약 만료 (${ent.expires})` }); return; }

  const mine = acts.find((x) => x.eid === ent.eid && x.machine === machine);
  const used = acts.filter((x) => x.eid === ent.eid && x.status === "active" && x.machine !== machine).length;

  if (!mine && used >= ent.seats) {
    await append([{ t: new Date().toISOString(), type: "license", app: ent.product, machine, ok: false, note: `좌석 초과 ${used}/${ent.seats}` }]);
    res.status(200).json({ ok: false, reason: `좌석을 다 썼습니다 (${used}/${ent.seats}).  쓰지 않는 PC 를 반납하세요` });
    return;
  }

  const until = days(LEASE_DAYS) < ent.expires ? days(LEASE_DAYS) : ent.expires;
  if (mine) { mine.status = "active"; mine.leaseUntil = until; mine.lastSeen = now; mine.user = user || mine.user; }
  else acts.push({ eid: ent.eid, machine, user, status: "active", activated: now, leaseUntil: until, lastSeen: now });

  await saveActs(acts, `activate ${machine}`);
  await append([{
    t: new Date().toISOString(), type: "license", app: ent.product, version: "",
    machine, org: ent.org, ok: true, note: `활성화 ${used + 1}/${ent.seats}`,
  }]);

  res.status(200).json({
    ok: true,
    lease: makeLease(ent, machine, until),
    until, grace: GRACE_DAYS,
    org: ent.org, product: ent.product,
    seats: ent.seats, used: used + 1,
  });
};
