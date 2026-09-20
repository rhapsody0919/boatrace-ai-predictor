/**
 * check-odds-shadow.js - オッズ取得（A3）の shadow の集計（読み取りのみ。DBへは書き込まない。select しか呼ばない）。
 *
 * 予定表（scrape_slots）の job='odds' のスロットを日付範囲で集計し、shadow で記録した result_digest（構造のダイジェスト。
 * scripts/lib/scrapeJobs/oddsDigest.js）を、既存基盤（GitHub Actions）が race_odds に書いた行（source='gha'）から同じ関数で
 * 計算したダイジェストと比べる（tasks.md T4b-04-4・verification-runbook.md「オッズ取得の切り替え」M）。
 *
 *   node --env-file=.env.local scripts/maintenance/check-odds-shadow.js              # 直近3日（今日を含む）
 *   node --env-file=.env.local scripts/maintenance/check-odds-shadow.js --days=5
 *   node --env-file=.env.local scripts/maintenance/check-odds-shadow.js --date=2026-09-21
 *   node --env-file=.env.local scripts/maintenance/check-odds-shadow.js --strict     # 一致率99%未満・不一致ありで終了コード1
 *
 * 出力:
 *   - 日付×run_mode（shadow・live・未着手）×状態・outcome の件数
 *   - 窓別（-60〜0）の shadow の完了率（done かつ outcome=ok の割合。分母は確定中止を除く shadow で着手したスロット）
 *   - shadow の完了（ok）のダイジェストの一致率（一致 / 不一致 / 比べられる既存基盤の行なし）。比べる相手は、同じレースの
 *     source='gha' の行のうち、スロットの期限に最も近い captured_at の行（期限の前後5分以内）。分母は、比べる行がある
 *     スロットのみ
 *   - shadow の遅延（完了時刻−期限）のp50・p95（分）と、試行回数の分布
 *   - expired・未実行（attempts=0のままexpired）の件数
 * 値は数分で変わるため、値そのものは比べない（構造＝取れた券種・組み合わせのキー集合）。「比べる行なし」は、既存基盤が
 * その窓を取り逃した・確定中止のレースで、不一致とは数えない（件数を別に出す）。
 */
import { createClient } from "@supabase/supabase-js";
import {
  ODDS_DIGEST_FULL_KEYS,
  computeOddsDigest,
} from "../lib/scrapeJobs/oddsDigest.js";
import { slotDeadline } from "../lib/scrapeJobs/time.js";
import { percentile } from "../lib/scrapeJobs/monitor.js";

const PAGE = 1000;
const CHUNK = 100;
/** 比べる既存基盤の行を探す、スロットの期限の前後（分） */
export const COMPARE_TOLERANCE_MIN = 5;

/** race_odds から、ダイジェストの計算に必要な列 */
export const ODDS_DIGEST_SELECT_COLUMNS = [
  "race_id",
  "captured_at",
  "source",
  "window_min",
  ...[1, 2, 3, 4, 5, 6].map((b) => `odds_win_${b}`),
  ...[1, 2, 3, 4, 5, 6].flatMap((b) => [
    `odds_place_${b}_low`,
    `odds_place_${b}_high`,
  ]),
  ...ODDS_DIGEST_FULL_KEYS,
];

/**
 * shadow で完了（ok）したスロットのダイジェストと、既存基盤の行から計算したダイジェストを比べる（純粋関数）。
 *
 * @param {Array<{race_id: string, race_date: string, offset_min: number, result_digest: string|null, races?: {start_time?: string}|null}>} slots
 * @param {Array<Object>} ghaRows source='gha' の race_odds の行
 * @param {number} [toleranceMin]
 */
export function compareOddsShadowDigests(
  slots,
  ghaRows,
  toleranceMin = COMPARE_TOLERANCE_MIN,
) {
  const rowsBy = new Map();
  for (const r of ghaRows) {
    if (!rowsBy.has(r.race_id)) rowsBy.set(r.race_id, []);
    rowsBy.get(r.race_id).push(r);
  }
  const out = { matched: 0, mismatched: [], missing: [], noDigest: [] };
  for (const slot of slots) {
    if (!slot.result_digest) {
      out.noDigest.push(slot.race_id);
      continue;
    }
    const start = slot.races?.start_time;
    if (!start) {
      out.missing.push(slot.race_id);
      continue;
    }
    const deadline = slotDeadline(slot.race_date, start, slot.offset_min);
    let best = null;
    let bestGap = Infinity;
    for (const r of rowsBy.get(slot.race_id) ?? []) {
      const gap = Math.abs(new Date(r.captured_at) - deadline) / 60000;
      if (gap <= toleranceMin && gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    if (!best) {
      out.missing.push(slot.race_id);
      continue;
    }
    const dbDigest = computeOddsDigest(best);
    if (dbDigest === slot.result_digest) out.matched++;
    else
      out.mismatched.push({
        race_id: slot.race_id,
        offset_min: slot.offset_min,
        shadow: slot.result_digest,
        db: dbDigest,
      });
  }
  return out;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const strict = args.includes("--strict");
  const date = arg("date");
  const days = Number(arg("days") ?? 3);
  const to = date ?? jstToday();
  const from = date ?? addDays(to, -(days - 1));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("❌ SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exit(1);
  }
  const client = createClient(url, key);

  const slots = await fetchAll(() =>
    client
      .from("scrape_slots")
      .select(
        "race_id,race_date,offset_min,status,attempts,outcome,run_mode,done_at,result_digest,last_error,races(start_time,cancellation_status)",
      )
      .eq("job", "odds")
      .gte("race_date", from)
      .lte("race_date", to)
      .order("race_date")
      .order("race_id"),
  );
  console.log(`オッズのスロット ${from}〜${to}: ${slots.length}件\n`);

  // 日付×run_mode×状態・outcome
  const tally = new Map();
  for (const s of slots) {
    const k = `${s.race_date}  ${(s.run_mode ?? "未着手").padEnd(6)} ${s.status.padEnd(8)} ${s.outcome ?? "-"}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...tally].sort()) console.log(`  ${k}: ${v}`);

  const expired = slots.filter((s) => s.status === "expired");
  const unexecuted = expired.filter((s) => (s.attempts ?? 0) === 0);
  console.log(
    `\nexpired: ${expired.length}件（うち未実行 attempts=0: ${unexecuted.length}件）`,
  );

  // 窓別の shadow の完了率
  const shadowSlots = slots.filter(
    (s) =>
      s.run_mode === "shadow" && s.races?.cancellation_status !== "confirmed",
  );
  console.log("\n窓別の shadow の完了率（done かつ ok / 着手したスロット）:");
  const windows = [...new Set(shadowSlots.map((s) => s.offset_min))].sort(
    (a, b) => a - b,
  );
  for (const w of windows) {
    const inWindow = shadowSlots.filter((s) => s.offset_min === w);
    const ok = inWindow.filter(
      (s) => s.status === "done" && s.outcome === "ok",
    ).length;
    console.log(
      `  ${String(w).padStart(4)}分: ${ok}/${inWindow.length} (${((ok / inWindow.length) * 100).toFixed(1)}%)`,
    );
  }

  // shadow のダイジェストの一致率
  const shadowOk = slots.filter(
    (s) => s.run_mode === "shadow" && s.status === "done" && s.outcome === "ok",
  );
  const ids = [...new Set(shadowOk.map((s) => s.race_id))];
  const ghaRows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("race_odds")
      .select(ODDS_DIGEST_SELECT_COLUMNS.join(","))
      .in("race_id", ids.slice(i, i + CHUNK))
      .eq("source", "gha");
    if (error) throw new Error(`race_odds: ${error.message}`);
    ghaRows.push(...(data ?? []));
  }
  const cmp = compareOddsShadowDigests(shadowOk, ghaRows);
  const denominator = cmp.matched + cmp.mismatched.length;
  const rate = denominator === 0 ? null : cmp.matched / denominator;
  console.log(
    `\nshadow の完了（ok）: ${shadowOk.length}件 → 構造のダイジェスト 一致 ${cmp.matched} / 不一致 ${cmp.mismatched.length} / 比べる行なし ${cmp.missing.length} / digest未記録 ${cmp.noDigest.length}`,
  );
  console.log(
    `一致率: ${rate === null ? "算出不能（比較できる行が0件）" : `${(rate * 100).toFixed(2)}%（${cmp.matched}/${denominator}）`}`,
  );
  for (const m of cmp.mismatched.slice(0, 20)) {
    console.log(
      `  不一致 ${m.race_id} 窓${m.offset_min}: shadow=${m.shadow} db=${m.db}`,
    );
  }

  // shadow の遅延（完了時刻−期限）と試行回数
  const delays = [];
  const attempts = new Map();
  for (const s of shadowOk) {
    if (s.races?.start_time && s.done_at) {
      const deadline = slotDeadline(
        s.race_date,
        s.races.start_time,
        s.offset_min,
      );
      delays.push((new Date(s.done_at) - deadline) / 60000);
    }
    attempts.set(s.attempts, (attempts.get(s.attempts) ?? 0) + 1);
  }
  delays.sort((a, b) => a - b);
  const fmt = (v) => (v === null ? "-" : v.toFixed(1));
  console.log(
    `\nshadow の遅延（完了−期限）: p50 ${fmt(percentile(delays, 50))}分 / p95 ${fmt(percentile(delays, 95))}分（n=${delays.length}。許容幅は3分）`,
  );
  console.log(
    `試行回数の分布: ${
      [...attempts]
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `${k}回=${v}`)
        .join(", ") || "-"
    }`,
  );

  if (strict && (cmp.mismatched.length > 0 || (rate !== null && rate < 0.99))) {
    console.error("\n❌ --strict: 一致率が99%未満、または不一致があります");
    process.exit(1);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌", error.message);
    process.exit(1);
  });
}
