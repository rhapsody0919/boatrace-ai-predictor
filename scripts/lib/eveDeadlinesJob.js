/**
 * 前夜の締切予定（eve_race_deadlines、マイグレーション202、BOA-1282）の共通ラッパ向けハンドラー2つ。
 * 設計: docs/design/eve-race-deadlines/plan.md
 *
 *   runEveDeadlinesJob           api/cron/eve-deadlines.js（JST 20:40・21:00・21:10・21:20）。翌日の raceindex を会場ごとに取り、
 *                                最終日の会場は racelist の 12・11・10R のレース名で優勝戦を見分けて書く
 *   runEveDeadlinesReconcileJob  api/cron/eve-deadlines-reconcile.js（JST 06:30・08:00）。当日の races.start_time と比べる
 *
 * 取得は1件ずつ、間に FETCH_GAP_MS（5秒）空ける（オーナー 2026-11-04「1晩 24場×3〜6回、間5秒」）。UA・ホストは politeFetch の既定のまま。
 * 書くのは値の変わる行だけ（新しい行・締切の変更・日の札・レース名・優勝戦の判定の変更）。PostgREST のバルク upsert は行ごとに
 * 列の集合が違うと NULL で埋めるので、毎回すべての列（照合の3列を除く）を送る。
 */
import { addDaysToDateString } from "./dateUtils.js";
import { scrapeRaceStage } from "./raceStageParser.js";
import * as cheerio from "cheerio";
import {
  isFinalRaceName,
  isLastDayLabel,
  parseRaceIndex,
  raceIndexProblems,
} from "./raceIndexParser.js";
import { reasonFromError } from "./scrapeJobs/venueJobSupport.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { SCRAPE_JOBS } from "./scrapeJobs/registry.js";

export const TABLE = "eve_race_deadlines";
export const FETCH_GAP_MS = 5000;
/** 最終日の会場で、レース名を取る R（優勝戦は12Rとは限らない。下関 2026-11-04 は11R、男女W優勝戦は2つ） */
export const FINAL_CANDIDATE_RACES = [12, 11, 10];
const BASE = "https://www.boatrace.jp/owpc/pc/race";
const VENUE_CODES = Array.from({ length: 24 }, (_, i) => i + 1);

const pad2 = (n) => String(n).padStart(2, "0");
export const raceIdOf = (date, venueCode, raceNumber) =>
  `${date}-${pad2(venueCode)}-${pad2(raceNumber)}`;
const ymd = (date) => date.replace(/-/g, "");
export const raceIndexUrl = (date, venueCode) =>
  `${BASE}/raceindex?jcd=${pad2(venueCode)}&hd=${ymd(date)}`;
export const raceListUrl = (date, venueCode, raceNumber) =>
  `${BASE}/racelist?rno=${raceNumber}&jcd=${pad2(venueCode)}&hd=${ymd(date)}`;
/** DB の time（"15:45:00"）・解析の "15:45" を分の単位にそろえる */
const hhmm = (t) => (typeof t === "string" ? t.slice(0, 5) : null);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Supabase の結果の error を例外にする（読み取りの失敗を「行なし」に化けさせない。ADR-0069） */
function must({ data, error }, what) {
  if (error) throw new Error(`${what}に失敗: ${error.message ?? error}`);
  return data;
}

/** 前夜の最後の起動か（起動の開始時刻で決める。対象日の finalRunAfterJst 以後） */
export function isFinalRound(startedAt, targetDate, finalRunAfterJst) {
  return (
    startedAt.getTime() >=
    new Date(`${targetDate}T${finalRunAfterJst}:00+09:00`).getTime()
  );
}

/** その日に節がある会場（race_series の start_date ≦ date ≦ end_date） */
export async function readExpectedVenues(client, date) {
  const rows = must(
    await client
      .from("race_series")
      .select("venue_code")
      .lte("start_date", date)
      .gte("end_date", date),
    "race_series の読み取り",
  );
  return [...new Set((rows ?? []).map((r) => Number(r.venue_code)))].sort(
    (a, b) => a - b,
  );
}

export async function readEveRows(client, date) {
  return (
    must(
      await client.from(TABLE).select("*").eq("race_date", date),
      `${TABLE} の読み取り`,
    ) ?? []
  );
}

/** 1ページを取る。2xx でなければ理由を返す（politeFetch は登録していないパスの 403 を普通の応答として返す） */
async function fetchHtml(politeFetch, url) {
  try {
    const res = await politeFetch(url);
    if (!res.ok) return { html: null, reason: `http_${res.status}` };
    return { html: await res.text(), reason: null };
  } catch (error) {
    return { html: null, reason: reasonFromError(error), error };
  }
}

/**
 * 書く行を作る（純粋関数）。値の変わる行だけ返す。
 * @param {Object} p
 * @param {string} p.date 開催日
 * @param {Array<Object>} p.existing その晩の既存の行（eve_race_deadlines）
 * @param {Array<{venueCode:number, dayLabel:string|null, races:Array<{raceNumber:number, deadline:string}>}>} p.venues 解析できた会場
 * @param {Map<string, string|null>} p.names race_id → この起動で取れたレース名
 * @param {string} p.nowIso
 */
export function buildEveRows({ date, existing, venues, names, nowIso }) {
  const prev = new Map(existing.map((r) => [r.race_id, r]));
  const rows = [];
  const changedIds = [];
  for (const v of venues) {
    for (const r of v.races) {
      const id = raceIdOf(date, v.venueCode, r.raceNumber);
      const old = prev.get(id);
      // 日の札が取れなかった回は前の値を使う（前の回の優勝戦の判定を false で上書きしない）
      const dayLabel = v.dayLabel ?? old?.day_label ?? null;
      const raceName = names.has(id) ? names.get(id) : (old?.race_name ?? null);
      // 最終日でなければ false。最終日の候補（12・11・10R）でない R も false（優勝戦は10R より前に無い前提）。
      // 候補で名前が取れていなければ NULL（未確認）。日の札が分からなければ NULL
      const isFinal =
        dayLabel == null
          ? null
          : !isLastDayLabel(dayLabel) ||
              !FINAL_CANDIDATE_RACES.includes(r.raceNumber)
            ? false
            : raceName == null
              ? null
              : isFinalRaceName(raceName);
      const changed = Boolean(old) && hhmm(old.deadline) !== r.deadline;
      if (changed) changedIds.push(id);
      const row = {
        race_id: id,
        race_date: date,
        venue_code: v.venueCode,
        race_number: r.raceNumber,
        deadline: `${r.deadline}:00`,
        day_label: dayLabel,
        race_name: raceName,
        is_final: isFinal,
        first_fetched_at: old?.first_fetched_at ?? nowIso,
        updated_at: nowIso,
        deadline_changes: (old?.deadline_changes ?? 0) + (changed ? 1 : 0),
      };
      const same =
        old &&
        !changed &&
        old.day_label === row.day_label &&
        old.race_name === row.race_name &&
        old.is_final === row.is_final;
      if (!same) rows.push(row);
    }
  }
  return { rows, changedIds };
}

/** 最終日の会場のうち、まだレース名が無い候補の R（その R が raceindex にあるものだけ） */
export function nameTargets({ date, venues, existing }) {
  const prev = new Map(existing.map((r) => [r.race_id, r]));
  const out = [];
  for (const v of venues) {
    if (!isLastDayLabel(v.dayLabel)) continue;
    const have = new Set(v.races.map((r) => r.raceNumber));
    for (const n of FINAL_CANDIDATE_RACES) {
      const id = raceIdOf(date, v.venueCode, n);
      if (have.has(n) && prev.get(id)?.race_name == null)
        out.push({ venueCode: v.venueCode, raceNumber: n, raceId: id });
    }
  }
  return out;
}

/**
 * @param {Object} ctx 共通ラッパの文脈（targetDate は 20:40 から解決済み。翌日を取る）
 * @param {Object} [deps] 試験用の差し替え
 */
export async function runEveDeadlinesJob(
  ctx,
  {
    sleep = sleepMs,
    gapMs = FETCH_GAP_MS,
    finalRunAfterJst = SCRAPE_JOBS.eve_deadlines.finalRunAfterJst,
  } = {},
) {
  const startedAt = ctx.now();
  const date = addDaysToDateString(ctx.targetDate, 1);
  const finalRound = isFinalRound(startedAt, ctx.targetDate, finalRunAfterJst);
  const expected = await readExpectedVenues(ctx.client, date);
  const existing = await readEveRows(ctx.client, date);
  // その晩の最初の起動（行がまだ無い）だけ、race_series に無い会場も取る（race_series の欠けを見つけるため）。
  // 2回目以降は、race_series の会場に、その晩に既に行のある会場（race_series に無かったが開催のあった会場）を足して取り直す
  const sweepAll = existing.length === 0;
  const known = [
    ...new Set([
      ...expected,
      ...existing.map((r) => Number(r.venue_code)).filter(Number.isInteger),
    ]),
  ].sort((a, b) => a - b);
  const order = sweepAll
    ? [...known, ...VENUE_CODES.filter((c) => !known.includes(c))]
    : known;

  let fetched = 0;
  const pace = async () => {
    if (fetched > 0) await sleep(gapMs);
    fetched += 1;
  };
  const venues = [];
  const failed = [];
  const notAttempted = [];
  const unexpected = [];
  const unexpectedAnomalies = [];
  let stopped = false;
  for (const venueCode of order) {
    if (stopped || ctx.shouldStop()) {
      if (known.includes(venueCode)) notAttempted.push(venueCode);
      continue;
    }
    await pace();
    const isKnown = known.includes(venueCode);
    const { html, reason, error } = await fetchHtml(
      ctx.politeFetch,
      raceIndexUrl(date, venueCode),
    );
    if (error instanceof BreakerOpenError) stopped = true;
    if (!html) {
      if (isKnown) failed.push({ venueCode, reason });
      continue;
    }
    let parsed;
    try {
      parsed = parseRaceIndex(html);
    } catch (e) {
      if (isKnown) failed.push({ venueCode, reason: `parse: ${e.message}` });
      continue;
    }
    if (!isKnown && parsed.races.length === 0) continue; // 開催なし
    const problems = raceIndexProblems(parsed.races);
    if (problems.length) {
      // 並びがおかしい結果は書かない（解析の誤りを前夜の投稿に出さない）。開催の分かっている会場は失敗（incomplete）、
      // race_series に無い会場は次の起動で取らないので、失敗に数えず通知だけにする
      const reason = `parse_anomaly: ${problems[0]}`;
      if (isKnown) failed.push({ venueCode, reason });
      else unexpectedAnomalies.push({ venueCode, reason });
      continue;
    }
    if (!expected.includes(venueCode)) unexpected.push(venueCode);
    venues.push({ venueCode, ...parsed });
  }

  // 最終日の会場のレース名（raceindex を全部取った後。打ち切られても失うのは名前だけ）
  const names = new Map();
  const namesMissing = [];
  for (const t of nameTargets({ date, venues, existing })) {
    if (stopped || ctx.shouldStop()) {
      namesMissing.push(t.raceId);
      continue;
    }
    await pace();
    const { html, reason, error } = await fetchHtml(
      ctx.politeFetch,
      raceListUrl(date, t.venueCode, t.raceNumber),
    );
    if (error instanceof BreakerOpenError) stopped = true;
    const name = html ? scrapeRaceStage(cheerio.load(html)) : null;
    if (name) names.set(t.raceId, name);
    else namesMissing.push(`${t.raceId}（${reason ?? "名前が無い"}）`);
  }

  const { rows, changedIds } = buildEveRows({
    date,
    existing,
    venues,
    names,
    nowIso: startedAt.toISOString(),
  });
  if (ctx.mode === "live" && rows.length > 0) {
    must(
      await ctx.client.from(TABLE).upsert(rows, { onConflict: "race_id" }),
      `${TABLE} の書き込み`,
    );
  }

  const alerts = [];
  const until = new Date(`${date}T12:00:00+09:00`).toISOString();
  if (unexpected.length || unexpectedAnomalies.length)
    alerts.push({
      key: `unexpected:${date}`,
      text: `race_series に節が無い会場で翌日（${date}）のレースがあった: 会場 ${[...unexpected.map(String), ...unexpectedAnomalies.map((u) => `${u.venueCode}（${u.reason}、書いていない）`)].join("・")}。race_series の欠けの疑い`,
      until,
    });
  const byId = new Map(rows.map((r) => [r.race_id, r]));
  // 変わったレースごとに key を分ける（同じ key は monitor が renotifyHours の間抑えるので、2件目以降が出なくなる）
  for (const id of changedIds)
    alerts.push({
      key: `changed:${id}`,
      text: `前夜の取得の間で締切が変わった: ${id} → ${hhmm(byId.get(id).deadline)}`,
      until,
    });
  if (finalRound && (failed.length || notAttempted.length))
    alerts.push({
      key: `failed:${date}`,
      text: `前夜の最後の起動で翌日（${date}）の締切が取れなかった会場: ${[...failed.map((f) => `${f.venueCode}（${f.reason}）`), ...notAttempted.map((c) => `${c}（未着手）`)].join("、")}`,
      until,
    });

  const report = {
    date,
    mode: ctx.mode,
    finalRound,
    sweepAll,
    expectedVenues: expected,
    venuesOk: venues.map((v) => v.venueCode),
    venuesFailed: failed,
    venuesNotAttempted: notAttempted,
    unexpectedVenues: unexpected,
    unexpectedAnomalies,
    lastDayVenues: venues
      .filter((v) => isLastDayLabel(v.dayLabel))
      .map((v) => v.venueCode),
    finals: [...names.entries()]
      .filter(([, n]) => isFinalRaceName(n))
      .map(([id]) => id),
    namesMissing,
    pagesFetched: fetched,
    rowsWritten: ctx.mode === "live" ? rows.length : 0,
    ...(alerts.length ? { alerts } : {}),
  };
  const rowsParsed = venues.reduce((a, v) => a + v.races.length, 0);
  if (known.length === 0 && rowsParsed === 0) {
    return {
      outcome: "error",
      error: `翌日（${date}）の節が race_series に無く、24場の raceindex にもレースが無かった`,
      report,
    };
  }
  return {
    rowsWritten: report.rowsWritten,
    rowsParsed,
    rowsExpected: known.length,
    report,
    body: report,
    // 最後の起動（finalRunAfterJst 以後）より前は済みにしない（4回とも取る）。最後でも取れなかった会場・名前があれば済みにしない
    incomplete:
      !finalRound ||
      failed.length > 0 ||
      notAttempted.length > 0 ||
      namesMissing.length > 0,
  };
}

/**
 * 照合の行を作る（純粋関数）。値の変わる行だけ返す。行は既存の行の全列に照合の3列を足した形（upsert で NOT NULL を満たす）。
 * @returns {{rows: Array<Object>, mismatches: Array<Object>, missing: Array<Object>}}
 */
export function buildReconcileRows({ eveRows, races, nowIso }) {
  const byId = new Map(races.map((r) => [r.race_id, r]));
  const rows = [];
  const mismatches = [];
  const missing = [];
  const noStartTime = [];
  for (const e of eveRows) {
    const race = byId.get(e.race_id);
    const start = hhmm(race?.start_time ?? null);
    const dayStart = start ? `${start}:00` : null;
    const mismatch = start ? start !== hhmm(e.deadline) : null;
    if (!race) missing.push(e);
    else if (!start) noStartTime.push(e);
    else if (mismatch) mismatches.push({ ...e, day_start_time: dayStart });
    if (
      e.reconciled_at != null &&
      hhmm(e.day_start_time) === start &&
      e.day_mismatch === mismatch
    )
      continue;
    rows.push({
      ...e,
      day_start_time: dayStart,
      day_mismatch: mismatch,
      reconciled_at: nowIso,
    });
  }
  return { rows, mismatches, missing, noStartTime };
}

export async function runEveDeadlinesReconcileJob(ctx) {
  const date = ctx.targetDate;
  const init = must(
    await ctx.client
      .from("scrape_job_state")
      .select("last_target_date")
      .eq("job", "races_init")
      .maybeSingle(),
    "races_init の状態の読み取り",
  );
  if (init?.last_target_date !== date) {
    // 朝の初期化（races）がその日の分を終えるまで比べない（08:00 の起動が取り直す）
    return {
      rowsWritten: 0,
      report: { date, mode: ctx.mode, waiting: "races_init" },
      body: { date, waiting: "races_init" },
      incomplete: true,
    };
  }
  const eveRows = await readEveRows(ctx.client, date);
  if (eveRows.length === 0)
    return {
      rowsWritten: 0,
      report: { date, mode: ctx.mode, skipped: "no_eve_rows" },
      body: { date, skipped: "no_eve_rows" },
    };
  const races =
    must(
      await ctx.client
        .from("races")
        .select("race_id,start_time")
        .eq("race_date", date),
      "races の読み取り",
    ) ?? [];
  const { rows, mismatches, missing, noStartTime } = buildReconcileRows({
    eveRows,
    races,
    nowIso: ctx.now().toISOString(),
  });
  if (ctx.mode === "live" && rows.length > 0)
    must(
      await ctx.client.from(TABLE).upsert(rows, { onConflict: "race_id" }),
      `${TABLE} の照合の書き込み`,
    );
  const until = new Date(`${date}T12:00:00+09:00`).toISOString();
  const alerts = [
    ...mismatches.map((m) => ({
      key: `mismatch:${m.race_id}`,
      text: `前夜の締切と当日の races が違う ${m.race_id}: 前夜 ${hhmm(m.deadline)}・当日 ${hhmm(m.day_start_time)}（前夜の投稿の締切が違っていた可能性）`,
      until,
    })),
    ...(missing.length
      ? [
          {
            key: `missing:${date}`,
            text: `前夜にあって当日の races に無い（中止の疑い）: ${missing.map((m) => m.race_id).join("、")}`,
            until,
          },
        ]
      : []),
    ...(noStartTime.length
      ? [
          {
            key: `no_start_time:${date}`,
            text: `当日の races に締切（start_time）が無く照合できない: ${noStartTime.map((m) => m.race_id).join("、")}`,
            until,
          },
        ]
      : []),
  ];
  const report = {
    date,
    mode: ctx.mode,
    eveRows: eveRows.length,
    matched:
      eveRows.length - mismatches.length - missing.length - noStartTime.length,
    mismatches: mismatches.map((m) => m.race_id),
    missing: missing.map((m) => m.race_id),
    noStartTime: noStartTime.map((m) => m.race_id),
    rowsWritten: ctx.mode === "live" ? rows.length : 0,
    ...(alerts.length ? { alerts } : {}),
  };
  return { rowsWritten: report.rowsWritten, report, body: report };
}
