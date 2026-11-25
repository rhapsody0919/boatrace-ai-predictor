/**
 * 費用の警報のうち、月の見込みとサービス別の上限の判定（純関数）。hq の dashboard-alerts の cost_alerts の移し（2026-11-25、窓口の依頼。
 * hq の常駐を止めると費用の警報も出なくなるため）。台帳はリポジトリの外の costs.jsonl（fetch-costs.js）、設定は同じ置き場の budgets.json
 * （hq の config/cost-budgets.json の写し）。束ねて Slack に出すのは cost-alerts.js（次の PR）。
 * - 月の見込み＝定額の満額＋従量の見込みを円に。従量の見込みは出どころごとに「今月の日平均」「直近 N 日の日平均」の2本の高い方。
 *   ソフト超え・ハードの hard_warn_pct% 超え・ハード超えのうち一番重い1つ
 * - サービス別の上限（per_service）: 今月の従量が超えた・超える見込み。今月の行が無いサービスは判定しない
 * 鍵には月 YYYY-MM を含める（同じ警報は月に1回、出したかは cost-alerts.js が覚える）。
 *
 * 検証: scripts/maintenance/verify-cost-alerts-month.js
 */
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const yen = (v) => `${Math.round(v).toLocaleString("ja-JP")}円`;
const usd = (v) => `$${v.toFixed(2)}`;

/** 1つの出どころの従量の月の見込み2本。daily は 日→USD（行のある日だけ。無い日は0ドル） */
export function projectUsage(daily, month, dim, recentDays) {
  const md = Object.keys(daily)
    .filter((d) => d.startsWith(month))
    .sort();
  if (md.length === 0)
    return { usage: 0, last: null, full: 0, recent: 0, days: [] };
  const last = md[md.length - 1];
  const lastDay = Number(last.slice(8, 10));
  const usage = md.reduce((s, d) => s + daily[d], 0);
  const since = addDays(last, -(recentDays - 1));
  const avg =
    Object.keys(daily)
      .filter((d) => d >= since && d <= last)
      .reduce((s, d) => s + daily[d], 0) / recentDays;
  const recent = usage + avg * (dim - lastDay);
  // 月初で今月の日が窓に満たない間は、数日の跳ねで月全体を決めないよう直近の見込みを使う（hq 11/5）
  const full = lastDay >= recentDays ? (usage / lastDay) * dim : recent;
  return { usage, last, full, recent, days: md };
}

function byDay(rows, cfg) {
  const fixedSvc = new Set(cfg.vercel?.fixed_services ?? []);
  const bySrc = {};
  const totals = {};
  for (const r of rows) {
    const src = (bySrc[r.source] ??= {});
    src[r.date] ??= 0;
    if (r.source === "vercel" && fixedSvc.has(r.service)) continue; // 定額と重なる行は従量に数えない
    const v = Number(r.usd ?? 0) || 0;
    src[r.date] += v;
    totals[r.date] = (totals[r.date] ?? 0) + v;
  }
  return { bySrc, totals };
}

function monthAlertsOf(cfg, bySrc, month, dim) {
  const al = cfg.alert;
  const rate = Number(cfg.usd_jpy.value);
  const rd = Number(al.projection_recent_days);
  const fixedUsd = Object.values(cfg.fixed ?? {}).reduce(
    (s, v) => s + Number(v.usd ?? 0),
    0,
  );
  const proj = Object.fromEntries(
    Object.entries(bySrc).map(([k, d]) => [k, projectUsage(d, month, dim, rd)]),
  );
  const all = (key) =>
    (fixedUsd + Object.values(proj).reduce((s, p) => s + p[key], 0)) * rate;
  const p = Math.max(all("full"), all("recent"));
  const soft = (cfg.monthly_soft_max * al.soft_pct) / 100;
  const hard = cfg.monthly_hard_max;
  const head = `今月（${month}）の費用の見込み ${yen(p)}（今月の日平均から ${yen(all("full"))}・直近${rd}日から ${yen(all("recent"))}、定額 $${fixedUsd.toFixed(0)}、$1=${rate}円）`;
  const out = [];
  if (p > hard)
    out.push({
      key: `cost_hard:${month}`,
      text: `${head}がハード ${yen(hard)} を超える。止める候補（本番以外）をオーナーへ`,
    });
  else if (p > (hard * al.hard_warn_pct) / 100)
    out.push({
      key: `cost_hard_warn:${month}`,
      text: `${head}がハードの${al.hard_warn_pct}%（${yen((hard * al.hard_warn_pct) / 100)}）を超える`,
    });
  else if (p > soft)
    out.push({
      key: `cost_soft:${month}`,
      text: `${head}がソフト ${yen(soft)} を超える`,
    });
  for (const [name, sv] of Object.entries(cfg.per_service ?? {})) {
    const sp = proj[name];
    if (!sp?.last) continue; // 今月の行が無いサービスは判定しない
    const cap = Number(sv.usd);
    if (sp.usage > cap)
      out.push({
        key: `cost_service_cap:${month}:${name}`,
        text: `${name} の今月の従量 ${usd(sp.usage)}（${sp.last} まで）が上限 $${cap} を超えた`,
      });
    else if (Math.max(sp.full, sp.recent) > cap)
      out.push({
        key: `cost_service_cap_proj:${month}:${name}`,
        text: `${name} の今月の従量の見込み ${usd(Math.max(sp.full, sp.recent))}（今の累計 ${usd(sp.usage)}、${sp.last} まで）が上限 $${cap} を超える`,
      });
  }
  return out;
}

/** 月の見込みとサービス別の上限の警報。today は JST の日（YYYY-MM-DD） */
export function monthAlerts(cfg, rows, today) {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return monthAlertsOf(cfg, byDay(rows, cfg).bySrc, month, dim);
}
