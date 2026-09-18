// 요청함 — 대표님(또는 그쪽 클로드 코드)이 토큰으로 글을 넣으면 여기 쌓인다.
//   개발 쪽은 이 함을 보고 일을 집어 간다.  모든 글과 처리 내용은 깃에 남는다.
//
//   POST /api/inbox   { text, kind, urgency }      (super/admin 토큰)  넣기
//   GET  /api/inbox?status=open                    (super/admin)       보기
//   PATCH /api/inbox  { id, status, reply }        (super/admin)       처리 표시·답장
//
//   kind : ask(물어봄) | change(고쳐줘) | bug(안 됨) | idea(해보면)
//   status : open -> doing -> done

const crypto = require("crypto");
const { adminAuth } = require("./_lib");
const { readFile, writeFile } = require("./_store");

const PATH = "data/inbox.json";

async function load() {
  const f = await readFile(PATH);
  if (!f || f.missing || !f.text) return [];
  try { const j = JSON.parse(f.text); return Array.isArray(j) ? j : []; } catch { return []; }
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const url = new URL(req.url, "https://x");
  const list = await load();

  if (req.method === "GET") {
    const want = url.searchParams.get("status");
    const rows = want ? list.filter((x) => x.status === want) : list;
    res.status(200).json({ ok: true, items: rows.slice(-100).reverse(), open: list.filter((x) => x.status === "open").length });
    return;
  }

  if (req.method === "POST") {
    const text = String(b.text || "").trim();
    if (!text) { res.status(200).json({ ok: false, reason: "내용이 비었습니다" }); return; }

    const item = {
      id: "r" + crypto.randomBytes(3).toString("hex"),
      t: new Date().toISOString(),
      by: who.by,
      role: who.role || "admin",
      kind: ["ask", "change", "bug", "idea"].includes(String(b.kind)) ? String(b.kind) : "ask",
      urgency: ["now", "soon", "later"].includes(String(b.urgency)) ? String(b.urgency) : "soon",
      text: text.slice(0, 2000),
      status: "open",
      reply: "",
    };
    list.push(item);
    const w = await writeFile(PATH, JSON.stringify(list, null, 2), `inbox ${item.kind} by ${who.by}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, item, note: "받았습니다.  처리되면 이 글의 status 가 done 이 됩니다." });
    return;
  }

  if (req.method === "PATCH") {
    const it = list.find((x) => x.id === String(b.id || ""));
    if (!it) { res.status(200).json({ ok: false, reason: "없는 글" }); return; }
    if (["open", "doing", "done"].includes(String(b.status))) it.status = String(b.status);
    if (typeof b.reply === "string") it.reply = b.reply.slice(0, 2000);
    it.handledBy = who.by;
    it.handledAt = new Date().toISOString();
    const w = await writeFile(PATH, JSON.stringify(list, null, 2), `inbox ${it.status} ${it.id}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, item: it });
    return;
  }

  res.status(405).json({ ok: false, reason: "GET / POST / PATCH" });
};
