/**
 * ピットレポート（選手コメント）の過去分を取り直す（BOA-611）。
 *
 * 2026-09-21〜10-01 の取得ジョブは、公開を検知した最初の1回しか取らなかったため、コメントが一部の艇にしか
 * 入っていないレースがある（公式は艇ごとにコメントを順に足していく）。過去日のページは公式に残っている
 * （docs/design/pit-comments/spec.md §1.3: 275日前まで取れた）ので、取り直して補う。
 *
 * 取得・解析・書き込みは、定期取得と同じ processPitReportRace を使う（二重実装しない）。書くのは内容が
 * 変わったときだけ（content_hash）。対象は、期間内の対象レース（SG 全レース・G1/G2 の 7R 以降）のうち、
 *   - race_pit_reports の行が無い（未取得・未公開のまま窓を過ぎた）
 *   - published だが、コメントの数が出走表の艇数に満たない
 * のもの。not_target（公式が「対象外」と表示した）と、全艇そろったレースは取り直さない。
 *
 * 既定は dry-run（取得・解析だけ。DBにもStorageにも書かない）。公式へのアクセスは逐次・1件ごとに3.5秒以上の間隔。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-pit-reports.js --from=2026-09-21 --to=2026-10-01          # dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-pit-reports.js --from=2026-09-21 --to=2026-10-01 --apply  # 書き込み
 */
import {
  fetchAll,
  isSupabaseEnabled,
  supabase,
} from "../lib/supabaseClient.js";
import {
  fetchPitReportHtml,
  processPitReportRace,
} from "../lib/pitReportJob.js";
import { isPitReportCandidate } from "../lib/pitReportRows.js";
import { createPoliteFetch } from "../lib/scrapeJobs/politeFetch.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const REQUEST_INTERVAL_MS = 3500;

/**
 * 取り直す対象のレースを選ぶ（純関数）。
 *
 * @param {Array<{race_id: string, race_grade: string|null, race_number: number|null}>} races
 * @param {Array<{race_id: string, status: string, comment_count: number|null}>} reports race_pit_reports の行
 * @param {Map<string, number>} entryCounts race_id → 出走表の艇数
 * @returns {Array<{race_id: string, race: Object, reason: "missing"|"incomplete", before: number, expected: number|null}>}
 */
export function planPitReportBackfill(races, reports, entryCounts) {
  const reportByRace = new Map(reports.map((r) => [r.race_id, r]));
  const targets = [];
  for (const race of races) {
    if (
      !isPitReportCandidate({
        raceGrade: race.race_grade,
        raceNumber: race.race_number,
      })
    ) {
      continue;
    }
    const expected = entryCounts.get(race.race_id) ?? null;
    const report = reportByRace.get(race.race_id);
    if (!report) {
      targets.push({
        race_id: race.race_id,
        race,
        reason: "missing",
        before: 0,
        expected,
      });
      continue;
    }
    if (report.status !== "published") continue; // not_target は取り直さない
    const before = report.comment_count ?? 0;
    // 出走表が読めない（0件）レースは、そろったかを判定できないので取り直す側に倒す
    if (expected === null || before < expected) {
      targets.push({
        race_id: race.race_id,
        race,
        reason: "incomplete",
        before,
        expected,
      });
    }
  }
  return targets.sort((a, b) => a.race_id.localeCompare(b.race_id));
}

/**
 * 結果の集計（純関数）。after は解析できたコメントの数（dry-run でも分かる）。
 * @param {Array<{target: Object, result: Object}>} runs
 */
export function summarizePitReportBackfill(runs) {
  const outcomes = {};
  let before = 0;
  let after = 0;
  let rowsWritten = 0;
  let increasedRaces = 0;
  for (const { target, result } of runs) {
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    before += target.before;
    const parsed = result.rowsParsed ?? 0;
    // 取得に失敗したレースは、今の件数のまま（増減に数えない）
    const counted = result.outcome === "error" ? target.before : parsed;
    after += counted;
    if (counted > target.before) increasedRaces++;
    rowsWritten += result.rowsWritten ?? 0;
  }
  return {
    races: runs.length,
    outcomes,
    commentsBefore: before,
    commentsAfter: after,
    increasedRaces,
    rowsWritten,
  };
}

/**
 * 取り直す対象を選ぶための入力（races・race_pit_reports・出走表の艇数）を読む。
 * ページ送りは共通の fetchAll（既定で取得エラーを投げる）に、決まった並び順を付けて行う。並び順が無いと、
 * PostgREST はページの間で行の重複・欠落を起こしうる（1000行を超える race_entries で艇数がずれる。BOA-745）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 */
export async function loadBackfillInputs(client, from, to) {
  const races = await fetchAll(
    "races",
    "race_id, race_date, start_time, race_grade, race_number",
    (q) =>
      q
        .gte("race_date", from)
        .lte("race_date", to)
        .in("race_grade", ["SG", "G1", "G2"])
        .order("race_id"),
    { client },
  );
  const reports = await fetchAll(
    "race_pit_reports",
    "race_id, status, comment_count",
    (q) => q.gte("race_id", from).lt("race_id", `${to}~`).order("race_id"),
    { client },
  );
  // 対象の race_id を200件ずつに分けて読む（期間が長いと .in() の URL が長くなりすぎるため）。
  // 200レース×6艇で1000行を超えるので、ページ送りの並び順が要る
  const raceIds = races.map((r) => r.race_id);
  const entryCounts = new Map();
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const entries = await fetchAll(
      "race_entries",
      "race_id, boat_number",
      (q) => q.in("race_id", chunk).order("race_id").order("boat_number"),
      { client },
    );
    for (const e of entries)
      entryCounts.set(e.race_id, (entryCounts.get(e.race_id) ?? 0) + 1);
  }
  return { races, reports, entryCounts };
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabaseが設定されていません");
  const from = getArg("from");
  const to = getArg("to") ?? from;
  const apply = process.argv.includes("--apply");
  if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "") || from > to) {
    throw new Error("--from=YYYY-MM-DD [--to=YYYY-MM-DD] を指定してください");
  }

  const { races, reports, entryCounts } = await loadBackfillInputs(
    supabase,
    from,
    to,
  );

  const targets = planPitReportBackfill(races, reports, entryCounts);
  console.log(
    `${apply ? "[APPLY]" : "[DRY-RUN]"} ${from}〜${to}: 対象レース ${races.filter((r) => isPitReportCandidate({ raceGrade: r.race_grade, raceNumber: r.race_number })).length}件のうち、取り直す ${targets.length}件（未取得 ${targets.filter((t) => t.reason === "missing").length}・コメント不足 ${targets.filter((t) => t.reason === "incomplete").length}）`,
  );

  const polite = createPoliteFetch();
  const runs = [];
  for (const [i, target] of targets.entries()) {
    if (i > 0)
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    let result;
    try {
      result = await processPitReportRace({
        raceId: target.race_id,
        race: target.race,
        mode: apply ? "live" : "shadow",
        fetchHtml: (url) => fetchPitReportHtml(url, polite),
        client: supabase,
        // 発走時刻を渡さない＝過去のレースは、コメントが足りなくても ok で閉じる（再試行しない）
      });
    } catch (e) {
      result = { outcome: "error", error: e.message };
    }
    runs.push({ target, result });
    console.log(
      `  ${target.race_id} ${target.reason} ${target.before}→${result.rowsParsed ?? "-"}件 outcome=${result.outcome}${result.rowsWritten ? ` 書き込み${result.rowsWritten}行` : ""}${result.error ? ` (${result.error})` : ""}`,
    );
  }

  const summary = summarizePitReportBackfill(runs);
  console.log(
    `\n${apply ? "[APPLY]" : "[DRY-RUN]"} 結果: ${summary.races}レース、outcome ${JSON.stringify(summary.outcomes)}、コメント ${summary.commentsBefore}→${summary.commentsAfter}件（増えたレース ${summary.increasedRaces}）、書き込み ${summary.rowsWritten}行`,
  );
  if ((summary.outcomes.error ?? 0) > 0) process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
