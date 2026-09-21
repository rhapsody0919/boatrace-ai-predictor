/**
 * 節の初日の欠落（racesに1行も無い会場日）を、公式サイトの過去日ページから補う（手動実行のバックフィル）
 *
 * 調査・方針: docs/issues/races-opening-day-missing.md
 * 対象: data/analysis/races-opening-day-missing/missing-venue-days.json の125会場日（2026-04-10〜09-11）
 *
 * 補うもの: races・race_entries・race_conditions（節の日目・レース名等）・exhibition_data・気象・
 *           race_results・払戻・スタート展示（race_start_timings）。
 * 補わないもの: predictions（予想は生成しない。ユーザー承認済み）・オッズ（締切前の時点値は遡れない）・
 *           scrape_slots・races の volatility_* / first_boat_*（予想側の値。NULLのまま）。
 *
 * 取得・解析・書き込みは、日次・Vercel Cron と共有する runForRaces（update-race-info.js・
 * scrape-exhibition-data.js・scrape-results.js）を使う。会場日ごとに、
 *   1. 出走表（1R）を取得し、races の行（12レース分）を作る
 *   2. 出走表（race_entries・race_conditions）→ 直前情報（展示・気象）→ 結果 の順に、全レースを取得・書き込む
 * 各段階は冪等（変更の無い行は書かない。取得済みの展示・完了済みの結果は再取得しない）。
 *
 * 公式サイトへの負荷: 逐次・既定3.5秒間隔（+0〜0.5秒）・URLの重複取得なし・403/429/503または通信失敗が
 * 2回連続で全体を停止・リクエスト数の上限。1会場日あたり約36リクエスト（出走表12・直前情報12・結果12）。
 *
 * 使い方（本番DBへ書くのは --apply のときだけ。既定は dry-run で、出走表（1R）を取得して内容を表示する）:
 *   node --env-file=.env.local scripts/maintenance/backfill-opening-day-races.js --only=2026-09-01:12
 *   node --env-file=.env.local scripts/maintenance/backfill-opening-day-races.js --only=2026-09-01:12 --apply
 *   node --env-file=.env.local scripts/maintenance/backfill-opening-day-races.js --apply
 * オプション:
 *   --only=YYYY-MM-DD:会場,...   処理する会場日（欠落リストにあるものだけ）
 *   --limit=N                    先頭からN会場日だけ処理する
 *   --apply                      本番DBへ書き込む
 *   --interval-ms=3500           リクエストの間隔
 *   --max-requests=5000          送るリクエスト数の上限
 *   --list=PATH / --report=PATH  欠落リスト・結果の記録（既定は data/analysis/races-opening-day-missing/）
 * 記録済み（status=done）の会場日は、再実行でスキップする（中断後の再開用）。
 */
import fs from "node:fs";
import path from "node:path";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { parseRaceListPage } from "../lib/raceListParser.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { runForRaces as runRaceInfo } from "../daily/update-race-info.js";
import { runForRaces as runExhibition } from "../daily/scrape-exhibition-data.js";
import {
  fetchRaceResultHtml,
  runForRaces as runResults,
} from "../daily/scrape-results.js";
import {
  BackfillAbortError,
  buildRaceRows,
  createThrottledFetch,
  hasFailure,
  parseOnly,
  selectTargets,
  tallyOutcomes,
  venueDayKey,
} from "../lib/openingDayBackfill.js";

const DEFAULT_DIR = "data/analysis/races-opening-day-missing";
const DEFAULT_LIST = path.join(DEFAULT_DIR, "missing-venue-days.json");
const DEFAULT_REPORT = path.join(DEFAULT_DIR, "backfill-report.json");

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);
const toInt = (value, name) => {
  if (value == null) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`--${name} は1以上の整数で指定してください: ${value}`);
  }
  return Number(value);
};

const racelistUrl = (date, venueCode, raceNo) =>
  `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${raceNo}&jcd=${String(venueCode).padStart(2, "0")}&hd=${date.replace(/-/g, "")}`;

/** 会場日のDB上の件数（完了の確認用） */
async function countRows(client, date, venueCode) {
  const vv = String(venueCode).padStart(2, "0");
  const lo = `${date}-${vv}-01`;
  const hi = `${date}-${vv}-12`;
  const count = async (table, build = (q) => q) => {
    const { count: n, error } = await build(
      client
        .from(table)
        .select("race_id", { count: "exact", head: true })
        .gte("race_id", lo)
        .lte("race_id", hi),
    );
    if (error) throw new Error(`${table}の件数取得に失敗: ${error.message}`);
    return n ?? 0;
  };
  const [races, entries, conditions, exhibition, results] = await Promise.all([
    count("races"),
    count("race_entries"),
    count("race_conditions"),
    count("exhibition_data"),
    count("race_results"),
  ]);
  return { races, entries, conditions, exhibition, results };
}

async function processVenueDay({ date, venueCode }, { throttled, apply }) {
  const fetchFn = throttled.fetchFn;
  const client = supabase;
  const before = await countRows(client, date, venueCode);
  if (before.races > 0 && !apply) {
    return {
      status: "already_present",
      note: `racesに既に${before.races}行あります`,
      db: before,
    };
  }

  // 1. 出走表（1R）: racesの行の元になる（締切予定時刻は12レース分が載っている）
  const response = await fetchFn(racelistUrl(date, venueCode, 1));
  if (!response.ok) {
    return { status: "error", note: `出走表のHTTPエラー: ${response.status}` };
  }
  const page = parseRaceListPage(await response.text());
  if (page.entries.length === 0) {
    return {
      status: "no_data",
      note: "出走表に選手がいません（初日の中止・未公開の可能性）。書き込みません",
      db: before,
    };
  }
  const { rows, anomalies } = buildRaceRows({ date, venueCode, page });
  const plan = {
    races: rows.length,
    entriesOn1R: page.entries.length,
    seriesDay: page.meta.seriesDay,
    grade: page.meta.raceGrade,
    title: page.meta.raceTitle,
    anomalies: [...anomalies, ...page.anomalies],
  };
  if (rows.length === 0) {
    return {
      status: "no_data",
      note: "締切予定時刻のあるレースがありません",
      plan,
    };
  }
  if (!apply) return { status: "planned", plan, db: before };

  // 2. races → 出走表 → 直前情報 → 結果
  const raced = await upsertChangedRows(client, "races", rows, {
    onConflict: "race_id",
    keyColumns: ["race_id"],
    label: "races",
  });
  if (raced.error) throw raced.error;

  const races = rows.map((r) => ({
    race_id: r.race_id,
    venue_code: r.venue_code,
    race_number: r.race_number,
  }));
  const tallies = {};
  const stopIfTripped = () => {
    if (throttled.state.tripped) {
      throw new BackfillAbortError(throttled.state.tripped);
    }
  };

  const info = await runRaceInfo(races, {
    date,
    mode: "live",
    fetchFn,
    client,
    concurrency: 1,
  });
  tallies.raceInfo = tallyOutcomes(info);
  stopIfTripped();

  const exhibition = await runExhibition(races, {
    date,
    mode: "live",
    fetchFn,
    client,
    concurrency: 1,
  });
  tallies.exhibition = tallyOutcomes(exhibition);
  stopIfTripped();

  const results = await runResults(races, {
    date,
    mode: "live",
    fetchHtml: (url) => fetchRaceResultHtml(url, fetchFn),
    client,
    concurrency: 1,
  });
  tallies.results = tallyOutcomes(results);
  stopIfTripped();

  const errors = [...info, ...exhibition, ...results]
    .filter((r) => r.outcome === "error" || r.outcome === "breaker_open")
    .map((r) => `${r.race_id}: ${r.error}`)
    .slice(0, 10);
  const failed = Object.values(tallies).some(hasFailure);
  return {
    status: failed ? "partial" : "done",
    plan,
    tallies,
    errors,
    db: await countRows(client, date, venueCode),
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const tmp = `${reportPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 1)}\n`);
  fs.renameSync(tmp, reportPath);
}

async function main() {
  const apply = hasFlag("apply");
  const listPath = getArg("list") ?? DEFAULT_LIST;
  const reportPath = getArg("report") ?? DEFAULT_REPORT;
  const intervalMs = toInt(getArg("interval-ms"), "interval-ms") ?? 3500;
  const maxRequests = toInt(getArg("max-requests"), "max-requests") ?? 5000;
  const limit = toInt(getArg("limit"), "limit");

  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabase環境変数（SUPABASE_URL・SUPABASE_SERVICE_KEY）が未設定です",
    );
  }
  const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
  if (!Array.isArray(list.rows)) {
    throw new Error(
      `欠落リストの形式が不正です（rows がありません）: ${listPath}`,
    );
  }

  const previous = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
    : null;
  const done = new Set(
    (previous?.entries ?? [])
      .filter((e) => e.status === "done" || e.status === "no_data")
      .map((e) => venueDayKey(e.date, e.venue_code)),
  );
  const targets = selectTargets(list.rows, {
    only: parseOnly(getArg("only")),
    skip: apply ? done : new Set(),
    limit,
  });

  const host = new URL(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  ).host;
  console.log(
    `${apply ? "【本番へ書き込みます】" : "[dry-run]"} 対象DB: ${host} / 会場日: ${targets.length}件（記録済みスキップ: ${apply ? done.size : 0}件） / 間隔: ${intervalMs}ms`,
  );

  const throttled = createThrottledFetch({ intervalMs, maxRequests });
  const report = {
    schema: "races-opening-day-backfill-report/v1",
    started_at: new Date().toISOString(),
    apply,
    entries: apply ? [...(previous?.entries ?? [])] : [],
  };
  const upsertEntry = (entry) => {
    const key = venueDayKey(entry.date, entry.venue_code);
    const at = report.entries.findIndex(
      (e) => venueDayKey(e.date, e.venue_code) === key,
    );
    if (at >= 0) report.entries[at] = entry;
    else report.entries.push(entry);
  };

  let aborted = null;
  for (const [i, t] of targets.entries()) {
    const label = `${t.race_date} 会場${t.venue_code}`;
    let entry;
    try {
      const result = await processVenueDay(
        { date: t.race_date, venueCode: t.venue_code },
        { throttled, apply },
      );
      entry = { date: t.race_date, venue_code: t.venue_code, ...result };
    } catch (error) {
      if (error instanceof BackfillAbortError) {
        aborted = error.message;
        break;
      }
      entry = {
        date: t.race_date,
        venue_code: t.venue_code,
        status: "error",
        note: error.message,
      };
    }
    upsertEntry({ ...entry, at: new Date().toISOString() });
    if (apply) {
      report.requests = throttled.state.requests;
      writeReport(reportPath, report);
    }
    console.log(
      `[${i + 1}/${targets.length}] ${label}: ${entry.status}` +
        (entry.plan
          ? ` (${entry.plan.races}R, 日目=${entry.plan.seriesDay}, ${entry.plan.grade})`
          : "") +
        (entry.note ? ` ${entry.note}` : "") +
        (entry.errors?.length ? ` errors=${entry.errors.length}` : "") +
        ` [req ${throttled.state.requests}]`,
    );
    throttled.clearCache();
    if (throttled.state.tripped) {
      aborted = throttled.state.tripped;
      break;
    }
  }

  const summary = {};
  for (const e of report.entries)
    summary[e.status] = (summary[e.status] ?? 0) + 1;
  report.finished_at = new Date().toISOString();
  report.requests = throttled.state.requests;
  report.aborted = aborted;
  report.summary = summary;
  if (apply) writeReport(reportPath, report);
  console.log(
    `\n集計: ${JSON.stringify(summary)} / リクエスト: ${throttled.state.requests}`,
  );
  if (aborted) {
    console.error(`🛑 中断: ${aborted}`);
    process.exit(2);
  }
  if (!apply)
    console.log(
      "dry-runのため、DBには書いていません。書き込みは --apply を付けて実行します。",
    );
}

main().catch((error) => {
  console.error("❌", error);
  process.exit(1);
});
