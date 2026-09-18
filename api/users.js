// 사용자 — DB 없이 JSON 한 장(data/users.json)으로 간다.
//   커지면 그대로 몽고/MySQL 에 부어 넣으면 되게, 줄 모양을 단순하게 유지한다.
//
//   GET    /api/users                      (관리자)  목록
//   POST   /api/users  { name, org, role, seats, expires, note }   (관리자)  계정 + 키 발급
//   PATCH  /api/users  { uid, status }     (관리자)  active | revoked
//
//   role : admin(관리자) | publisher(판매자) | user(사용자)
//   키는 계정에 묶인다 — 계정을 revoked 로 두면 그 키만 막힌다 (시크릿은 그대로).

const crypto = require("crypto");
const { readFile, writeFile, enabled } = require("./_store");
const { makeKey, adminAuth } = require("./_lib");

const PATH = "data/users.json";
const ROLES = new Set(["admin", "publisher", "user"]);

async function load() {
  const f = await readFile(PATH);
  if (!f || f.missing || !f.text) return [];
  try { const j = JSON.parse(f.text); return Array.isArray(j) ? j : (j.users || []); }
  catch { return []; }
}

async function save(list, msg) {
  return writeFile(PATH, JSON.stringify(list, null, 2), msg || "users");
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const who = await adminAuth(req);
  if (!who.ok) { res.status(401).json({ ok: false, reason: who.reason }); return; }
  if (!enabled()) { res.status(200).json({ ok: false, reason: "저장소가 연결돼 있지 않습니다" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (req.method === "GET") {
    const list = await load();
    res.status(200).json({ ok: true, users: list, count: list.length });
    return;
  }

  if (req.method === "POST") {
    const name = String(body.name || "").trim();
    const org = String(body.org || "").trim();
    const role = ROLES.has(String(body.role)) ? String(body.role) : "user";
    const seats = Number(body.seats) || 1;
    const expires = String(body.expires || "").trim();

    if (!name) { res.status(200).json({ ok: false, reason: "이름이 필요합니다" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) { res.status(200).json({ ok: false, reason: "만료일은 2027-12-31 꼴" }); return; }

    const list = await load();
    const uid = "u" + crypto.randomBytes(4).toString("hex");
    const key = makeKey(`${org || name}#${uid}`, seats, expires);

    const user = {
      uid, name, org, role, seats, expires, key,
      status: "active",
      note: String(body.note || "").slice(0, 120),
      created: new Date().toISOString().slice(0, 10),
    };
    list.push(user);
    const w = await save(list, `user + ${name}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, user });
    return;
  }

  if (req.method === "PATCH") {
    const uid = String(body.uid || "");
    const status = body.status === "revoked" ? "revoked" : "active";
    const list = await load();
    const u = list.find((x) => x.uid === uid);
    if (!u) { res.status(200).json({ ok: false, reason: "없는 계정" }); return; }
    u.status = status;
    const w = await save(list, `user ${status} ${u.name}`);
    if (!w.ok) { res.status(200).json({ ok: false, reason: "저장 실패 : " + w.err }); return; }
    res.status(200).json({ ok: true, user: u });
    return;
  }

  res.status(405).json({ ok: false, reason: "GET / POST / PATCH" });
};

module.exports.load = load;
