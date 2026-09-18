// 리빗 안의 앱스토어 — 리빗을 켜면 리본에 [BSP Store] 탭이 생기고,
// 거기서 애드인을 고르면 그 자리에서 받아 Addins 폴더에 넣는다.
//   · 목록·라이선스·집계는 전부 포털(https://bsp-store.vercel.app)을 본다
//   · 받은 것은 다음에 리빗을 켤 때 뜬다 (리빗은 켤 때 애드인을 읽는다 — 이건 리빗 규칙이라 못 바꾼다)
//   · 리빗을 켤 때마다 "launch" 한 줄을 포털로 보낸다 (누가 무엇을 쓰는지 집계)

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Color = System.Drawing.Color;
using Font = System.Drawing.Font;
using Control = System.Windows.Forms.Control;
using Autodesk.Revit.UI;

namespace BSPStoreRevit
{
    public class App : IExternalApplication
    {
        public static string Store =
            Environment.GetEnvironmentVariable("BSP_STORE") ?? "https://bsp-store.vercel.app";
        public static string RevitVer = "";

        public Result OnStartup(UIControlledApplication a)
        {
            RevitVer = a.ControlledApplication.VersionNumber;
            try
            {
                a.CreateRibbonTab("BSP Store");
                var panel = a.CreateRibbonPanel("BSP Store", "앱");
                var btn = new PushButtonData("BspStoreOpen", "앱 스토어",
                    Assembly.GetExecutingAssembly().Location, "BSPStoreRevit.OpenCommand")
                { ToolTip = "애드인을 고르고 그 자리에서 설치합니다." };
                panel.AddItem(btn);
            }
            catch { }

            // 켜졌다는 것만 한 줄 남긴다
            try { Net.Event("launch", "revit-store", "1.0", true, "Revit " + RevitVer); } catch { }
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication a) { return Result.Succeeded; }
    }

    [Transaction(TransactionMode.ReadOnly)]
    public class OpenCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData data, ref string message, ElementSet e)
        {
            new StoreForm().Show();     // 모드리스 — 띄워 두고 리빗을 계속 쓸 수 있다
            return Result.Succeeded;
        }
    }

    // ── 포털과 말하기 ───────────────────────────────────────────────────
    static class Net
    {
        public static string Get(string url)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var wc = new WebClient()) { wc.Encoding = Encoding.UTF8; return wc.DownloadString(url); }
        }

        public static string Post(string url, string json)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("content-type", "application/json");
                return wc.UploadString(url, json);
            }
        }

        public static void Event(string type, string app, string ver, bool ok, string note)
        {
            string body = "{\"type\":\"" + type + "\",\"app\":\"" + app + "\",\"version\":\"" + ver +
                          "\",\"machine\":\"" + Machine() + "\",\"ok\":" + (ok ? "true" : "false") +
                          ",\"note\":\"" + (note ?? "").Replace("\"", "'") + "\"}";
            try { Post(App.Store + "/api/event", body); } catch { }
        }

        public static string Machine()
        {
            try { return Environment.MachineName + "-" + Environment.UserName; }
            catch { return "unknown"; }
        }
    }

    class Item
    {
        public string Id, Name, Publisher, Summary, Status, Host, Kind, Version, Target, Sha256, Download, File;
        public long Size;
    }

    class StoreForm : System.Windows.Forms.Form
    {
        readonly ListBox _list = new ListBox();
        readonly Label _msg = new Label();
        readonly Button _install = new Button();
        readonly Button _refresh = new Button();
        readonly List<Item> _items = new List<Item>();
        string _cdn = "";

        public StoreForm()
        {
            Text = "BSP 앱 스토어 (리빗 " + App.RevitVer + ")";
            Width = 660; Height = 430;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(13, 15, 19);
            ForeColor = Color.FromArgb(232, 236, 243);
            Font = new Font("맑은 고딕", 9F);

            var t = new Label
            {
                Text = "애드인", AutoSize = true, Left = 18, Top = 14,
                Font = new Font("맑은 고딕", 13F, FontStyle.Bold),
                ForeColor = Color.FromArgb(48, 128, 255)
            };
            var s = new Label
            {
                Text = "고르고 설치를 누르면 이 PC 의 리빗 " + App.RevitVer + " 에 들어갑니다.  (리빗을 다시 켜면 뜹니다)",
                AutoSize = true, Left = 20, Top = 42, ForeColor = Color.FromArgb(154, 164, 181)
            };

            _list.Left = 20; _list.Top = 72; _list.Width = 600; _list.Height = 230;
            _list.BackColor = Color.FromArgb(7, 9, 13);
            _list.ForeColor = Color.FromArgb(232, 236, 243);
            _list.BorderStyle = BorderStyle.FixedSingle;
            _list.Font = new Font("맑은 고딕", 10F);
            _list.IntegralHeight = false;

            _refresh.Text = "새로고침"; _refresh.Left = 20; _refresh.Top = 316; _refresh.Width = 100; _refresh.Height = 32;
            _refresh.FlatStyle = FlatStyle.Flat; _refresh.BackColor = Color.FromArgb(30, 36, 48);
            _refresh.ForeColor = Color.White; _refresh.FlatAppearance.BorderSize = 0;
            _refresh.Click += (a, b) => LoadApps();

            _install.Text = "설치"; _install.Left = 500; _install.Top = 316; _install.Width = 120; _install.Height = 32;
            _install.FlatStyle = FlatStyle.Flat; _install.BackColor = Color.FromArgb(48, 128, 255);
            _install.ForeColor = Color.White; _install.FlatAppearance.BorderSize = 0;
            _install.Font = new Font("맑은 고딕", 10F, FontStyle.Bold);
            _install.Click += (a, b) => Install();

            _msg.Left = 20; _msg.Top = 356; _msg.Width = 600; _msg.Height = 40;
            _msg.ForeColor = Color.FromArgb(154, 164, 181);

            Controls.AddRange(new Control[] { t, s, _list, _refresh, _install, _msg });
            Shown += (a, b) => LoadApps();
        }

        void Say(string m, bool bad = false)
        {
            _msg.ForeColor = bad ? Color.FromArgb(251, 44, 54) : Color.FromArgb(154, 164, 181);
            _msg.Text = m; Application.DoEvents();
        }

        void LoadApps()
        {
            try
            {
                string json = Net.Get(App.Store + "/api/apps");
                _cdn = (Str(json, "cdn") ?? "").TrimEnd('/');
                _items.Clear(); _list.Items.Clear();
                foreach (string b in Objects(After(json, "\"apps\"")))
                {
                    var it = new Item
                    {
                        Id = Str(b, "id"), Name = Str(b, "name"), Publisher = Str(b, "publisher") ?? "",
                        Summary = Str(b, "summary") ?? "", Status = Str(b, "status"), Host = Str(b, "host") ?? "windows",
                        Kind = Str(b, "kind") ?? "msi", Version = Str(b, "version") ?? "", Target = Str(b, "target") ?? "",
                        Sha256 = Str(b, "sha256") ?? "", Download = Str(b, "download") ?? "", File = Str(b, "file") ?? "",
                        Size = Num(b, "size")
                    };
                    if (it.Name == null) continue;
                    _items.Add(it);
                    string mark = it.Host == "revit" ? "리빗" : it.Host == "autocad" ? "캐드" : "윈도우";
                    _list.Items.Add(it.Status == "live"
                        ? string.Format("{0}  · {1}   v{2}   [{3}]   {4}", it.Name, it.Publisher, it.Version, mark, it.Summary)
                        : string.Format("{0}  · {1}   준비중   {2}", it.Name, it.Publisher, it.Summary));
                }
                if (_list.Items.Count > 0) _list.SelectedIndex = 0;
                Say("앱 " + _items.Count + "개 — " + App.Store);
            }
            catch (Exception ex) { Say("스토어에 닿지 못했습니다 : " + ex.Message, true); }
        }

        void Install()
        {
            if (_list.SelectedIndex < 0) return;
            Item it = _items[_list.SelectedIndex];
            if (it.Status != "live") { Say("아직 준비중입니다.", true); return; }
            if (it.Host != "revit") { Say("이건 " + (it.Host == "autocad" ? "오토캐드" : "윈도우") + " 앱입니다.  런처에서 설치하세요.", true); return; }

            string url = (it.Download.StartsWith("http") ? "" : (_cdn.Length > 0 ? _cdn : App.Store)) + it.Download;
            string tmp = Path.Combine(Path.GetTempPath(), it.Id + "-" + it.Version + ".zip");
            try
            {
                Say("받는 중 …");
                using (var wc = new WebClient()) wc.DownloadFile(url, tmp);

                if (it.Sha256.Length == 64)
                {
                    string got;
                    using (var sha = System.Security.Cryptography.SHA256.Create())
                    using (var fs = File.OpenRead(tmp))
                        got = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
                    if (!string.Equals(got, it.Sha256, StringComparison.OrdinalIgnoreCase))
                    { Say("받은 파일이 스토어의 것과 다릅니다.  멈춥니다.", true); return; }
                }

                string dest = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Autodesk", "Revit", "Addins", App.RevitVer);
                Directory.CreateDirectory(dest);
                using (var z = ZipFile.OpenRead(tmp))
                    foreach (var e in z.Entries)
                    {
                        if (e.Name.Length == 0) continue;
                        string to = Path.Combine(dest, e.FullName.Replace('/', '\\'));
                        Directory.CreateDirectory(Path.GetDirectoryName(to));
                        e.ExtractToFile(to, true);
                    }

                Net.Event("install", it.Id, it.Version, true, "revit " + App.RevitVer);
                Say("넣었습니다 — " + dest + "\n리빗을 다시 켜면 리본에 뜹니다.");
                TaskDialog.Show("BSP 앱 스토어",
                    it.Name + " 을(를) 넣었습니다.\n\n리빗을 다시 켜면 리본에 나타납니다.\n(리빗은 켤 때 애드인을 읽습니다)");
            }
            catch (Exception ex)
            {
                Net.Event("install", it.Id, it.Version, false, ex.Message);
                Say("설치 실패 : " + ex.Message, true);
            }
        }

        // 작은 JSON 읽기
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
        static string After(string src, string k)
        {
            int i = src.IndexOf(k, StringComparison.Ordinal); return i < 0 ? src : src.Substring(i);
        }
        static IEnumerable<string> Objects(string src)
        {
            int d = 0, st = -1;
            for (int i = 0; i < src.Length; i++)
            {
                if (src[i] == '{') { if (d++ == 0) st = i; }
                else if (src[i] == '}') { if (--d == 0 && st >= 0) yield return src.Substring(st, i - st + 1); }
            }
        }
    }
}
