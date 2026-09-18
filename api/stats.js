// 모인 것을 집계해서 준다.  stats.html 이 이걸 그린다.
//
//   GET /api/stats?days=30
//     -> { ok, total, byType, byApp, byDay, machines, recent[] }

const { read, enabled } = require("./_store");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const url = new URL(req.url, "https://x");
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { lines, err } = await read();
  if (err) { res.status(200).json({ ok: false, reason: err, store: enabled() ? "github" : "off" }); return; }

  const rows = lines.filter((r) => (r.t || "") >= since);
  const byType = {}, byApp = {}, byDay = {}, machines = {}, errs = [];

  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    const k = `${r.app || "-"} ${r.version || ""}`.trim();
    if (r.app) {
      byApp[k] = byApp[k] || { app: r.app, version: r.version, download: 0, install: 0, error: 0 };
      if (r.type === "download") byApp[k].download++;
      else if (r.type === "install") byApp[k].install += r.ok ? 1 : 0;
      if (r.ok === false || r.type === "error") byApp[k].error++;
    }
    const d = (r.t || "").slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
    if (r.machine) machines[r.machine] = (machines[r.machine] || 0) + 1;
    if (r.ok === false || r.type === "error") errs.push(r);
  }

  res.status(200).json({
    ok: true,
    store: enabled() ? "github" : "off",
    days,
    total: rows.length,
    byType,
    byApp: Object.values(byApp).sort((a, b) => b.download - a.download),
    byDay: Object.entries(byDay).sort().map(([d, n]) => ({ d, n })),
    machines: Object.entries(machines).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([m, n]) => ({ m, n })),
    recent: rows.slice(-40).reverse(),
    errors: errs.slice(-20).reverse(),
  });
};
