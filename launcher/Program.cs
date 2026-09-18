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
        public string Id, Name, Summary, Status, Version, Target, Released, Sha256, Download;
        public long Size;
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
            _logTimer.Tick += (s, e) => SendLogs(false);
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
                string json = Get(STORE + "/apps.json");
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
                        Size = Num(block, "size")
                    };
                    if (a.Name == null) continue;
                    _apps.Add(a);
                    _list.Items.Add(a.Status == "live"
                        ? string.Format("{0}   v{1}   {2}   ({3:N0} KB)", a.Name, a.Version, a.Target, a.Size / 1024)
                        : string.Format("{0}   준비중", a.Name));
                }
                if (_list.Items.Count > 0) _list.SelectedIndex = 0;
                Say("앱 " + _apps.Count + "개를 읽었습니다.  (" + STORE + ")");
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

            string url = a.Download.StartsWith("http") ? a.Download : STORE + a.Download;
            string tmp = Path.Combine(Path.GetTempPath(), Path.GetFileName(url));

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

                Say("설치하는 중 …  (오토캐드는 자동으로 닫힙니다)");
                var p = Process.Start(new ProcessStartInfo("msiexec.exe", "/i \"" + tmp + "\" /qn")
                { UseShellExecute = true });
                p.WaitForExit();
                Say(p.ExitCode == 0
                    ? "설치 끝났습니다 — " + a.Name + " v" + a.Version
                    : "설치가 " + p.ExitCode + " 로 끝났습니다.  msi 를 손으로 실행해 보세요 : " + tmp,
                    p.ExitCode != 0);
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

        void SendLogs(bool force)
        {
            if (!_logOn.Checked && !force) return;
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

                if (n == 0) { LogSay("보낼 새 기록 없음  (" + DateTime.Now.ToString("HH:mm") + ")"); return; }

                string body = "{\"machine\":\"" + Machine() + "\",\"key\":\"" + Esc(LoadKey()) +
                              "\",\"launcher\":\"1.0\",\"files\":[" + payload + "]}";
                string res = Post(STORE + "/api/logs", body, "application/json");
                if (res.Contains("\"ok\":true"))
                {
                    SaveSent(seen);
                    LogSay("기록 " + n + "개 (" + (bytes / 1024) + " KB) 보냄  " + DateTime.Now.ToString("HH:mm"));
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
