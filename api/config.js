// 스토어가 읽는 설정 (공개).  대표가 관리자에서 바꾸면 여기로 바로 반영된다 — 재배포 없이.
//   GET /api/config
const { readFile } = require("./_store");

const DEFAULT = {
  heroTitle: "런처 하나로\n현장 도구를 바로 깝니다.",
  heroLead: "BSP 런처가 CDN에서 최신판을 받아 설치합니다.",
  notice: "",
  license: "off",
  vendorIntro: {},
};

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  let cfg = DEFAULT;
  try {
    const f = await readFile("data/config.json");
    if (f && f.text) cfg = { ...DEFAULT, ...JSON.parse(f.text) };
  } catch {}
  res.status(200).json({ ok: true, ...cfg });
};
