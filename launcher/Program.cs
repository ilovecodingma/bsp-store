// BSP 런처 — 스토어 목록을 읽어 라이선스를 확인하고 CDN 에서 받아 설치한다.
//   내려받기는 전부 이 런처를 거친다 (스토어 웹에는 직접 받는 길을 두지 않는다).
//   설치 뒤에는 트레이에 남아 앱이 남긴 기록을 조용히 모아 보낸다.
//
//   .NET Framework 4.8 (윈도우에 이미 있다).  설치가 필요 없는 단일 exe.
//
//   흐름 :  apps.json -> 키 확인(/api/license) -> 내려받기(CDN) -> SHA-256 대조 -> msiexec /qn
//           그 뒤 10분마다 : 바탕화면의 NOZ_* 기록을 모아 /api/logs 로 보냄
//
//   스토어 주소는 BSP_STORE 환경변수로 덮어쓸 수 있다 (시험용).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace BSPLauncher
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.Run(new MainForm());
        }
    }

    class App
    {
        public string Id, Name, Summary, Status, Version, Target, Released, Sha256, Download, Publisher;
        public string Host = "windows";   // autocad | revit | windows
        public string Kind = "msi";       // msi | bundle(오토캐드) | addin(리빗)
        public long Size;
    }

    // 이 PC 에 깔린 오토데스크 제품 찾기 — 애드온을 어디에 넣을지 정한다
    static class Hosts
    {
        public static List<string> Revit()      // 2024, 2025 …
        {
            var v = new List<string>();
            try
            {
                string root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Autodesk", "Revit", "Addins");
                if (Directory.Exists(root))
                    foreach (string d in Directory.GetDirectories(root))
                        v.Add(Path.GetFileName(d));
            }
            catch { }
            return v;
        }

        public static bool AutoCad()
        {
            try
            {
                string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Autodesk");
                if (!Directory.Exists(p)) return false;
                foreach (string d in Directory.GetDirectories(p))
                    if (Path.GetFileName(d).StartsWith("AutoCAD", StringComparison.OrdinalIgnoreCase)) return true;
            }
            catch { }
            return false;
        }

        // 애드온이 들어가는 자리
        public static string AcadPlugins()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                                "Autodesk", "ApplicationPlugins");
        }

        public static string RevitAddins(string ver)
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                                "Autodesk", "Revit", "Addins", ver);
        }
    }

    class MainForm : Form
    {
        // 스토어 주소 — 배포 뒤 이 한 줄만 바꾸면 된다
        static readonly string STORE =
            Environment.GetEnvironmentVariable("BSP_STORE") ?? "https://bsp-store.vercel.app";

        static readonly string CFGDIR = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BSP");
        static readonly string CFG = Path.Combine(CFGDIR, "license.txt");
        static readonly string SENT = Path.Combine(CFGDIR, "sent.txt");   // 이미 보낸 기록 (이름|크기|시각)

        // 애드온(오토캐드 플러그인)이 여기에 떨구면 런처가 서버로 넘긴다
        //   *.json -> /api/event   (한 줄 사건)
        //   *.txt  -> /api/logs    (기록 원문)
        static readonly string OUTBOX = Path.Combine(CFGDIR, "outbox");
        static readonly string OUTDONE = Path.Combine(CFGDIR, "outbox-sent");

        readonly ListBox _list = new ListBox();
        readonly TextBox _key = new TextBox();
        readonly Button _check = new Button();
        readonly Button _install = new Button();
        readonly Label _msg = new Label();
        readonly ProgressBar _bar = new ProgressBar();
        readonly CheckBox _logOn = new CheckBox();
        readonly Label _logMsg = new Label();
        readonly NotifyIcon _tray = new NotifyIcon();
        readonly Timer _logTimer = new Timer();
        readonly List<App> _apps = new List<App>();
        readonly List<string> _revit = Hosts.Revit();
        readonly bool _acad = Hosts.AutoCad();
        string _cdn = "";          // apps.json 의 cdn — 비면 스토어에서 바로 받는다
        string _token = "";
        bool _reallyQuit = false;

        public MainForm()
        {
            Text = "BSP 런처";
            Width = 640; Height = 520;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(13, 15, 19);
            ForeColor = Color.FromArgb(232, 236, 243);
            Font = new Font("맑은 고딕", 9F);

            var title = new Label
            {
                Text = "BSP Store", AutoSize = true, Left = 18, Top = 14,
                Font = new Font("맑은 고딕", 14F, FontStyle.Bold),
                ForeColor = Color.FromArgb(48, 128, 255)
            };
            var sub = new Label
            {
                Text = "라이선스 키를 넣고 앱을 고른 뒤 설치를 누르세요.  받기는 런처만 합니다.",
                AutoSize = true, Left = 20, Top = 44,
                ForeColor = Color.FromArgb(154, 164, 181)
            };

            _key.Left = 20; _key.Top = 74; _key.Width = 340;
            _key.BackColor = Color.FromArgb(7, 9, 13);
            _key.ForeColor = Color.White; _key.BorderStyle = BorderStyle.FixedSingle;
            _key.Font = new Font("Consolas", 10F);
            _key.Text = LoadKey();

            _check.Text = "키 확인"; _check.Left = 370; _check.Top = 72; _check.Width = 100; _check.Height = 27;
            _check.FlatStyle = FlatStyle.Flat; _check.BackColor = Color.FromArgb(254, 110, 0);
            _check.ForeColor = Color.White; _check.FlatAppearance.BorderSize = 0;
            _check.Click += (s, e) => CheckKey();

            _list.Left = 20; _list.Top = 116; _list.Width = 580; _list.Height = 200;
            _list.BackColor = Color.FromArgb(7, 9, 13);
            _list.ForeColor = Color.FromArgb(232, 236, 243);
            _list.BorderStyle = BorderStyle.FixedSingle;
            _list.Font = new Font("맑은 고딕", 10F);
            _list.IntegralHeight = false;

            _bar.Left = 20; _bar.Top = 326; _bar.Width = 580; _bar.Height = 6;
            _bar.Style = ProgressBarStyle.Continuous; _bar.Visible = false;

            _install.Text = "설치"; _install.Left = 480; _install.Top = 342; _install.Width = 120; _install.Height = 34;
            _install.FlatStyle = FlatStyle.Flat; _install.BackColor = Color.FromArgb(48, 128, 255);
            _install.ForeColor = Color.White; _install.FlatAppearance.BorderSize = 0;
            _install.Font = new Font("맑은 고딕", 10F, FontStyle.Bold);
            _install.Click += (s, e) => Install();

            _msg.Left = 20; _msg.Top = 348; _msg.Width = 450; _msg.Height = 46;
            _msg.ForeColor = Color.FromArgb(154, 164, 181);

            // ── 기록 모으기 ───────────────────────────────────────────
            _logOn.Text = "앱 기록을 모아 보냄 (자동 기록·오류)";
            _logOn.Left = 20; _logOn.Top = 404; _logOn.Width = 340; _logOn.Checked = true;
            _logOn.ForeColor = Color.FromArgb(154, 164, 181);
            _logOn.CheckedChanged += (s, e) => { _logTimer.Enabled = _logOn.Checked; LogSay(_logOn.Checked ? "켬" : "끔"); };

            _logMsg.Left = 20; _logMsg.Top = 428; _logMsg.Width = 580; _logMsg.Height = 20;
            _logMsg.ForeColor = Color.FromArgb(110, 120, 136);
            _logMsg.Font = new Font("Consolas", 8.5F);

            Controls.AddRange(new Control[] { title, sub, _key, _check, _list, _bar, _install, _msg, _logOn, _logMsg });

            _tray.Icon = SystemIcons.Application;
            _tray.Text = "BSP 런처 — 기록 모으는 중";
            _tray.Visible = true;
            _tray.DoubleClick += (s, e) => { Show(); WindowState = FormWindowState.Normal; };
            var menu = new ContextMenuStrip();
            menu.Items.Add("열기", null, (s, e) => { Show(); WindowState = FormWindowState.Normal; });
            menu.Items.Add("지금 기록 보내기", null, (s, e) => SendLogs(true));
            menu.Items.Add("끝내기", null, (s, e) => { _reallyQuit = true; Close(); });
            _tray.ContextMenuStrip = menu;

            _logTimer.Interval = 10 * 60 * 1000;   // 10분
            _logTimer.Tick += (s, e) => { SendLogs(false); LoadApps(); };
            _logTimer.Enabled = true;

            Shown += (s, e) => { LoadApps(); SendLogs(false); };
            FormClosing += (s, e) =>
            {
                if (!_reallyQuit && e.CloseReason == CloseReason.UserClosing)
                {   // 창을 닫아도 트레이에 남아 기록을 계속 모은다
                    e.Cancel = true; Hide();
                    _tray.ShowBalloonTip(2000, "BSP 런처", "트레이에서 계속 돕니다.", ToolTipIcon.Info);
                }
                else _tray.Visible = false;
            };
        }

        // ── 목록 ────────────────────────────────────────────────────────
        void LoadApps()
        {
            try
            {
                // /api/apps = 기본 목록 + 판매자가 올린 것 (올리면 바로 보인다)
                string json;
                try { json = Get(STORE + "/api/apps"); }
                catch { json = Get(STORE + "/apps.json"); }
                _cdn = (Str(json, "cdn") ?? "").TrimEnd('/');
                _apps.Clear();
                _list.Items.Clear();
                foreach (string block in SplitObjects(Cut(json, "\"apps\"")))
                {
                    var a = new App
                    {
                        Id = Str(block, "id"),
                        Name = Str(block, "name"),
                        Summary = Str(block, "summary"),
                        Status = Str(block, "status"),
                        Version = Str(block, "version"),
                        Target = Str(block, "target"),
                        Released = Str(block, "released"),
                        Sha256 = Str(block, "sha256"),
                        Download = Str(block, "download"),
                        Publisher = Str(block, "publisher") ?? "",
                        Host = Str(block, "host") ?? "windows",
                        Kind = Str(block, "kind") ?? "msi",
                        Size = Num(block, "size")
                    };
                    if (a.Name == null) continue;
                    _apps.Add(a);
                    string where = a.Host == "revit"
                        ? (_revit.Count > 0 ? "리빗 " + string.Join(",", _revit.ToArray()) : "리빗 없음")
                        : a.Host == "autocad" ? (_acad ? "오토캐드" : "오토캐드 없음") : "윈도우";
                    string pub = string.IsNullOrEmpty(a.Publisher) ? "" : "  · " + a.Publisher;
                    _list.Items.Add(a.Status == "live"
                        ? string.Format("{0}{1}   v{2}   [{3}]   ({4:N0} KB)", a.Name, pub, a.Version, where, a.Size / 1024)
                        : string.Format("{0}{1}   준비중   [{2}]", a.Name, pub, where));
                }
                if (_list.Items.Count > 0) _list.SelectedIndex = 0;
                Say(string.Format("앱 {0}개 · 이 PC : {1}{2}",
                    _apps.Count,
                    _acad ? "오토캐드 " : "",
                    _revit.Count > 0 ? "리빗 " + string.Join(",", _revit.ToArray()) : (_acad ? "" : "오토데스크 제품 못 찾음")));
            }
            catch (Exception ex)
            {
                Say("스토어에 닿지 못했습니다 : " + ex.Message, true);
            }
        }

        // ── 라이선스 ────────────────────────────────────────────────────
        bool CheckKey()
        {
            string key = _key.Text.Trim().ToUpperInvariant();
            if (key.Length == 0) { Say("키를 넣으세요.", true); return false; }
            try
            {
                string body = "{\"key\":\"" + key + "\",\"machine\":\"" + Machine() + "\"}";
                string res = Post(STORE + "/api/license", body, "application/json");
                if (!res.Contains("\"ok\":true"))
                {
                    Say("사용할 수 없는 키 : " + (Str(res, "reason") ?? "확인 실패"), true);
                    return false;
                }
                _token = Str(res, "token") ?? "";
                SaveKey(key);
                Say("확인됨 — " + Str(res, "org") + " · 만료 " + Str(res, "expires"));
                return true;
            }
            catch (Exception ex)
            {
                Say("라이선스 서버에 닿지 못했습니다 : " + ex.Message, true);
                return false;
            }
        }

        // ── 설치 ────────────────────────────────────────────────────────
        void Install()
        {
            if (_list.SelectedIndex < 0 || _list.SelectedIndex >= _apps.Count) return;
            App a = _apps[_list.SelectedIndex];
            if (a.Status != "live") { Say("아직 준비중인 앱입니다.", true); return; }
            if (_token.Length == 0 && !CheckKey()) return;

            // 호스트가 없으면 미리 막는다 — 리빗 애드온은 리빗에, 캐드 것은 캐드에
            if (a.Host == "revit" && _revit.Count == 0)
            { Say("이 PC 에 리빗이 없습니다 (Addins 폴더를 못 찾음).", true); return; }
            if (a.Host == "autocad" && !_acad)
            { Say("이 PC 에 오토캐드가 없습니다.", true); return; }

            // 받는 곳 : cdn 이 있으면 CDN, 없으면 스토어
            string baseUrl = a.Download.StartsWith("http") ? "" : (_cdn.Length > 0 ? _cdn : STORE);
            string url = baseUrl + a.Download;
            string name = Path.GetFileName(new Uri(url.Contains("?") ? url.Split('?')[0] : url).AbsolutePath);
            if (name.Length == 0) name = a.Id + (a.Kind == "msi" ? ".msi" : ".zip");
            string tmp = Path.Combine(Path.GetTempPath(), name);

            try
            {
                _install.Enabled = false; _bar.Visible = true; _bar.Value = 0;
                Say("내려받는 중 …  " + url);

                using (var wc = new WebClient())
                {
                    wc.Headers.Add("x-bsp-token", _token);
                    wc.DownloadProgressChanged += (s2, e2) => { _bar.Value = e2.ProgressPercentage; Application.DoEvents(); };
                    bool done = false;
                    wc.DownloadFileCompleted += (s2, e2) => { done = true; };
                    wc.DownloadFileAsync(new Uri(url), tmp);
                    while (!done) { Application.DoEvents(); System.Threading.Thread.Sleep(30); }
                }

                string got = Sha256(tmp);
                if (a.Sha256 != null && a.Sha256.Length == 64 &&
                    !string.Equals(got, a.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    Say("받은 파일이 스토어의 것과 다릅니다.  설치를 멈춥니다.\n" + got, true);
                    return;
                }

                if (a.Kind == "msi")
                {
                    Say("설치하는 중 …  (오토캐드는 자동으로 닫힙니다)");
                    var p = Process.Start(new ProcessStartInfo("msiexec.exe", "/i \"" + tmp + "\" /qn")
                    { UseShellExecute = true });
                    p.WaitForExit();
                    Say(p.ExitCode == 0
                        ? "설치 끝났습니다 — " + a.Name + " v" + a.Version
                        : "설치가 " + p.ExitCode + " 로 끝났습니다.  msi 를 손으로 실행해 보세요 : " + tmp,
                        p.ExitCode != 0);
                    Event("install", a.Id, a.Version, p.ExitCode == 0, "msiexec " + p.ExitCode);
                }
                else if (a.Kind == "bundle")      // 오토캐드 : ApplicationPlugins 에 푼다
                {
                    string dest = Path.Combine(Hosts.AcadPlugins(), a.Id + ".bundle");
                    Unzip(tmp, dest);
                    Say("오토캐드에 넣었습니다 — " + dest + "\n오토캐드를 다시 켜면 리본에 뜹니다.");
                    Event("install", a.Id, a.Version, true, "bundle " + dest);
                }
                else                               // 리빗 : 깔린 버전마다 Addins 에 푼다
                {
                    int done = 0;
                    foreach (string ver in _revit)
                    {
                        try { Unzip(tmp, Hosts.RevitAddins(ver)); done++; }
                        catch (Exception ex) { Say("리빗 " + ver + " 에 넣다 실패 : " + ex.Message, true); }
                    }
                    Say(done > 0
                        ? "리빗 " + string.Join(", ", _revit.ToArray()) + " 에 넣었습니다.  리빗을 다시 켜세요."
                        : "리빗에 넣지 못했습니다.", done == 0);
                    Event("install", a.Id, a.Version, done > 0, "revit " + string.Join(",", _revit.ToArray()));
                }
            }
            catch (Exception ex)
            {
                Say("설치 실패 : " + ex.Message, true);
            }
            finally
            {
                _install.Enabled = true; _bar.Visible = false;
            }
        }

        // ── 기록 모으기 ─────────────────────────────────────────────────
        //   앱이 바탕화면에 남기는 기록만 본다.  사람이 만든 문서는 안 건드린다.
        //   같은 파일은 크기·시각이 바뀔 때만 다시 보낸다.
        static readonly string[] PATTERNS =
        {
            "NOZ_AUTO_*.txt", "NOZ_ERR.txt", "NOZ_IDX.txt", "NOZ_SCAN.txt", "NOZ_VM.txt"
        };

        // 애드온이 outbox 에 떨군 것을 서버로 넘긴다 (런처 = 가운데 라우터)
        int RouteOutbox()
        {
            int n = 0;
            try
            {
                Directory.CreateDirectory(OUTBOX);
                Directory.CreateDirectory(OUTDONE);
                foreach (string f in Directory.GetFiles(OUTBOX))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    try
                    {
                        if (ext == ".json")
                        {
                            string raw = File.ReadAllText(f, Encoding.UTF8).Trim();
                            if (raw.Length == 0) { File.Delete(f); continue; }
                            // 애드온이 적은 것에 PC 이름과 키를 얹어 보낸다
                            string wrapped = "{\"events\":[" + (raw.StartsWith("[") ? raw.Substring(1, raw.Length - 2) : raw) + "]," +
                                             "\"machine\":\"" + Machine() + "\"}";
                            Post(STORE + "/api/event", wrapped, "application/json");
                        }
                        else
                        {
                            var fi = new FileInfo(f);
                            string text = File.ReadAllText(f, Encoding.UTF8);
                            string body = "{\"machine\":\"" + Machine() + "\",\"key\":\"" + Esc(LoadKey()) +
                                          "\",\"launcher\":\"1.0\",\"files\":[{\"name\":\"" + Esc(fi.Name) +
                                          "\",\"mtime\":\"" + fi.LastWriteTimeUtc.ToString("o") +
                                          "\",\"size\":" + fi.Length + ",\"gz\":\"" + Gzip64(text) + "\"}]}";
                            Post(STORE + "/api/logs", body, "application/json");
                        }
                        string dest = Path.Combine(OUTDONE, DateTime.Now.ToString("yyyyMMdd-HHmmss-") + Path.GetFileName(f));
                        File.Move(f, dest);
                        n++;
                    }
                    catch { /* 다음 차례에 다시 해 본다 */ }
                }
            }
            catch { }
            return n;
        }

        // 사건 한 줄 (내려받기·설치 결과)
        void Event(string type, string app, string version, bool ok, string note)
        {
            try
            {
                string body = "{\"type\":\"" + type + "\",\"app\":\"" + Esc(app) + "\",\"version\":\"" + Esc(version) +
                              "\",\"machine\":\"" + Machine() + "\",\"ok\":" + (ok ? "true" : "false") +
                              ",\"note\":\"" + Esc(note ?? "") + "\"}";
                Post(STORE + "/api/event", body, "application/json");
            }
            catch { }
        }

        void SendLogs(bool force)
        {
            if (!_logOn.Checked && !force) return;
            int routed = RouteOutbox();
            try
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var seen = LoadSent();
                var payload = new StringBuilder();
                int n = 0; long bytes = 0;

                foreach (string pat in PATTERNS)
                {
                    foreach (string f in Directory.GetFiles(desk, pat))
                    {
                        var fi = new FileInfo(f);
                        if (fi.Length > 2 * 1024 * 1024) continue;          // 2MB 넘는 건 건너뛴다
                        string stamp = fi.Name + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
                        if (seen.Contains(stamp) && !force) continue;

                        string text;
                        try { text = File.ReadAllText(f, Encoding.UTF8); } catch { continue; }
                        payload.Append(payload.Length == 0 ? "" : ",");
                        payload.Append("{\"name\":\"").Append(Esc(fi.Name)).Append("\",")
                               .Append("\"mtime\":\"").Append(fi.LastWriteTimeUtc.ToString("o")).Append("\",")
                               .Append("\"size\":").Append(fi.Length).Append(",")
                               .Append("\"gz\":\"").Append(Gzip64(text)).Append("\"}");
                        seen.Add(stamp);
                        n++; bytes += fi.Length;
                    }
                }

                if (n == 0)
                {
                    LogSay((routed > 0 ? "애드온 " + routed + "건 넘김 · " : "") +
                           "보낼 새 기록 없음  (" + DateTime.Now.ToString("HH:mm") + ")");
                    return;
                }

                string body = "{\"machine\":\"" + Machine() + "\",\"key\":\"" + Esc(LoadKey()) +
                              "\",\"launcher\":\"1.0\",\"files\":[" + payload + "]}";
                string res = Post(STORE + "/api/logs", body, "application/json");
                if (res.Contains("\"ok\":true"))
                {
                    SaveSent(seen);
                    LogSay((routed > 0 ? "애드온 " + routed + "건 + " : "") +
                           "기록 " + n + "개 (" + (bytes / 1024) + " KB) 보냄  " + DateTime.Now.ToString("HH:mm"));
                }
                else LogSay("기록 보내기 거절됨 : " + res);
            }
            catch (Exception ex)
            {
                LogSay("기록 보내기 실패 : " + ex.Message);
            }
        }

        static HashSet<string> LoadSent()
        {
            try { return new HashSet<string>(File.ReadAllLines(SENT)); }
            catch { return new HashSet<string>(); }
        }

        static void SaveSent(HashSet<string> s)
        {
            try
            {
                Directory.CreateDirectory(CFGDIR);
                File.WriteAllLines(SENT, s.Skip(Math.Max(0, s.Count - 500)).ToArray());
            }
            catch { }
        }

        // zip 을 폴더에 푼다 (있으면 덮어쓴다)
        static void Unzip(string zip, string dest)
        {
            Directory.CreateDirectory(dest);
            using (var z = System.IO.Compression.ZipFile.OpenRead(zip))
            {
                foreach (var e in z.Entries)
                {
                    string to = Path.Combine(dest, e.FullName.Replace('/', '\\'));
                    if (e.Name.Length == 0) { Directory.CreateDirectory(to); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    e.ExtractToFile(to, true);
                }
            }
        }

        static string Gzip64(string text)
        {
            byte[] raw = Encoding.UTF8.GetBytes(text);
            using (var ms = new MemoryStream())
            {
                using (var gz = new GZipStream(ms, CompressionMode.Compress, true)) gz.Write(raw, 0, raw.Length);
                return Convert.ToBase64String(ms.ToArray());
            }
        }

        // ── 잔일 ────────────────────────────────────────────────────────
        void Say(string s, bool bad = false)
        {
            _msg.ForeColor = bad ? Color.FromArgb(251, 44, 54) : Color.FromArgb(154, 164, 181);
            _msg.Text = s;
            Application.DoEvents();
        }

        void LogSay(string s)
        {
            _logMsg.Text = s;
            _tray.Text = ("BSP 런처 — " + s).Substring(0, Math.Min(63, ("BSP 런처 — " + s).Length));
        }

        static string Machine()
        {
            try { return Esc(Environment.MachineName + "-" + Environment.UserName); }
            catch { return "unknown"; }
        }

        static string Esc(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        static string LoadKey()
        {
            try { return File.Exists(CFG) ? File.ReadAllText(CFG).Trim() : ""; }
            catch { return ""; }
        }

        static void SaveKey(string k)
        {
            try { Directory.CreateDirectory(CFGDIR); File.WriteAllText(CFG, k); }
            catch { }
        }

        static string Get(string url)
        {
            using (var wc = new WebClient()) { wc.Encoding = Encoding.UTF8; return wc.DownloadString(url); }
        }

        static string Post(string url, string json, string type)
        {
            using (var wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("content-type", type);
                return wc.UploadString(url, json);
            }
        }

        static string Sha256(string path)
        {
            using (var sha = SHA256.Create())
            using (var fs = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
        }

        // 작은 JSON 읽기 — 의존성 없이 가려고 이 파일 안에서만 쓴다
        static string Str(string src, string k)
        {
            var m = Regex.Match(src, "\"" + k + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
        }

        static long Num(string src, string k)
        {
            var m = Regex.Match(src, "\"" + k + "\"\\s*:\\s*(\\d+)");
            long v; return m.Success && long.TryParse(m.Groups[1].Value, out v) ? v : 0;
        }

        static string Cut(string src, string after)
        {
            int i = src.IndexOf(after, StringComparison.Ordinal);
            return i < 0 ? src : src.Substring(i);
        }

        static IEnumerable<string> SplitObjects(string src)
        {
            int depth = 0, start = -1;
            for (int i = 0; i < src.Length; i++)
            {
                if (src[i] == '{') { if (depth++ == 0) start = i; }
                else if (src[i] == '}') { if (--depth == 0 && start >= 0) yield return src.Substring(start, i - start + 1); }
            }
        }
    }
}
