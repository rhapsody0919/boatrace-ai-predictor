/**
 * 朝の初期化（job.js の runRacesInitJob）の会場の処理と、会場一覧の再確認。cursor（進捗）を書き換える。
 */
import { BreakerOpenError } from "../scrapeJobs/circuitBreaker.js";
import { truncateError } from "../scrapeJobs/outcomes.js";
import { jstMinutesOfDay } from "../scrapeJobs/time.js";
import { digestScrapedVenue } from "./digest.js";

/** 会場一覧の再確認（取りこぼし会場の確認）を行う、JSTの時刻の上限（従来の morning-init と同じ9時） */
const RECHECK_UNTIL_JST_MIN = 9 * 60;

/** 再試行の待ち時間（分）。attempts=1 のとき2分、以降 4・8・16、上限20分 */
export function backoffMinutes(attempts) {
  return Math.min(20, 2 * 2 ** Math.max(0, attempts - 1));
}

/** エラー（または cause の連鎖）に、サーキットブレーカーが開いていたことが含まれるか */
export function isBreakerOpenError(error) {
  for (let e = error, i = 0; e && i < 5; e = e.cause, i++) {
    if (e instanceof BreakerOpenError) return true;
  }
  return false;
}

const isPending = (cursor, code, nowMs) =>
  !cursor.settled.includes(code) &&
  (!cursor.retryAfter[code] ||
    new Date(cursor.retryAfter[code]).getTime() <= nowMs);

/** まだ済んでいない会場 */
export const remainingVenues = (cursor) =>
  cursor.targets.filter((v) => !cursor.settled.includes(v));

/** 会場を済みにする（成功・番組なし） */
function settleVenue(cursor, code) {
  cursor.settled.push(code);
  delete cursor.retryAfter[code];
  delete cursor.lastErrors[code];
}

/** 1会場の出走表を取り、live なら書く。取れたレース数を返す。取れなければ例外 */
async function scrapeAndWrite({
  ctx,
  d,
  cursor,
  code,
  date,
  live,
  fetchHtml,
  raceConcurrency,
}) {
  const venue = await d.scrapeVenue(date, code, {
    fetchHtml,
    strict: true,
    raceConcurrency,
  });
  const summary = venue ? digestScrapedVenue(date, venue) : null;
  if (!summary || summary.races === 0) {
    // 開催会場一覧にあるのに、出走表が1レースも取れない（未公開・構造変化）。成功にしない
    throw new Error(
      `会場${code}: 開催会場一覧にあるのに、出走表を取得できませんでした（未公開・ページの構造変化の可能性）`,
    );
  }
  if (live) {
    await d.writeVenue(venue, { date, client: ctx.client, now: ctx.now });
    cursor.wroteAny = true;
  }
  Object.assign(cursor.digests, summary.digests);
  cursor.races += summary.races;
  cursor.entries += summary.entries;
  return summary.races;
}

/**
 * 取れなかった会場の扱い。{breaker: true}（この起動を終える）・{}（番組なしで済み）・{failure}（失敗の記録）
 */
async function handleVenueFailure(
  { ctx, d, cursor, code, date, fetchHtml },
  error,
) {
  if (isBreakerOpenError(error)) {
    // 取得先のブレーカーが開いている: 失敗にせず、この起動を終える（試行回数も戻す）
    cursor.attempts[code] -= 1;
    return { breaker: true };
  }
  // 番組の無い中止の会場（節の打ち切り等）は、失敗にせず済みにする（BOA-721）。確認自体の失敗は、
  // 番組なしと判断できないので、元の失敗として扱う
  let noProgram = false;
  try {
    noProgram = await d.checkNoProgram(date, code, { fetchHtml });
  } catch (checkError) {
    if (isBreakerOpenError(checkError)) {
      cursor.attempts[code] -= 1;
      return { breaker: true };
    }
    console.error(
      `⚠️ races-init 会場${code}: 番組なしの確認に失敗: ${truncateError(checkError)}`,
    );
  }
  if (noProgram) {
    (cursor.noProgram ??= []).push(code);
    settleVenue(cursor, code);
    console.log(
      `ℹ️ races-init 会場${code}: 開催場一覧で中止、出走表が「データがありません」（番組なし）。races を作らずに済みにする`,
    );
    return {};
  }
  const message = truncateError(error);
  cursor.lastErrors[code] = message;
  cursor.retryAfter[code] = new Date(
    ctx.now().getTime() + backoffMinutes(cursor.attempts[code]) * 60_000,
  ).toISOString();
  console.error(`❌ races-init 会場${code}: ${message}`);
  return {
    failure: { venue: code, attempts: cursor.attempts[code], error: message },
  };
}

/** 会場を順に処理する（limit 会場まで・止める合図まで・ブレーカーが開くまで） */
export async function processVenues(params) {
  const { ctx, cursor, limit } = params;
  const failures = [];
  let attempted = 0;
  let racesThisRun = 0;
  let breakerOpen = false;
  for (const code of cursor.targets) {
    if (attempted >= limit || ctx.shouldStop()) break;
    if (!isPending(cursor, code, ctx.now().getTime())) continue;
    attempted++;
    cursor.attempts[code] = (cursor.attempts[code] ?? 0) + 1;
    try {
      racesThisRun += await scrapeAndWrite({ ...params, code });
      settleVenue(cursor, code);
    } catch (error) {
      const handled = await handleVenueFailure({ ...params, code }, error);
      if (handled.breaker) {
        breakerOpen = true;
        break;
      }
      if (handled.failure) failures.push(handled.failure);
    }
  }
  return { failures, attempted, racesThisRun, breakerOpen };
}

/** 会場一覧の再確認（取りこぼし会場。全ての会場が済んでから、1回だけ。JST 9時まで） */
export async function recheckVenueList({
  ctx,
  d,
  cursor,
  date,
  live,
  fetchHtml,
}) {
  if (
    remainingVenues(cursor).length !== 0 ||
    cursor.listRechecked ||
    jstMinutesOfDay(ctx.now()) >= RECHECK_UNTIL_JST_MIN
  )
    return;
  const list = await d.getVenues(date, { fetchHtml, strict: true });
  cursor.listRechecked = true;
  const added = list.filter((v) => !cursor.venues.includes(v));
  if (added.length > 0) {
    const existing = live
      ? await d.existingVenueCodes(ctx.client, date)
      : new Set();
    cursor.venues.push(...added);
    cursor.targets.push(...added.filter((v) => !existing.has(v)));
    console.log(`⚠️ 開催会場の取りこぼしを検出: [${added.join(", ")}]`);
  }
}
