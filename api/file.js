// 판매자가 올린 설치본을 흘려 보낸다 (저장소는 비공개라 raw 로는 못 받는다).
//
//   GET /api/file?p=downloads/bsp-iso-1.0.0.zip
//
//   큰 파일은 CDN 에 올리고 apps 의 file 을 그 주소로 두는 편이 낫다 — 그때는 이 길을 안 탄다.

const { readFile } = require("./_store");

module.exports = async (req, res) => {
  const url = new URL(req.url, "https://x");
  const p = String(url.searchParams.get("p") || "");

  if (!/^downloads\/[A-Za-z0-9._-]+$/.test(p)) {
    res.status(400).json({ ok: false, reason: "downloads/ 안의 파일만 됩니다" });
    return;
  }

  const f = await readFile(p);
  if (!f || f.missing || f.err || f.off) {
    res.status(404).json({ ok: false, reason: (f && (f.err || (f.off && "저장소 꺼짐"))) || "없는 파일" });
    return;
  }

  const buf = Buffer.from(f.text, "utf8");   // readFile 은 텍스트로 준다 — 아래에서 다시 원본으로
  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("content-disposition", `attachment; filename="${p.split("/").pop()}"`);
  res.setHeader("cache-control", "public, max-age=3600");
  res.status(200).send(buf);
};
