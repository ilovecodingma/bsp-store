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

module.exports = { makeKey, verifyKey, sign, adminOk };
