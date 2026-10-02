/**
 * BOA-582(2): 失格（Kファイルの成績コード S0〜S2）の艇の着欄（race_start_timings.finish_mark）を、結果ページを
 * 取り直して埋める。K から決まる着欄（着・F・L・欠・_）は backfill-kb-gaps.js --item=finish_code（項目7）が埋める。
 * 対象は、項目7で official_finish_code が入った後の「失格コードで着欄が NULL の既存の行」なので、項目7の後に実行する。
 * 行の判定は scripts/lib/disqualifiedFinishMark.js（純関数）。
 *
 * 2段階に分ける（取得と書き込みを分け、書き込みの前に差分を確かめられるようにする）:
 *   1. 計画（既定。DBは読むだけ）: 対象のレースの結果ページを1件ずつ取得し、書く行を JSON に保存する
 *      node --env-file=.env.local scripts/maintenance/backfill-disqualified-finish-marks.js --out=plan.json
 *        [--from=2025-12-01] [--to=2026-09-20] [--max-races=N]
 *      1リクエストずつ、3秒以上の間隔（jitter 付き）。429・503で即中止し、そこまでの計画を保存する
 *      （再実行すれば、対象は DB から導き直すので、書いた分は外れる）
 *   2. 書き込み（--apply）: 計画の行だけを書く。取得はしない
 *      node --env-file=.env.local scripts/maintenance/backfill-disqualified-finish-marks.js --apply --plan=plan.json --confirm=行数
 *      --confirm は計画の行数と一致させる。1行ずつ update（行の挿入はしない）。着欄が NULL の行だけ
 *      （既存の値を上書きしない。計画の後に値が入った行は書かずに数える）
 */
import fs from "node:fs";
import {
  fetchAll,
  isSupabaseEnabled,
  supabase,
} from "../lib/supabaseClient.js";
import { parseRaceResultPage } from "../lib/raceResultParser.js";
import { raceResultUrl } from "../lib/raceStatusParsers.js";
import {
  buildDisqualifiedMarkRows,
  isDisqualifiedCode,
} from "../lib/disqualifiedFinishMark.js";
import { fetchRaceResultHtml } from "../daily/scrape-results.js";

const DEFAULT_FROM = "2025-12-01";
const DEFAULT_TO = "2026-09-20";
const INTERVAL_MS = 3000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 失格コードで着欄が NULL の既存の行（読み取りのみ） */
export async function loadTargets(client, from, to) {
  const rows = await fetchAll(
    "race_start_timings",
    "race_id, boat_number, official_finish_code, finish_mark",
    (q) =>
      q
        .like("official_finish_code", "S%")
        .is("finish_mark", null)
        .gte("race_id", from)
        .lt("race_id", `${to}~`)
        .order("race_id", { ascending: true })
        .order("boat_number", { ascending: true }),
    { throwOnError: true, client },
  );
  return rows.filter((r) => isDisqualifiedCode(r.official_finish_code));
}

/**
 * 計画を作る（結果ページの取得と解析。DBへは書かない）。
 * 依存（fetchHtml・wait）は差し替え可能（検証用）。
 */
export async function buildPlan(
  targets,
  {
    fetchHtml = (url) => fetchRaceResultHtml(url),
    wait = sleep,
    intervalMs = INTERVAL_MS,
    maxRaces = Infinity,
    log = console.log,
  } = {},
) {
  const byRace = new Map();
  for (const t of targets) {
    if (!byRace.has(t.race_id)) byRace.set(t.race_id, []);
    byRace.get(t.race_id).push(t);
  }
  const plan = { rows: [], anomalies: [], races: 0, stopped: null };
  let index = 0;
  for (const [raceId, raceTargets] of byRace) {
    if (index >= maxRaces) break;
    if (index > 0) await wait(intervalMs + Math.floor(Math.random() * 1000));
    index++;
    const [date, venue, race] = [
      raceId.slice(0, 10),
      Number(raceId.slice(11, 13)),
      Number(raceId.slice(14, 16)),
    ];
    let html;
    try {
      html = await fetchHtml(raceResultUrl(venue, race, date));
    } catch (error) {
      if (error.status === 429 || error.status === 503) {
        plan.stopped = `${raceId}: HTTP ${error.status} のため中止`;
        break;
      }
      plan.anomalies.push(`${raceId}: 取得に失敗 ${error.message}`);
      continue;
    }
    plan.races++;
    const { boats } = parseRaceResultPage(html);
    if (boats.length === 0) {
      plan.anomalies.push(`${raceId}: 着順表を読めない`);
      continue;
    }
    const { rows, anomalies } = buildDisqualifiedMarkRows(
      raceId,
      boats,
      raceTargets,
    );
    plan.rows.push(...rows);
    plan.anomalies.push(...anomalies);
    if (index % 100 === 0) log(`  ${index}/${byRace.size}レース`);
  }
  return plan;
}

/**
 * 計画の行を書く。1行ずつ update（挿入しない）、着欄が NULL の行だけ（既存の値を上書きしない）。
 * @returns {Promise<{written: number, skipped: number}>} skipped: 計画の後に値が入っていた・行が無かった
 */
export async function applyPlan(
  rows,
  { client = supabase, now = () => new Date() } = {},
) {
  const updatedAt = now().toISOString();
  let written = 0;
  let skipped = 0;
  for (const row of rows) {
    const { data, error } = await client
      .from("race_start_timings")
      .update({ finish_mark: row.finish_mark, updated_at: updatedAt })
      .eq("race_id", row.race_id)
      .eq("boat_number", row.boat_number)
      .is("finish_mark", null)
      .select("race_id");
    if (error) {
      throw new Error(
        `race_start_timings の書き込みに失敗しました（${written}行は書き込み済み。再実行すれば残りだけ書く）: ${error.message}`,
      );
    }
    if ((data ?? []).length > 0) written++;
    else skipped++;
  }
  return { written, skipped };
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

const tallyBy = (rows, key) =>
  rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabaseが設定されていません");
  if (process.argv.includes("--apply")) {
    const planPath = getArg("plan");
    if (!planPath) throw new Error("--apply には --plan=FILE が必要です");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const confirm = Number(getArg("confirm"));
    if (confirm !== plan.rows.length) {
      throw new Error(
        `--confirm=${getArg("confirm")} が計画の行数 ${plan.rows.length} と一致しません`,
      );
    }
    const result = await applyPlan(plan.rows);
    console.log(
      `[APPLY] 書いた行 ${result.written}・書かなかった行（計画の後に値が入った・行が無い） ${result.skipped}`,
    );
    return;
  }
  const from = getArg("from") ?? DEFAULT_FROM;
  const to = getArg("to") ?? DEFAULT_TO;
  const out = getArg("out");
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new Error("--from=YYYY-MM-DD --to=YYYY-MM-DD を指定してください");
  }
  if (!out) throw new Error("--out=FILE（計画の保存先）を指定してください");
  const maxRaces = getArg("max-races") ? Number(getArg("max-races")) : Infinity;
  const targets = await loadTargets(supabase, from, to);
  const raceCount = new Set(targets.map((t) => t.race_id)).size;
  console.log(
    `[PLAN] ${from}〜${to}: 失格コードで着欄が NULL の艇 ${targets.length}（${raceCount}レース）。結果ページを取得します`,
  );
  const plan = await buildPlan(targets, { maxRaces });
  fs.writeFileSync(
    out,
    JSON.stringify(
      { generated_at: new Date().toISOString(), from, to, ...plan },
      null,
      2,
    ),
  );
  console.log(
    `[PLAN] 取得したレース ${plan.races}・書く行 ${plan.rows.length} ${JSON.stringify(tallyBy(plan.rows, "finish_mark"))}・異常 ${plan.anomalies.length}${plan.stopped ? `・${plan.stopped}` : ""} → ${out}`,
  );
  for (const a of plan.anomalies.slice(0, 20)) console.log(`  ⚠️ ${a}`);
  if (plan.stopped) process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
