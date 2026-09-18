// 라이선스 알맹이 — 오토데스크 방식을 따라간다.
//
//   사람이 키를 들고 다니지 않는다.  사람이 받는 것은 "시리얼(구매 증서)" 하나뿐이고,
//   실제 라이선스(대여증, lease)는 서버가 그 PC 앞으로 발급한다.
//
//     구매        관리자가 엔타이틀먼트(계약)를 만든다      data/entitlements.json
//                 -> 시리얼 BSPX-XXXX-XXXX-XXXX 가 나온다
//     활성화      런처가 시리얼 + PC 이름을 보낸다           /api/activate
//                 -> 좌석이 남으면 자리를 잡고 lease 를 준다  data/activations.json
//     쓰는 동안   런처가 주기적으로 lease 를 갱신한다        /api/validate
//                 -> 끊긴 계약·좌석 회수면 여기서 막힌다
//     반납        PC 를 바꾸면 자리를 돌려준다               /api/deactivate
//
//   lease 는 서명된 문자열이라 서버가 잠깐 죽어도 유예 기간(GRACE) 동안은 그대로 쓴다.

const crypto = require("crypto");
const { readFile, writeFile } = require("./_store");

const SECRET = process.env.LICENSE_SECRET || "change-me-in-vercel-env";
const ENT = "data/entitlements.json";
const ACT = "data/activations.json";

const LEASE_DAYS = 30;     // 대여증 유효 기간
const GRACE_DAYS = 14;     // 서버에 못 닿아도 버티는 기간 (런처가 본다)

function b64u(s) { return Buffer.from(s, "utf8").toString("base64url"); }
function unb64u(s) { return Buffer.from(s, "base64url").toString("utf8"); }
function mac(s) { return crypto.createHmac("sha256", SECRET).update(s).digest("base64url"); }

// 시리얼 — 사람이 받아 적는 것.  BSPX-ABCD-EFGH-IJKL
function makeSerial() {
  const raw = crypto.randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const s = (raw + "XXXXXXXXXXXX").slice(0, 12);
  return `BSPX-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

// 대여증 — 서버가 PC 앞으로 발급한다 (사람이 옮겨 적을 일 없다)
function makeLease(ent, machine, until) {
  const body = `${ent.eid}|${ent.product}|${machine}|${until}|${ent.org}`;
  return `${b64u(body)}.${mac(body).slice(0, 24)}`;
}

function readLease(lease) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{24})$/.exec(String(lease || "").trim());
  if (!m) return null;
  if (mac(unb64u(m[1])).slice(0, 24) !== m[2]) return null;
  const [eid, product, machine, until, org] = unb64u(m[1]).split("|");
  return { eid, product, machine, until, org };
}

async function loadJson(path) {
  const f = await readFile(path);
  if (!f || f.missing || !f.text) return [];
  try { const j = JSON.parse(f.text); return Array.isArray(j) ? j : []; } catch { return []; }
}

const loadEnts = () => loadJson(ENT);
const loadActs = () => loadJson(ACT);
const saveEnts = (l, m) => writeFile(ENT, JSON.stringify(l, null, 2), m || "entitlements");
const saveActs = (l, m) => writeFile(ACT, JSON.stringify(l, null, 2), m || "activations");

function days(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

module.exports = {
  ENT, ACT, LEASE_DAYS, GRACE_DAYS,
  makeSerial, makeLease, readLease,
  loadEnts, loadActs, saveEnts, saveActs, days,
};
