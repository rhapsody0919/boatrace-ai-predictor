/**
 * 費用の警報のうち、前払いの残り・急増・取得の失敗と止まり・トークンとドメインの期限の判定（純関数）。hq の dashboard-alerts の cost_alerts の移し
 * （2026-11-25、窓口の依頼）。月の見込みとサービス別の上限は cost-alerts-month.js、束ねて Slack に出すのは cost-alerts.js（次の PR）。
 * - 前払い（prepaid）: as_of の日からの台帳の累計を引いた残りが warn_left_pct% 以下
 * - 急増: 直近 spike_days 日に、前日の spike_ratio 倍以上かつ spike_min_usd 以上の日（定額と重なる Vercel の行は数えない）
 * - 取得: fetch-state.json の失敗が fetch_fail_days 日続く・最後の試みから fetch_fail_days 日動いていない
 * - 期限: Vercel の請求のトークン（token_mid_days 日前）・ドメイン（domain_mid_days 日前）
 *
 * 検証: scripts/maintenance/verify-cost-alerts-other.js
 */
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const daysBetween = (a, b) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY,
  );
const usd = (v) => `$${v.toFixed(2)}`;

/** 日→従量 USD（定額と重なる Vercel の行は数えない） */
function dailyTotals(rows, cfg) {
  const fixedSvc = new Set(cfg.vercel?.fixed_services ?? []);
  const totals = {};
  for (const r of rows) {
    totals[r.date] ??= 0;
    if (r.source === "vercel" && fixedSvc.has(r.service)) continue;
    totals[r.date] += Number(r.usd ?? 0) || 0;
  }
  return totals;
}

function prepaidAlerts(cfg, rows) {
  const out = [];
  for (const [name, pp] of Object.entries(cfg.prepaid ?? {})) {
    if (name.startsWith("$")) continue;
    const spent = rows
      .filter((r) => r.source === name && r.date >= pp.as_of)
      .reduce((s, r) => s + (Number(r.usd) || 0), 0);
    const left = Number(pp.balance_usd) - spent;
    if (left <= (Number(pp.balance_usd) * Number(pp.warn_left_pct)) / 100) {
      out.push({
        key: `cost_prepaid_low:${name}:${pp.as_of}`,
        text: `${name} の前払いの残り ${usd(left)}（${pp.as_of} に $${pp.balance_usd}）。入金はオーナー`,
      });
    }
  }
  return out;
}

function spikeAlerts(al, totals, today) {
  const since = addDays(today, -Number(al.spike_days));
  return Object.keys(totals)
    .filter((d) => d >= since)
    .sort()
    .filter((d) => {
      const prev = addDays(d, -1);
      return (
        prev in totals &&
        totals[d] >= al.spike_ratio * totals[prev] &&
        totals[d] >= al.spike_min_usd
      );
    })
    .map((d) => ({
      key: `cost_spike:${d}`,
      text: `${d} の従量 ${usd(totals[d])} が前日 ${usd(totals[addDays(d, -1)])} の${al.spike_ratio}倍以上`,
    }));
}

function fetchAlerts(al, fetchState, today) {
  const month = today.slice(0, 7);
  const out = [];
  const fails = fetchState?.fail_dates ?? [];
  if (fails.length >= al.fetch_fail_days) {
    out.push({
      key: `cost_fetch_fail:${month}`,
      text: `Vercel の費用の取得が ${fails.length}日続けて失敗（${fetchState.error ?? ""}）`,
    });
  }
  const last = fetchState?.last_attempt;
  if (last && daysBetween(last, today) >= al.fetch_fail_days) {
    out.push({
      key: `cost_fetch_stale:${month}`,
      text: `Vercel の費用の取得が ${last} から動いていない（launchd の com.terukina.ryujin.fetch-costs）`,
    });
  }
  return out;
}

function expiryAlerts(cfg, today) {
  const al = cfg.alert;
  const month = today.slice(0, 7);
  const left = (exp) => {
    const n = daysBetween(today, exp);
    return n >= 0 ? `期限 ${exp} まで ${n}日` : `期限 ${exp} を ${-n}日過ぎた`;
  };
  const out = [];
  const tok = cfg.vercel?.token_expires;
  if (tok && daysBetween(today, tok) <= al.token_mid_days) {
    out.push({
      key: `cost_token:vercel:${month}`,
      text: `Vercel の請求のトークンの${left(tok)}。作り直しはオーナー（Keychain と budgets.json の token_expires）`,
    });
  }
  for (const dm of cfg.domains ?? []) {
    if (daysBetween(today, dm.expires) <= al.domain_mid_days) {
      out.push({
        key: `cost_domain:${dm.name}:${month}`,
        text: `ドメイン ${dm.name} の${left(dm.expires)}。更新はオーナー`,
      });
    }
  }
  return out;
}

/** 前払い・急増・取得・期限の警報。today は JST の日（YYYY-MM-DD） */
export function otherAlerts(cfg, rows, fetchState, today) {
  const totals = dailyTotals(rows, cfg);
  return [
    ...prepaidAlerts(cfg, rows),
    ...spikeAlerts(cfg.alert, totals, today),
    ...fetchAlerts(cfg.alert, fetchState, today),
    ...expiryAlerts(cfg, today),
  ];
}
