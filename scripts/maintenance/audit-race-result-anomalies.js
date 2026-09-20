/**
 * audit-race-result-anomalies.js - 既存の race_results の誤り（Q6）の特定と、承認後の修正
 *
 * 誤りの内容（docs/design/race-result-full-fields/plan.md「Q6の修正計画」）:
 *   - 欠場・フライング等の非完走艇が rank4〜6（レースによっては rank1〜3）に入っている（BOA-362）
 *   - 返還・不成立の払戻「¥100」が、払戻の列（payout_trifecta・payout_trio 等）に入っている
 *
 * 既定は読み取りのみ（DBへ書き込まない。取得先にも接続しない）。
 *   node --env-file=.env.local scripts/maintenance/audit-race-result-anomalies.js [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *        [--out=FILE.json] [--k-dir=DIR]
 *   --k-dir: デコード済みのKファイル（k{YYMMDD}.txt）を置いたディレクトリ。あれば、その日のレースをKファイル（確定値）と
 *            突合する（DBだけの判定は下限値・疑いのため）。Kファイルの取得は、このスクリプトでは行わない
 *            （1日=1リクエスト。取得方法・費用は plan.md）
 *
 * 書き込みは、明示フラグ --apply があるときだけ（ユーザーの承認後）。公式サイトの結果ページを再取得して修正する:
 *   node --env-file=.env.local scripts/maintenance/audit-race-result-anomalies.js --apply --race-ids=ID,ID,... --confirm=件数
 *   - --confirm は、--race-ids の件数と一致させる（意図しない件数の実行を防ぐ）。上限は既定30件（--max-races で変更）
 *   - 1リクエストずつ、3秒以上の間隔（jitter付き）、429・503で即中止。User-Agent は BoatraceAIBot/1.0
 *   - 書くのは、修正の列（rank4〜6・払戻・人気・race_status・refund_boats・remark）と、艇別・払戻明細
 *     （対応するマイグレーション077〜079が適用済みのときだけ）。変更の無い列は書かない
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchAll,
  isSupabaseEnabled,
  supabase,
} from "../lib/supabaseClient.js";
import { detectResultSchema } from "../lib/raceResultSchema.js";
import {
  analyzeRaceFromDb,
  compareRaceWithKDay,
  kDayToRaceFacts,
  parseRaceId,
  summarizeDbFindings,
} from "../lib/raceResultAudit.js";
import {
  applyFixPlan,
  buildFixPlan,
  FIX_RESULT_COLUMNS,
} from "../lib/raceResultFix.js";
import {
  buildRaceResultRow,
  fetchRaceResultHtml,
  parseRaceResultHtml,
  ResultHttpError,
} from "../daily/scrape-results.js";

const DEFAULT_FROM = "2025-12-04";
const DEFAULT_MAX_APPLY = 30;
const APPLY_INTERVAL_MS = 3000;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );

/** 対象期間の race_results と、フライングの艇を読む（読み取りのみ） */
async function loadDbRows(client, from, to) {
  const columns = [
    "race_id",
    "rank1",
    "rank2",
    "rank3",
    "rank4",
    "rank5",
    "rank6",
    "payout_win",
    "payout_place_1",
    "payout_place_2",
    "payout_trifecta",
    "payout_trio",
    "payout_exacta",
    "payout_quinella",
    "payout_wide_1",
    "payout_wide_2",
    "payout_wide_3",
    "actual_course_1",
    "actual_course_2",
    "actual_course_3",
    "actual_course_4",
    "actual_course_5",
    "actual_course_6",
  ].join(",");
  const rows = await fetchAll(
    "race_results",
    columns,
    (q) =>
      q
        .gte("race_id", from)
        .lt("race_id", `${to}~`)
        .order("race_id", { ascending: true }),
    { throwOnError: true, client },
  );
  const flying = await fetchAll(
    "race_start_timings",
    "race_id, boat_number",
    (q) =>
      q
        .eq("is_flying", true)
        .gte("race_id", from)
        .lt("race_id", `${to}~`)
        .order("race_id", { ascending: true })
        .order("boat_number", { ascending: true }),
    { throwOnError: true, client },
  );
  const fByRace = new Map();
  for (const f of flying) {
    if (!fByRace.has(f.race_id)) fByRace.set(f.race_id, []);
    fByRace.get(f.race_id).push(f.boat_number);
  }
  return rows.map((row) => ({
    ...row,
    fBoats: fByRace.get(row.race_id) ?? [],
  }));
}

/** k-dir にあるKファイルと突合する。{date: 突合した件数・誤りの内訳} */
function compareWithKDir(rows, kDir) {
  const byDate = new Map();
  for (const row of rows) {
    const { date } = parseRaceId(row.race_id);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  const report = { dates: {}, defects: [] };
  for (const [date, dayRows] of byDate) {
    const yymmdd = date.replaceAll("-", "").slice(2);
    const file = path.join(kDir, `k${yymmdd}.txt`);
    if (!fs.existsSync(file)) continue;
    const facts = kDayToRaceFacts(fs.readFileSync(file, "utf8"), date);
    let compared = 0;
    let withDefect = 0;
    for (const row of dayRows) {
      const fact = facts.get(row.race_id);
      if (!fact) continue;
      compared++;
      const defects = compareRaceWithKDay(row, fact);
      if (defects.length > 0) {
        withDefect++;
        report.defects.push({ race_id: row.race_id, defects });
      }
    }
    report.dates[date] = { races: dayRows.length, compared, withDefect };
  }
  return report;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 修正の実行（--apply）。1リクエストずつ、間隔を空けて、429・503で即中止する。
 * 依存（client・fetchHtml・sleep・schema）は差し替え可能（検証用。本番では実物）。
 */
export async function runApply(
  raceIds,
  {
    client,
    fetchHtml = (url) => fetchRaceResultHtml(url),
    wait = sleep,
    intervalMs = APPLY_INTERVAL_MS,
    log = (m) => console.log(m),
  },
) {
  const schema = await detectResultSchema(client);
  const results = [];
  let stopped = null;
  for (const [index, raceId] of raceIds.entries()) {
    const { date, venue, race } = parseRaceId(raceId);
    const url = `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${race}&jcd=${String(venue).padStart(2, "0")}&hd=${date.replaceAll("-", "")}`;
    if (index > 0) await wait(intervalMs + Math.floor(Math.random() * 1000));
    let html;
    try {
      html = await fetchHtml(url);
    } catch (error) {
      if (
        error instanceof ResultHttpError &&
        (error.status === 429 || error.status === 503)
      ) {
        stopped = `HTTP ${error.status} のため中止しました（${raceId}）`;
        break;
      }
      results.push({ race_id: raceId, error: `取得失敗: ${error.message}` });
      continue;
    }
    const parsed = parseRaceResultHtml(html);
    if (!parsed) {
      results.push({
        race_id: raceId,
        error: "結果ページを解析できません（未公開・中止の可能性）",
      });
      continue;
    }
    const { data: existing, error: readError } = await client
      .from("race_results")
      .select(
        [
          ...FIX_RESULT_COLUMNS,
          ...(schema.results ? ["race_status", "refund_boats", "remark"] : []),
        ].join(","),
      )
      .eq("race_id", raceId)
      .maybeSingle();
    if (readError || !existing) {
      results.push({
        race_id: raceId,
        error: `race_results の行を読めません: ${readError?.message ?? "行が無い"}`,
      });
      continue;
    }
    const newRow = buildRaceResultRow(raceId, parsed);
    const plan = buildFixPlan(existing, newRow, parsed, schema);
    const outcome = await applyFixPlan(client, plan);
    log(
      `  ${raceId}: ${outcome.error ? `失敗 ${outcome.error}` : `更新 results=${outcome.wrote.results ? Object.keys(plan.resultUpdate).join("/") : "変更なし"} timings=${outcome.wrote.timings} payouts=${outcome.wrote.payouts}`}`,
    );
    results.push(outcome);
  }
  return { results, stopped, schema };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase の環境変数（SUPABASE_URL・SUPABASE_SERVICE_KEY）が未設定です",
    );
    process.exit(1);
  }

  if (args.apply) {
    const raceIds = String(args["race-ids"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const max = Number(args["max-races"] ?? DEFAULT_MAX_APPLY);
    if (raceIds.length === 0) {
      console.error("--apply には --race-ids=ID,ID,... が必要です");
      process.exit(1);
    }
    if (Number(args.confirm) !== raceIds.length) {
      console.error(
        `--confirm=${raceIds.length} を指定してください（対象は${raceIds.length}件。承認した件数と一致させる）`,
      );
      process.exit(1);
    }
    if (raceIds.length > max) {
      console.error(
        `対象が${raceIds.length}件で、上限${max}件を超えています（--max-races で変更）`,
      );
      process.exit(1);
    }
    console.log(
      `⚠️ 書き込みモード: ${raceIds.length}件の結果ページを再取得して修正します`,
    );
    const { results, stopped } = await runApply(raceIds, { client: supabase });
    const failed = results.filter((r) => r.error);
    console.log(
      `完了: ${results.length - failed.length}件成功 / ${failed.length}件失敗${stopped ? ` / ${stopped}` : ""}`,
    );
    process.exit(failed.length > 0 || stopped ? 2 : 0);
  }

  const from = String(args.from ?? DEFAULT_FROM);
  const to = String(args.to ?? today());
  console.log(`## race_results の誤りの監査（読み取りのみ）: ${from}〜${to}`);
  const rows = await loadDbRows(supabase, from, to);
  const analyses = rows.map(analyzeRaceFromDb);
  const summary = summarizeDbFindings(analyses, rows.length);
  console.log(JSON.stringify(summary, null, 2));

  let kReport = null;
  if (args["k-dir"]) {
    kReport = compareWithKDir(rows, String(args["k-dir"]));
    console.log("\n## Kファイルとの突合");
    console.log(JSON.stringify(kReport, null, 2));
  }
  if (args.out) {
    fs.writeFileSync(
      String(args.out),
      JSON.stringify({ from, to, summary, kReport }, null, 2),
    );
    console.log(`\n出力: ${args.out}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}
