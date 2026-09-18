// 설정 — 대표(super)가 토큰으로 바꾼다.  바꾸면 깃에 한 줄 남는다(누가·언제).
//
//   GET  /api/config                   (관리자 이상) 현재 값
//   PUT  /api/config  { ... }          (super 만)   바꾸기
//
//   여기 값은 스토어가 바로 읽는다 — 글귀·공지·라이선스 모드는 재배포 없이 바뀐다.
//   코드를 고쳤을 때만 /api/redeploy 로 다시 올린다.

const { adminAuth } = require("./_lib");
const { readFile, writeFile, append } = require("./_store");

const PATH = "data/config.json";

const DEFAULT = {
  heroTitle: "런처 하나로\n현장 도구를 바로 깝니다.",
  heroLead: "BSP 런처가 CDN에서 최신판을 받아 설치합니다. 설치본을 메일로 주고받을 일이 없어집니다.",
  notice: "",
  license: "off",          // off = 사내 배포, on = 라이선스 검사
  vendorIntro: {},          // { "DamDam": "소개 한 줄" }
  updated: "",
  updatedBy: "",
};

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }

  if (req.method === "GET") {
    const f = await readFile(PATH);
    let cfg = DEFAULT;
    try { if (f && f.text) cfg = { ...DEFAULT, ...JSON.parse(f.text) }; } catch {}
    res.status(200).json({ ok: true, config: cfg, canEdit: who.rank >= 3 });
    return;
  }

  if (req.method === "PUT" || req.method === "POST") {
    if (who.rank < 3) { res.status(403).json({ ok: false, reason: "설정은 대표 토큰으로만 바꿉니다" }); return; }

    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

    const f = await readFile(PATH);
    let cur = DEFAULT;
    try { if (f && f.text) cur = { ...DEFAULT, ...JSON.parse(f.text) }; } catch {}

    const next = {
      ...cur,
      heroTitle: typeof b.heroTitle === "string" ? b.heroTitle.slice(0, 200) : cur.heroTitle,
      heroLead: typeof b.heroLead === "string" ? b.heroLead.slice(0, 400) : cur.heroLead,
      notice: typeof b.notice === "string" ? b.notice.slice(0, 300) : cur.notice,
      license: b.license === "on" ? "on" : b.license === "off" ? "off" : cur.license,
      vendorIntro: (b.vendorIntro && typeof b.vendorIntro === "object") ? b.vendorIntro : cur.vendorIntro,
      updated: new Date().toISOString().slice(0, 19).replace("T", " "),
      updatedBy: who.by,
    };

    const w = await writeFile(PATH, JSON.stringify(next, null, 2), `config by ${who.by}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }

    await append([{
      t: new Date().toISOString(), type: "launch", app: "config", machine: who.by,
      ok: true, note: `설정 변경 (라이선스 ${next.license})`,
    }]);

    res.status(200).json({ ok: true, config: next });
    return;
  }

  res.status(405).json({ ok: false, reason: "GET / PUT" });
};
