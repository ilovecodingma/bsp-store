// 우리 서버 저장소 — 깃허브 저장소의 파일 한 장에 줄 단위로 쌓는다.
//   Vercel 은 디스크가 없어서(요청이 끝나면 사라진다) 밖에 둬야 한다.
//   DB 를 붙이기 전까지 이 방식으로 간다 : data/events.jsonl 에 한 줄씩 append.
//
//   환경변수
//     GH_TOKEN  : 저장소에 쓸 수 있는 토큰
//     GH_REPO   : "ilovecodingma/bsp-store"
//     GH_BRANCH : 기본 master

const REPO = process.env.GH_REPO || "";
const TOKEN = process.env.GH_TOKEN || "";
const BRANCH = process.env.GH_BRANCH || "master";
const PATH = "data/events.jsonl";
const API = "https://api.github.com";

async function gh(method, url, body) {
  const r = await fetch(url.startsWith("http") ? url : API + url, {
    method,
    headers: {
      authorization: "Bearer " + TOKEN,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "bsp-store",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

function enabled() {
  return TOKEN.length > 0 && REPO.length > 0;
}

// 지금 내용을 통째로 읽는다 (sha 도 같이 — 쓸 때 필요하다)
async function read() {
  if (!enabled()) return { lines: [], sha: null, off: true };
  const r = await gh("GET", `/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (r.status === 404) return { lines: [], sha: null };
  if (!r.ok) return { lines: [], sha: null, err: r.status + " " + r.text.slice(0, 120) };
  const raw = Buffer.from(r.json.content || "", "base64").toString("utf8");
  const lines = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { lines, sha: r.json.sha };
}

// 여러 줄을 뒤에 붙인다.  같은 순간에 둘이 쓰면 하나는 409 — 한 번 다시 해 본다.
async function append(rows) {
  if (!enabled()) return { ok: false, off: true };
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    const cur = await read();
    const all = cur.lines.concat(rows).slice(-5000);       // 최근 5,000줄만 남긴다
    const content = Buffer.from(all.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8").toString("base64");
    const put = await gh("PUT", `/repos/${REPO}/contents/${PATH}`, {
      message: `events +${rows.length}`,
      content,
      branch: BRANCH,
      sha: cur.sha || undefined,
    });
    if (put.ok) return { ok: true, total: all.length };
    if (put.status !== 409) return { ok: false, err: put.status + " " + put.text.slice(0, 160) };
  }
  return { ok: false, err: "409 두 번" };
}

// 아무 파일이나 읽고 쓴다 (판매자가 올린 앱 목록·설치본에 쓴다)
async function readFile(path) {
  if (!enabled()) return { off: true };
  const r = await gh("GET", `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (r.status === 404) return { missing: true, sha: null };
  if (!r.ok) return { err: r.status + " " + r.text.slice(0, 120) };
  return { sha: r.json.sha, text: Buffer.from(r.json.content || "", "base64").toString("utf8") };
}

async function writeFile(path, buf, message) {
  if (!enabled()) return { ok: false, off: true };
  const cur = await gh("GET", `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  const sha = cur.ok ? cur.json.sha : undefined;
  const put = await gh("PUT", `/repos/${REPO}/contents/${path}`, {
    message: message || ("update " + path),
    content: Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(String(buf), "utf8").toString("base64"),
    branch: BRANCH,
    sha,
  });
  return put.ok ? { ok: true } : { ok: false, err: put.status + " " + put.text.slice(0, 160) };
}

module.exports = { read, append, enabled, readFile, writeFile };
