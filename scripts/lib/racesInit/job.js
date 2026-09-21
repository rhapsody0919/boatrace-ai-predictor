/**
 * 朝の初期化（A8、races・race_entries・predictions の初期化）の共通ラッパ向けハンドラー（tasks.md T4b-07-4、
 * plan.md §4.2）。api/cron/races-init.js が createScrapeCronHandler の run に渡す。
 *
 * 従来の morning-init.js（GitHub Actions）は、scrape-to-json.js → generate-predictions.js → unified →
 * scrape-pcexpect.js を execSync で直列に実行していた（13会場で約34分。単一の関数の最大800秒に収まらない）。
 * これを、会場ごとのチャンク処理に分ける。1回の呼び出しは、会場を最大 RACES_INIT_VENUES_PER_INVOCATION 件
 * （時間の許す限り）処理し、進捗を scrape_job_state.cursor に保存して、次の起動（2分後。実行中の起動は、リースで
 * 何もしない）が続きを処理する。全会場を処理し終えたら、後始末（予定表の生成・unified予測・Deploy Hook）をして、
 * 対象日を処理済みにする（それ以降の起動は、共通ラッパが何もしない）。公式コンピュータ予想（pcexpect）は、
 * 別のジョブ（予定表のスロット）に分けた。
 *
 * 動作:
 *   1. 計画（その日の最初の起動）: 開催会場一覧（race/index?hd=）を取得する（1リクエスト）。live のときは、既に races に
 *      行のある会場（GitHub Actions の morning-init や、前回の起動が書いたもの）を「初期化済み」として除き、
 *      無い会場だけを処理する（従来の morning-init の「races が1件でもあれば初期化済み。取りこぼし会場だけ追加」と
 *      同じ。日中に live へ切り替えても、初期化済みの予測・的中フラグを上書きしない）。shadow は、DBを読まず、全会場を処理する
 *   2. 会場の処理: scrapeVenue（strict）→ live なら generateAndWriteFromRacesData（races・race_entries・
 *      exhibition_data・predictions・race_conditions）。shadow は、取得・解析のみで、レースごとのダイジェスト
 *      （digest.js）を cursor に記録する。1会場の失敗（1ページでも取得できない・書き込みの失敗）は、その会場だけ
 *      「済み」にせず、指数バックオフ（2・4・8・16・20分）で再試行する（他の会場は進める）。会場の書き込みは、
 *      変更のある行だけ・predictions は削除→挿入のため、再試行しても安全（初期化の時間帯は、発走前）
 *   3. 会場一覧の再確認（JST 9時前のみ、1回）: 従来の ensureAllVenuesScraped（開催会場の取りこぼし確認）。
 *      新しい会場があれば、処理の対象に加える
 *   4. 後始末（live のみ）: 予定表の生成（有効な窓型ジョブのスロット。ensure_scrape_slots）→ unified 予測
 *      （race_entries があるのに unified が無いレースがあれば、日全体を生成）→ Deploy Hook（この日に書き込んだ場合）。
 *      各ステップの完了は cursor.finalize に記録し、失敗したステップだけを、次の起動が再試行する
 *   5. 全て済んだら cursor.done=true（live は、共通ラッパが last_target_date を記録する）
 *
 * 失敗の扱い: 全ての会場が失敗した起動・後始末の失敗は、実行の失敗（連続失敗数・0件エラーの通知）。ただし、その起動の
 * 進捗（成功した会場・バックオフ）と報告は、保存してから失敗にする（次の起動が、済みの会場をやり直さない）。
 * 取得先のサーキットブレーカーが開いているときは、失敗ではなく、何もせず終える（ブレーカーが閉じる頃に再開する）。
 *
 * 手動の動作確認: GET /api/cron/races-init?venues=N（Authorization: Bearer {CRON_SECRET}）で、1回の呼び出しで
 * 処理する会場数を N にする（mode が shadow・live のとき。live の場合は、書き込みと cursor の前進を伴う）。
 */
import { getTodayVenues, scrapeVenue } from "../../scrape-to-json.js";
import { fetchAll } from "../supabaseClient.js";
import { BreakerOpenError } from "../scrapeJobs/circuitBreaker.js";
import { truncateError } from "../scrapeJobs/outcomes.js";
import { windowJobNames } from "../scrapeJobs/registry.js";
import { createSupabaseStore } from "../scrapeJobs/store.js";
import { makeFetchHtml } from "../scrapeJobs/htmlFetch.js";
import { jstMinutesOfDay } from "../scrapeJobs/time.js";
import { digestScrapedVenue } from "./digest.js";

/** 1回の呼び出しで処理する会場数の上限（時間の許す限り、この数まで。1会場約30秒） */
export const RACES_INIT_VENUES_PER_INVOCATION = 8;
/** 1会場の中で同時に取得するレース数（各レースは beforeinfo と racelist を並列に取る＝同時リクエストは2倍） */
export const RACES_INIT_RACE_CONCURRENCY = 6;
/** 手動の動作確認（?venues=N）の上限 */
const MAX_VENUES_OVERRIDE = 24;
/** 会場一覧の再確認（取りこぼし会場の確認）を行う、JSTの時刻の上限（従来の morning-init と同じ9時） */
const RECHECK_UNTIL_JST_MIN = 9 * 60;
/** 会場の失敗の通知を出す連続失敗回数と、通知を出す期間（時間） */
const ALERT_AFTER_ATTEMPTS = 3;
const ALERT_NOTIFY_HOURS = 3;
/** last_report に残す、失敗の内容の最大数 */
const MAX_FAILURES_IN_REPORT = 10;

/** 再試行の待ち時間（分）。attempts=1 のとき2分、以降 4・8・16、上限20分 */
export function backoffMinutes(attempts) {
  return Math.min(20, 2 * 2 ** Math.max(0, attempts - 1));
}

/** ?venues=N の解釈（不正な値は例外にする。無視して既定にしない） */
export function resolveVenuesLimit(
  query,
  defaultLimit = RACES_INIT_VENUES_PER_INVOCATION,
) {
  const raw = query?.venues;
  if (raw === undefined || raw === "") return defaultLimit;
  if (
    !/^\d+$/.test(String(raw)) ||
    Number(raw) < 1 ||
    Number(raw) > MAX_VENUES_OVERRIDE
  ) {
    throw new Error(
      `venues は1〜${MAX_VENUES_OVERRIDE}の整数で指定してください: ${String(raw)}`,
    );
  }
  return Number(raw);
}

/** エラー（または cause の連鎖）に、サーキットブレーカーが開いていたことが含まれるか */
export function isBreakerOpenError(error) {
  for (let e = error, i = 0; e && i < 5; e = e.cause, i++) {
    if (e instanceof BreakerOpenError) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 既定の依存（テストでは差し替える）
// ---------------------------------------------------------------------------

/** 対象日の races に、既に行のある会場コード */
async function defaultExistingVenueCodes(client, date) {
  const rows = await fetchAll(
    "races",
    "race_id",
    (q) => q.gte("race_id", date).lt("race_id", `${date}~`),
    { client, throwOnError: true },
  );
  return new Set(rows.map((r) => Number(r.race_id.slice(11, 13))));
}

/** 1会場の races・race_entries・exhibition_data・predictions・race_conditions を書く（失敗は例外） */
async function defaultWriteVenue(venue, { date, client }) {
  const { generateAndWriteFromRacesData } =
    await import("../../daily/generate-predictions.js");
  await generateAndWriteFromRacesData({
    racesData: { success: true, date, data: [venue] },
    date,
    client,
    throwOnError: true,
  });
}

/** 予定表の生成の対象にする、有効（shadow・live）な窓型ジョブ */
async function defaultEnsureSlots(client, date) {
  const names = windowJobNames().filter((n) => n !== "pseudo");
  const { data, error } = await client
    .from("scrape_job_state")
    .select("job, mode")
    .in("job", names);
  if (error) throw new Error(`ジョブ状態の読み取りに失敗: ${error.message}`);
  const jobs = (data ?? [])
    .filter((r) => r.mode === "shadow" || r.mode === "live")
    .map((r) => r.job);
  if (jobs.length === 0) return { jobs: [], created: 0 };
  const created = await createSupabaseStore(client).ensureSlots({ date, jobs });
  return { jobs, created };
}

async function defaultEnsureUnified(client, date) {
  const { findRacesMissingUnified, generateUnifiedPredictions } =
    await import("../../daily/generate-unified-predictions.js");
  const missing = await findRacesMissingUnified(date, client);
  if (missing.length === 0) return { missing: 0, generated: 0 };
  // 日全体を upsert し直す（冪等。従来の ensureUnifiedPredictions と同じ）
  const result = await generateUnifiedPredictions({
    date,
    client,
    strict: true,
  });
  return { missing: missing.length, generated: result.generated };
}

async function defaultDeployHook() {
  const hook = process.env.VERCEL_DEPLOY_HOOK;
  if (!hook) return { triggered: false, reason: "no_hook" };
  try {
    const res = await fetch(hook, { method: "POST" });
    return res.ok
      ? { triggered: true }
      : { triggered: false, reason: `HTTP ${res.status}` };
  } catch (error) {
    return { triggered: false, reason: error.message };
  }
}

const DEFAULT_DEPS = Object.freeze({
  getVenues: getTodayVenues,
  scrapeVenue,
  existingVenueCodes: defaultExistingVenueCodes,
  writeVenue: defaultWriteVenue,
  ensureSlots: defaultEnsureSlots,
  ensureUnified: defaultEnsureUnified,
  triggerDeployHook: defaultDeployHook,
});

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

const newCursor = ({ date, mode, venues, existing, now }) => ({
  targetDate: date,
  mode,
  startedAt: now.toISOString(),
  venues,
  // 既に初期化済みの会場（live のみ）。処理せず、書き込みもしない
  existing: [...existing].sort((a, b) => a - b),
  targets: venues.filter((v) => !existing.has(v)),
  settled: [],
  attempts: {},
  retryAfter: {},
  lastErrors: {},
  digests: {},
  races: 0,
  entries: 0,
  listRechecked: false,
  wroteAny: false,
  finalize: {},
  done: false,
});

const isPending = (cursor, code, nowMs) =>
  !cursor.settled.includes(code) &&
  (!cursor.retryAfter[code] ||
    new Date(cursor.retryAfter[code]).getTime() <= nowMs);

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx。state.cursor は前回までの進捗）
 * @param {Object} [deps] テスト用の差し替え（DEFAULT_DEPS の各項目）
 */
export async function runRacesInitJob(ctx, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const live = ctx.mode === "live";
  const limit = resolveVenuesLimit(ctx.query);
  const fetchHtml = makeFetchHtml(ctx.politeFetch);
  const now = ctx.now();

  const previous = ctx.state?.cursor ?? null;
  let cursor =
    previous && previous.targetDate === date && previous.mode === ctx.mode
      ? structuredClone(previous)
      : null;
  if (cursor?.done) {
    // shadow の完了後の起動（live は、共通ラッパが last_target_date で、ここへ来ない）
    return {
      rowsWritten: 0,
      cursor: previous,
      report: ctx.state?.last_report ?? undefined,
      body: { skipped: "cycle_done", date },
    };
  }

  // 1. 計画: その日の最初の起動
  if (!cursor) {
    const venues = await d.getVenues(date, { fetchHtml, strict: true });
    if (venues.length === 0) {
      // 開催会場が1件も見つからない: 未公開・構造変化・開催なしの区別が付かないため、対象日を済みにせず、
      // 次の起動が再確認する（08:00 を過ぎても未完了なら、日次の期限超過の通知が出る）
      return {
        incomplete: true,
        report: { date, mode: ctx.mode, done: false, noVenues: true },
        body: { date, noVenues: true },
      };
    }
    const existing = live
      ? await d.existingVenueCodes(ctx.client, date)
      : new Set();
    cursor = newCursor({ date, mode: ctx.mode, venues, existing, now });
  }

  // 2. 会場の処理
  const failures = [];
  const wroteBefore = cursor.settled.length;
  let attempted = 0;
  let racesThisRun = 0;
  let breakerOpen = false;
  for (const code of cursor.targets) {
    if (attempted >= limit || ctx.shouldStop()) break;
    if (!isPending(cursor, code, ctx.now().getTime())) continue;
    attempted++;
    cursor.attempts[code] = (cursor.attempts[code] ?? 0) + 1;
    try {
      const venue = await d.scrapeVenue(date, code, {
        fetchHtml,
        strict: true,
        raceConcurrency: RACES_INIT_RACE_CONCURRENCY,
      });
      const summary = venue ? digestScrapedVenue(date, venue) : null;
      if (!summary || summary.races === 0) {
        // 開催会場一覧にあるのに、出走表が1レースも取れない（未公開・構造変化）。成功にしない
        throw new Error(
          `会場${code}: 開催会場一覧にあるのに、出走表を取得できませんでした（未公開・ページの構造変化の可能性）`,
        );
      }
      if (live) {
        await d.writeVenue(venue, { date, client: ctx.client });
        cursor.wroteAny = true;
      }
      Object.assign(cursor.digests, summary.digests);
      cursor.races += summary.races;
      cursor.entries += summary.entries;
      racesThisRun += summary.races;
      cursor.settled.push(code);
      delete cursor.retryAfter[code];
      delete cursor.lastErrors[code];
    } catch (error) {
      if (isBreakerOpenError(error)) {
        // 取得先のブレーカーが開いている: 失敗にせず、この起動を終える（試行回数も戻す）
        cursor.attempts[code] -= 1;
        breakerOpen = true;
        break;
      }
      const message = truncateError(error);
      cursor.lastErrors[code] = message;
      cursor.retryAfter[code] = new Date(
        ctx.now().getTime() + backoffMinutes(cursor.attempts[code]) * 60_000,
      ).toISOString();
      failures.push({
        venue: code,
        attempts: cursor.attempts[code],
        error: message,
      });
      console.error(`❌ races-init 会場${code}: ${message}`);
    }
  }

  const remaining = () =>
    cursor.targets.filter((v) => !cursor.settled.includes(v));

  // 3. 会場一覧の再確認（取りこぼし会場。全ての会場が済んでから、1回だけ）
  if (
    !breakerOpen &&
    remaining().length === 0 &&
    !cursor.listRechecked &&
    jstMinutesOfDay(ctx.now()) < RECHECK_UNTIL_JST_MIN
  ) {
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

  // 4. 後始末（live のみ。全ての会場が済んでから）
  let finalizeError = null;
  if (!breakerOpen && remaining().length === 0) {
    if (live) {
      finalizeError = await finalizeCycle({ ctx, d, cursor, date });
    }
    if (!finalizeError) cursor.done = true;
  }

  // 結果
  const allFailed = attempted > 0 && failures.length === attempted;
  const pending = remaining();
  const alerts = pending
    .filter(
      (v) =>
        (cursor.attempts[v] ?? 0) >= ALERT_AFTER_ATTEMPTS &&
        cursor.lastErrors[v],
    )
    .map((v) => ({
      key: `venue_failed:${v}`,
      until: new Date(
        ctx.now().getTime() + ALERT_NOTIFY_HOURS * 3600 * 1000,
      ).toISOString(),
      text: `朝の初期化で会場${v}が${cursor.attempts[v]}回連続で失敗しています（対象日 ${date}）: ${cursor.lastErrors[v]}`,
    }));
  if (finalizeError) {
    alerts.push({
      key: "finalize_failed",
      until: new Date(
        ctx.now().getTime() + ALERT_NOTIFY_HOURS * 3600 * 1000,
      ).toISOString(),
      text: `朝の初期化の後始末に失敗しています（対象日 ${date}）: ${finalizeError}`,
    });
  }

  const report = {
    date,
    mode: ctx.mode,
    done: cursor.done,
    existingVenues: cursor.existing.length,
    venues: cursor.venues.length,
    settled: cursor.settled.length,
    pending,
    races: cursor.races,
    entries: cursor.entries,
    wroteAny: cursor.wroteAny,
    finalize: cursor.finalize,
    breakerOpen,
    failures: failures.slice(0, MAX_FAILURES_IN_REPORT),
    alerts,
  };
  const body = {
    date,
    done: cursor.done,
    attempted,
    settledThisRun: cursor.settled.length - wroteBefore,
    settled: cursor.settled.length,
    remaining: pending.length,
    ...(breakerOpen ? { skipped: "breaker_open" } : {}),
    ...(failures.length > 0 ? { failures: failures.length } : {}),
  };

  // 全ての試行が失敗、または後始末の失敗は、実行の失敗にする。ただし、その起動の進捗は、先に保存する
  // （共通ラッパは、失敗のとき cursor を保存しないため。保存しないと、成功した会場を次の起動がやり直す）
  if (allFailed || finalizeError) {
    await saveProgress(ctx, { cursor, report });
    return {
      outcome: "error",
      error: allFailed
        ? `朝の初期化: 試行した${attempted}会場が全て失敗しました（${failures
            .slice(0, 3)
            .map((f) => `会場${f.venue}: ${f.error}`)
            .join(" / ")}）`
        : `朝の初期化の後始末に失敗しました: ${finalizeError}`,
      report,
    };
  }

  return {
    rowsWritten: live ? racesThisRun : 0,
    rowsParsed: racesThisRun,
    // 全ての会場と後始末が済むまでは、対象日を処理済みにしない（次の起動が続きを処理する）
    incomplete: !cursor.done,
    cursor,
    report,
    body,
  };
}

/**
 * 失敗で終わる起動の、進捗（cursor）と報告（last_report。会場の連続失敗・後始末の失敗の通知を含む）を保存する
 * （共通ラッパは、失敗のとき、どちらも保存しない。cursor を保存しないと、成功した会場を次の起動がやり直す）
 */
async function saveProgress(ctx, { cursor, report }) {
  const { error } = await ctx.client
    .from("scrape_job_state")
    .update({ cursor, last_report: report })
    .eq("job", ctx.job);
  if (error) {
    console.error(`❌ races-init: 進捗の保存に失敗: ${error.message}`);
  }
}

/**
 * 後始末（live）。各ステップの完了は cursor.finalize に記録し、済みのステップは、再実行しない。
 * 失敗したステップで止め、その内容を返す（成功なら null）。
 */
async function finalizeCycle({ ctx, d, cursor, date }) {
  const fin = cursor.finalize;
  try {
    if (!fin.slots) {
      const r = await d.ensureSlots(ctx.client, date);
      fin.slots = { jobs: r.jobs, created: r.created };
    }
    if (!fin.unified) {
      const r = await d.ensureUnified(ctx.client, date);
      fin.unified = { missing: r.missing, generated: r.generated };
    }
    if (!fin.hook) {
      // この日、実際に書き込んだ場合だけ、フロントエンドのCDNキャッシュを更新する（初期化済みを追認しただけなら不要）
      fin.hook = cursor.wroteAny
        ? await d.triggerDeployHook()
        : { triggered: false, reason: "nothing_written" };
      // Deploy Hook の失敗は、初期化の失敗にしない（ログのみ。従来の triggerDeployHook と同じ）
      if (!fin.hook.triggered && fin.hook.reason !== "nothing_written") {
        console.warn(`⚠️ Vercel Deploy Hook 失敗: ${fin.hook.reason}`);
      }
    }
    return null;
  } catch (error) {
    console.error("❌ races-init 後始末:", error);
    return truncateError(error);
  }
}

/**
 * api/cron/races-init.js の onTick（live のときだけ、起動のたびに。スロットの取得の前に呼ぶ）。
 * 予測ロジックの変更検知による再生成（predictCodeCheck.js）。
 */
export function createPredictCodeOnTick({ check } = {}) {
  return async function onTick(ctx) {
    const checkFn =
      check ?? (await import("./predictCodeCheck.js")).checkPredictCodeChange;
    const { getRaceSchedule } = await import("../raceSchedule.js");
    return checkFn({
      client: ctx.client,
      now: ctx.now,
      // 再計算のモジュールは、ハッシュが変わったときだけ読み込む
      refresh: async (args) =>
        (await import("../../daily/generate-predictions.js")).mainRefresh(args),
      getSchedule: getRaceSchedule,
    });
  };
}
