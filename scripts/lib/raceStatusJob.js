/**
 * 中止・順延の早期確定（race_status、共通ラッパ cronWrapper.js の continuous ジョブ）。
 * api/cron/race-status.js が createScrapeCronHandler の run に渡す。
 * 設計: docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md
 *
 * 従来の確定（races.cancellation_status='confirmed'）は「発走+90分を超えても結果が無い」ことから推定するため、
 * 日全体が順延の日は、7R以降の確定が発走の1.5時間後（12Rは夕方）まで遅れ、その間、未実行・expired の誤報や
 * 「受付中」の誤表示が続いていた（2026-09-21 戸田・江戸川・津）。公式は、順延・中止を発走前に告知しているため、
 * 次の2段で、発走を待たずに確定する。
 *
 *   1) 開催場一覧（race/index、1リクエスト）の状態欄から、「N R以降が中止・順延」の会場を見つける（候補の絞り込み）
 *   2) その会場の N R以降で、結果（race_results）が無く、まだ確定していないレースについて、
 *      レース自身の結果ページが「レース中止」の表示であることを確かめ、確かめられたものだけを確定にする
 *
 * 確定の書き込みは、従来と同じ confirmCancellationsForRaceIds（結果のあるレースは確定にしない）を使う。
 * 暫定（tentative。選手0人の連続検知）には関与しない。確定は上書きしない。
 *
 * mode: shadow は取得・解析のみ（races へ書かず、確定するはずのレースを report に残す）。live で書き込む。
 * 冪等: 毎回、ページの状態から候補を導くため、取りこぼした回（未配信・取得失敗・結果ページの反映遅れ）は、
 * 次の起動が自然に補う。書き込むのは、未確定のレースのみ。
 */
import { toJstDateString } from "./scrapeJobs/time.js";
import { isCancellationConfirmed } from "./cancellationStatus.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import {
  confirmCancellationsForRaceIds,
  fetchRaceResultHtml,
} from "../daily/scrape-results.js";
import {
  isRaceCancelledPage,
  parseVenueStatuses,
  raceIndexUrl,
  raceResultUrl,
} from "./raceStatusParsers.js";

/** 結果ページ（レース単位）の同時取得数。1ページ約8〜10秒のため、日全体順延の2会場（24レース）でも約1分 */
export const RACE_STATUS_CONCURRENCY = 4;

/** 確定の根拠（ログ・報告に残す） */
export const CONFIRM_REASON = "公式の告知（開催場一覧＋結果ページ）";

const REPORT_LIST_LIMIT = 24;
/** 全24会場×12レース。shadow の突き合わせ（確定するはずのレースの一覧）は、打ち切らない */
const MAX_RACES_PER_DAY = 288;

/** 開催場一覧の会場から、告知のある会場と報告の土台を作る（純関数） */
function summarizeVenues(venues, date, mode) {
  const announced = venues.filter((v) => v.status.kind === "cancelled_from");
  const unrecognized = venues
    .filter((v) => v.status.kind === "unrecognized")
    .map((v) => ({ venueCode: v.venueCode, statusText: v.statusText }));
  const base = {
    date,
    mode,
    venuesParsed: venues.length,
    announced: announced.map((v) => ({
      venueCode: v.venueCode,
      statusText: v.statusText,
      fromRace: v.status.fromRace,
    })),
    // 「中止」「順延」を含むが既知の形ではない状態欄。何も確定せず、人が確認できるように残す
    unrecognized,
  };
  return { announced, base };
}

/** 開催場一覧を取って会場を読む（取得の殻）。遮断中は null */
async function fetchVenues(ctx, date, fetchHtml) {
  let indexHtml;
  try {
    indexHtml = await fetchHtml(raceIndexUrl(date), ctx.politeFetch);
  } catch (error) {
    if (error instanceof BreakerOpenError) return null;
    // fetchRaceResultHtml のエラー文言は「結果ページ」のため、開催場一覧の失敗だと分かるようにする
    throw new Error(`開催場一覧の取得に失敗しました: ${error.message}`);
  }
  const venues = parseVenueStatuses(indexHtml);
  if (venues.length === 0) {
    throw new Error(
      "開催場一覧から会場を1つも読み取れませんでした（ページ構造の変更の可能性。0件を成功にしません）",
    );
  }
  return venues;
}

/** 告知のあった会場の N R以降で、未確定のレース（DB を読む殻） */
async function loadCandidates(client, date, announced) {
  const fromRaceByVenue = new Map(
    announced.map((v) => [v.venueCode, v.status.fromRace]),
  );
  const racesQuery = await client
    .from("races")
    .select("race_id, venue_code, race_number, cancellation_status")
    .eq("race_date", date)
    .in("venue_code", [...fromRaceByVenue.keys()]);
  if (racesQuery.error) {
    throw new Error(`races の取得に失敗しました: ${racesQuery.error.message}`);
  }
  return (racesQuery.data ?? []).filter(
    (r) =>
      r.race_number >= fromRaceByVenue.get(r.venue_code) &&
      !isCancellationConfirmed(r.cancellation_status),
  );
}

/** 候補を、結果のある（告知と矛盾する）レースと、結果ページを確かめるレースに分ける（DB を読む殻） */
async function splitByResults(client, candidates) {
  const resultsQuery = await client
    .from("race_results")
    .select("race_id")
    .in(
      "race_id",
      candidates.map((r) => r.race_id),
    );
  if (resultsQuery.error) {
    throw new Error(
      `race_results の取得に失敗しました: ${resultsQuery.error.message}`,
    );
  }
  const hasResult = new Set((resultsQuery.data ?? []).map((r) => r.race_id));
  return {
    contradictions: candidates
      .filter((r) => hasResult.has(r.race_id))
      .map((r) => r.race_id),
    toProbe: candidates.filter((r) => !hasResult.has(r.race_id)),
  };
}

/** レース自身の結果ページで「レース中止」の表示を確かめる（取得の殻） */
async function probeRace(ctx, fetchHtml, date, race) {
  if (ctx.shouldStop()) return { race, state: "not_attempted" };
  try {
    const html = await fetchHtml(
      raceResultUrl(race.venue_code, race.race_number, date),
      ctx.politeFetch,
    );
    return {
      race,
      state: isRaceCancelledPage(html) ? "cancelled" : "not_on_page",
    };
  } catch (error) {
    if (error instanceof BreakerOpenError) {
      return { race, state: "breaker_open" };
    }
    return { race, state: "error", error: error.message };
  }
}

/**
 * 確かめた結果を数える（純関数）。取得を試みたのに全て失敗した実行は投げる
 * （取得先・ネットワークの障害を「確定なし」の成功にしない）
 */
function tallyProbes(probes) {
  const idsOf = (state) =>
    probes.filter((p) => p.state === state).map((p) => p.race.race_id);
  const errors = probes.filter((p) => p.state === "error");
  const attempted = probes.filter(
    (p) => p.state !== "not_attempted" && p.state !== "breaker_open",
  );
  if (attempted.length > 0 && errors.length === attempted.length) {
    throw new Error(
      `結果ページの取得が全て失敗しました（${errors.length}件。例: ${errors[0].error}）`,
    );
  }
  return { idsOf, cancelledIds: idsOf("cancelled"), errors, attempted };
}

/** 確かめた後の報告（純関数） */
function probedReport({
  base,
  live,
  candidates,
  tally,
  confirmed,
  contradictions,
}) {
  const { idsOf, cancelledIds, errors, attempted } = tally;
  return {
    ...base,
    candidates: candidates.length,
    probed: attempted.length,
    // shadow では書かない。確定するはずのレース（既存基盤の確定と後で突き合わせる）
    ...(live ? {} : { wouldConfirm: cancelledIds.slice(0, MAX_RACES_PER_DAY) }),
    confirmed,
    // 告知はあるが、結果ページがまだ「レース中止」になっていない（反映待ち。次の起動が再確認する）
    notOnPage: idsOf("not_on_page").slice(0, REPORT_LIST_LIMIT),
    notAttempted: idsOf("not_attempted").length + idsOf("breaker_open").length,
    errors: errors
      .slice(0, REPORT_LIST_LIMIT)
      .map((p) => `${p.race.race_id}: ${p.error}`),
    contradictions: contradictions.slice(0, REPORT_LIST_LIMIT),
  };
}

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx）
 * @param {Object} [deps] テスト用の差し替え
 * @returns {Promise<{rowsWritten: number, report: Object, body: Object}>}
 */
export async function runRaceStatusJob(
  ctx,
  {
    fetchHtml = fetchRaceResultHtml,
    confirm = confirmCancellationsForRaceIds,
    concurrency = RACE_STATUS_CONCURRENCY,
  } = {},
) {
  const date = toJstDateString(ctx.now());
  const live = ctx.mode === "live";
  const client = ctx.client;
  const done = (report) => ({
    rowsWritten: report.confirmed ?? 0,
    report,
    body: report,
  });

  // 1) 開催場一覧
  const venues = await fetchVenues(ctx, date, fetchHtml);
  if (venues === null)
    return done({ date, mode: ctx.mode, skipped: "breaker_open" });
  const { announced, base } = summarizeVenues(venues, date, ctx.mode);
  if (announced.length === 0) return done({ ...base, candidates: 0 });

  // 2) 候補: 告知のあった会場の N R以降で、未確定のレース
  const candidates = await loadCandidates(client, date, announced);
  if (candidates.length === 0) return done({ ...base, candidates: 0 });

  // 結果のあるレースは、告知と矛盾する（確定にせず、人が確認できるように残す）
  const { contradictions, toProbe } = await splitByResults(client, candidates);

  // 3) レース自身の結果ページで、「レース中止」の表示を確かめる
  const probes = await mapWithConcurrency(toProbe, concurrency, (race) =>
    probeRace(ctx, fetchHtml, date, race),
  );
  const tally = tallyProbes(probes);

  // 4) 確定（live のみ。書き込みは従来と同じ関数で、結果のあるレース・確定済みは除かれる）
  let confirmed = 0;
  if (live && tally.cancelledIds.length > 0) {
    const res = await confirm(client, tally.cancelledIds, {
      reason: CONFIRM_REASON,
    });
    confirmed = res.confirmed.length;
  }

  return done(
    probedReport({ base, live, candidates, tally, confirmed, contradictions }),
  );
}
