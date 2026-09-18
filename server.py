# BSP Store 로컬 서버 — Vercel 없이 그대로 띄워 보는 용도.
#   파이썬 기본 모듈만 쓴다.  api/*.js 와 같은 규칙으로 키를 서명·검증한다.
#     python server.py [포트]
import base64, gzip, hashlib, hmac, json, os, re, sys
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SECRET = os.environ.get("LICENSE_SECRET", "bsp-local-dev-secret").encode()
ADMIN = os.environ.get("ADMIN_TOKEN", "bsp-admin")
LOGDIR = os.path.join(ROOT, "_logs")

DEMO = {"BSP-DEMO-0000-0001": {"org": "BSP Engineering (사내)", "seats": 50, "expires": "2027-12-31"}}


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def mac(payload):
    return b64u(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())


def make_key(org, seats, expires):
    p = b64u(f"{org}|{seats}|{expires}".encode())
    return f"BSP.{p}.{mac(p)[:10]}"


def verify_key(key):
    m = re.match(r"^BSP\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{10})$", (key or "").strip())
    if not m:
        return None, "키 꼴이 아닙니다"
    p, sig = m.group(1), m.group(2)
    if mac(p)[:10] != sig:
        return None, "서명이 맞지 않습니다"
    try:
        org, seats, expires = unb64u(p).decode().split("|")
    except Exception:
        return None, "키 안이 깨졌습니다"
    return {"org": org, "seats": int(seats or 1), "expires": expires}, None


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % a))

    def send_json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def end_headers(self):
        if self.path.startswith("/downloads/"):
            self.send_header("content-disposition", "attachment")
        super().end_headers()

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/api/license":
            d = self.body()
            key = str(d.get("key", "")).strip()
            rec = DEMO.get(key.upper())
            if not rec:
                rec, err = verify_key(key)
                if not rec:
                    return self.send_json({"ok": False, "reason": err})
            if rec["expires"] < date.today().isoformat():
                return self.send_json({"ok": False, "reason": f"만료됨 ({rec['expires']})"})
            token = b64u(f"{key}|{d.get('machine','?')}|{rec['expires']}".encode()) + "." + mac(key)
            return self.send_json({"ok": True, "token": token, **rec})

        if p == "/api/issue":
            if self.headers.get("x-admin-token") != ADMIN:
                return self.send_json({"ok": False, "reason": "관리자 토큰이 필요합니다"}, 401)
            d = self.body()
            org = str(d.get("org", "")).strip()
            seats = int(d.get("seats") or 1)
            exp = str(d.get("expires", "")).strip()
            if not org:
                return self.send_json({"ok": False, "reason": "회사·팀 이름을 넣으세요"})
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", exp):
                return self.send_json({"ok": False, "reason": "만료일은 2027-12-31 꼴"})
            return self.send_json({"ok": True, "key": make_key(org, seats, exp),
                                   "org": org, "seats": seats, "expires": exp})

        if p == "/api/logs":
            d = self.body()
            files = d.get("files") or []
            os.makedirs(LOGDIR, exist_ok=True)
            lines = []
            for f in files[:20]:
                try:
                    text = gzip.decompress(base64.b64decode(f.get("gz", ""))).decode("utf-8", "replace")
                except Exception:
                    text = ""
                runs = (re.search(r"구간 (\d+)개", text) or [None, ""])[1] if text else ""
                dims = len(re.findall(r"치수 (\d+)", text))
                err = (re.search(r"^.*(오류|실패|error).*$", text, re.I | re.M) or [""])[0][:200]
                lines.append({"machine": d.get("machine"), "name": f.get("name"),
                              "size": f.get("size"), "runs": runs, "dims": dims, "err": err})
            with open(os.path.join(LOGDIR, "logs.jsonl"), "a", encoding="utf-8") as w:
                for ln in lines:
                    w.write(json.dumps(ln, ensure_ascii=False) + "\n")
            print("[logs]", d.get("machine"), len(files), "개")
            return self.send_json({"ok": True, "got": len(files)})

        self.send_json({"ok": False, "reason": "그런 길은 없습니다"}, 404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"BSP Store  http://127.0.0.1:{port}   (관리자 토큰 {ADMIN})")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
