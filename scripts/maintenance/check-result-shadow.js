/**
 * check-result-shadow.js - 結果取得（A6）の shadow の集計（読み取りのみ。DBへは書き込まない。select しか呼ばない）。
 *
 * 予定表（scrape_slots）の job='result' のスロットを日付範囲で集計し、shadow で記録した result_digest を、
 * 既存基盤（GitHub Actions）が race_results・race_start_timings に書いた値から同じ関数で計算したダイジェストと比べる
 * （tasks.md T4b-02-3・verification-runbook.md「結果取得の切り替え」）。
 *
 *   node --env-file=.env.local scripts/maintenance/check-result-shadow.js              # 直近3日（今日を含む）
 *   node --env-file=.env.local scripts/maintenance/check-result-shadow.js --days=5
 *   node --env-file=.env.local scripts/maintenance/check-result-shadow.js --date=2026-09-21
 *   node --env-file=.env.local scripts/maintenance/check-result-shadow.js --strict     # 一致率99%未満・不一致ありで終了コード1
 *
 * 出力:
 *   - 日付×run_mode（shadow・live・未着手）×状態・outcome の件数
 *   - shadow の完了（ok）のダイジェストの一致率（一致 / 不一致 / DBに行なし）。分母は「ダイジェストを記録した shadow の完了」
 *     から、DBに行が無い（既存基盤がまだ書いていない・確定中止）を除いたもの
 *   - shadow の遅延（完了時刻−期限＝発走+5分）のp50・p95（分）と、試行回数の分布
 *   - expired・未実行（attempts=0のままexpired）の件数
 * 「DBに行なし」は、既存基盤が書く前に比べた・中止のレース等で、不一致とは数えない（件数を別に出す）。
 */
import { createClient } from "@supabase/supabase-js";
import {
  computeResultDigest,
  RESULT_DIGEST_COLUMNS,
  START_TIMING_DIGEST_COLUMNS,
} from "../lib/scrapeJobs/resultDigest.js";
import { slotDeadline } from "../lib/scrapeJobs/time.js";
import { percentile } from "../lib/scrapeJobs/monitor.js";

const PAGE = 1000;
const CHUNK = 100;

/**
 * shadow で完了（ok）したスロットのダイジェストと、DBの行から計算したダイジェストを比べる（純粋関数）。
 *
 * @param {Array<{race_id: string, result_digest: string|null}>} slots shadow で ok になったスロット
 * @param {Array<Object>} resultRows race_results の行
 * @param {Array<Object>} timingRows race_start_timings の行
 */
export function compareShadowDigests(slots, resultRows, timingRows) {
  const resultBy = new Map(resultRows.map((r) => [r.race_id, r]));
  const timingsBy = new Map();
  for (const t of timingRows) {
    if (!timingsBy.has(t.race_id)) timingsBy.set(t.race_id, []);
    timingsBy.get(t.race_id).push(t);
  }
  const out = { matched: 0, mismatched: [], missing: [], noDigest: [] };
  for (const slot of slots) {
    if (!slot.result_digest) {
      out.noDigest.push(slot.race_id);
      continue;
    }
    const row = resultBy.get(slot.race_id);
    if (!row) {
      out.missing.push(slot.race_id);
      continue;
    }
    const dbDigest = computeResultDigest(
      row,
      timingsBy.get(slot.race_id) ?? [],
    );
    if (dbDigest === slot.result_digest) out.matched++;
    else
      out.mismatched.push({
        race_id: slot.race_id,
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

async function fetchByRaceIds(client, table, columns, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .in("race_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
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
      .eq("job", "result")
      .gte("race_date", from)
      .lte("race_date", to)
      .order("race_date")
      .order("race_id"),
  );
  console.log(`結果のスロット ${from}〜${to}: ${slots.length}件\n`);

  // 日付×run_mode×状態・outcome
  const tally = new Map();
  for (const s of slots) {
    const key = `${s.race_date}  ${(s.run_mode ?? "未着手").padEnd(6)} ${s.status.padEnd(8)} ${s.outcome ?? "-"}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...tally].sort()) console.log(`  ${k}: ${v}`);

  const expired = slots.filter((s) => s.status === "expired");
  const unexecuted = expired.filter((s) => (s.attempts ?? 0) === 0);
  console.log(
    `\nexpired: ${expired.length}件（うち未実行 attempts=0: ${unexecuted.length}件）`,
  );

  // shadow のダイジェストの一致率
  const shadowOk = slots.filter(
    (s) => s.run_mode === "shadow" && s.status === "done" && s.outcome === "ok",
  );
  const ids = [...new Set(shadowOk.map((s) => s.race_id))];
  const [resultRows, timingRows] = await Promise.all([
    fetchByRaceIds(
      client,
      "race_results",
      RESULT_DIGEST_COLUMNS.join(","),
      ids,
    ),
    fetchByRaceIds(
      client,
      "race_start_timings",
      ["race_id", ...START_TIMING_DIGEST_COLUMNS].join(","),
      ids,
    ),
  ]);
  const cmp = compareShadowDigests(shadowOk, resultRows, timingRows);
  const denominator = cmp.matched + cmp.mismatched.length;
  const rate = denominator === 0 ? null : cmp.matched / denominator;
  console.log(
    `\nshadow の完了（ok）: ${shadowOk.length}件 → ダイジェスト 一致 ${cmp.matched} / 不一致 ${cmp.mismatched.length} / DBに行なし ${cmp.missing.length} / digest未記録 ${cmp.noDigest.length}`,
  );
  console.log(
    `一致率: ${rate === null ? "算出不能（比較できる行が0件）" : `${(rate * 100).toFixed(2)}%（${cmp.matched}/${denominator}）`}`,
  );
  for (const m of cmp.mismatched.slice(0, 20)) {
    console.log(`  不一致 ${m.race_id}: shadow=${m.shadow} db=${m.db}`);
  }
  if (cmp.missing.length > 0) {
    console.log(
      `  DBに行なし（既存基盤がまだ書いていない・確定中止）: ${cmp.missing.slice(0, 10).join(", ")}${cmp.missing.length > 10 ? " …" : ""}`,
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
    `\nshadow の遅延（完了−発走5分後）: p50 ${fmt(percentile(delays, 50))}分 / p95 ${fmt(percentile(delays, 95))}分（n=${delays.length}）`,
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
