// 키 서명·검증 공통 —  DB 없이 키 자체에 내용을 담는다.
//   payload = base64url("org|seats|expires"),  mac = HMAC-SHA256 앞 10자
//   운영 전에 Vercel 환경변수 LICENSE_SECRET / ADMIN_TOKEN 을 반드시 넣을 것.

const crypto = require("crypto");

const SECRET = process.env.LICENSE_SECRET || "change-me-in-vercel-env";

function b64u(s) { return Buffer.from(s, "utf8").toString("base64url"); }
function unb64u(s) { return Buffer.from(s, "base64url").toString("utf8"); }

function mac(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 10);
}

function makeKey(org, seats, expires) {
  const payload = b64u(`${org}|${seats}|${expires}`);
  return `BSP.${payload}.${mac(payload)}`;
}

function verifyKey(key) {
  const m = /^BSP\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{10})$/.exec(String(key || "").trim());
  if (!m) return { ok: false, reason: "키 꼴이 아닙니다" };
  const [, payload, sig] = m;
  if (mac(payload) !== sig) return { ok: false, reason: "서명이 맞지 않습니다" };
  const [org, seats, expires] = unb64u(payload).split("|");
  if (!org || !expires) return { ok: false, reason: "키 안이 비었습니다" };
  return { ok: true, rec: { org, seats: Number(seats) || 1, expires } };
}

function sign(body) {
  const m2 = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${b64u(body)}.${m2}`;
}

function adminOk(req) {
  const want = process.env.ADMIN_TOKEN || "";
  const got = req.headers["x-admin-token"] || "";
  return want.length > 0 && got === want;
}

// 관리자 확인 — 환경변수 토큰이거나, 역할이 admin 인 계정의 키면 통과
//   헤더 :  x-admin-token: <ADMIN_TOKEN>   또는   x-bsp-key: BSP.xxx.yyy
async function adminAuth(req) {
  if (adminOk(req)) return { ok: true, by: "token", rank: 3, role: "super" };

  const key = String(req.headers["x-bsp-key"] || "").trim();
  if (!key) return { ok: false, reason: "관리자 토큰이나 관리자 키가 필요합니다" };
  if (!verifyKey(key).ok) return { ok: false, reason: "키 서명이 맞지 않습니다" };

  try {
    const { readFile } = require("./_store");
    const f = await readFile("data/users.json");
    if (!f || !f.text) return { ok: false, reason: "계정 목록이 없습니다" };
    const list = JSON.parse(f.text);
    const u = (Array.isArray(list) ? list : []).find((x) => x.key === key);
    if (!u) return { ok: false, reason: "없는 계정" };
    if (u.status === "revoked") return { ok: false, reason: "끊긴 계정" };
    if (u.role !== "admin" && u.role !== "super") return { ok: false, reason: "관리자만 됩니다" };
    if (new Date(u.expires) < new Date()) return { ok: false, reason: "만료된 계정" };
    return { ok: true, by: u.name, rank: u.role === "super" ? 3 : 2, role: u.role, uid: u.uid };
  } catch (e) {
    return { ok: false, reason: "확인 실패 : " + String(e.message).slice(0, 60) };
  }
}

module.exports = { makeKey, verifyKey, sign, adminOk, adminAuth };
