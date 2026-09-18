# Vercel 에 올린다 — Node 없이, 토큰 하나로.
#   쓰는 법 :  set VERCEL_TOKEN=xxxx  &&  python deploy_vercel.py
#   하는 일 :  파일 업로드 -> 배포 만들기 -> 환경변수(LICENSE_SECRET / ADMIN_TOKEN) 넣기 -> 주소 출력
import hashlib, json, os, secrets, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
API = "https://api.vercel.com"
TOKEN = os.environ.get("VERCEL_TOKEN", "").strip()
NAME = os.environ.get("VERCEL_PROJECT", "bsp-store")
SKIP = {".git", "launcher", "_logs", ".vercel", "__pycache__"}
SKIP_FILES = {"server.py", "deploy_vercel.py", ".gitignore", "README.md"}


def req(method, path, data=None, headers=None, raw=None):
    url = path if path.startswith("http") else API + path
    h = {"Authorization": "Bearer " + TOKEN}
    if headers:
        h.update(headers)
    body = raw
    if data is not None:
        body = json.dumps(data).encode()
        h["content-type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        raise SystemExit(f"[{e.code}] {method} {path}\n{txt}")


def collect():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP]
        for fn in filenames:
            if fn in SKIP_FILES:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            out.append((rel, full))
    return out


def main():
    if not TOKEN:
        raise SystemExit("VERCEL_TOKEN 이 없습니다.  vercel.com/account/tokens 에서 만들어 환경변수로 주세요.")

    files = collect()
    print(f"올릴 파일 {len(files)}개")

    payload = []
    for rel, full in files:
        blob = open(full, "rb").read()
        sha = hashlib.sha1(blob).hexdigest()
        req("POST", "/v2/files", raw=blob, headers={
            "x-vercel-digest": sha,
            "content-length": str(len(blob)),
            "content-type": "application/octet-stream",
        })
        payload.append({"file": rel, "sha": sha, "size": len(blob)})
        print(f"  {rel}  {len(blob):,} bytes")

    dep = req("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
        "name": NAME,
        "files": payload,
        "target": "production",
        "projectSettings": {"framework": None, "buildCommand": None, "outputDirectory": None},
    })
    dep_id, url = dep["id"], dep["url"]
    print(f"\n배포 시작  https://{url}")

    # 환경변수 — 없으면 새로 만들어 넣는다
    proj = dep.get("projectId") or NAME
    have = {e["key"] for e in req("GET", f"/v9/projects/{proj}/env").get("envs", [])}
    want = {
        "LICENSE_SECRET": os.environ.get("LICENSE_SECRET") or secrets.token_urlsafe(32),
        "ADMIN_TOKEN": os.environ.get("ADMIN_TOKEN") or secrets.token_urlsafe(12),
    }
    for k, v in want.items():
        if k in have:
            print(f"환경변수 {k} : 이미 있음")
            continue
        req("POST", f"/v10/projects/{proj}/env", {
            "key": k, "value": v, "type": "encrypted",
            "target": ["production", "preview", "development"],
        })
        print(f"환경변수 {k} = {v}")

    for _ in range(90):
        d = req("GET", f"/v13/deployments/{dep_id}")
        st = d.get("readyState")
        if st in ("READY", "ERROR", "CANCELED"):
            print(f"\n상태 {st}")
            if st == "READY":
                alias = d.get("alias") or []
                print("주소 :")
                for a in [url] + alias:
                    print("   https://" + a)
                print("\n환경변수를 방금 넣었으면 한 번 더 배포해야 API 가 그 값을 씁니다.")
            break
        time.sleep(3)
    else:
        print("아직 빌드 중입니다 — vercel.com 에서 확인하세요.")


if __name__ == "__main__":
    main()
