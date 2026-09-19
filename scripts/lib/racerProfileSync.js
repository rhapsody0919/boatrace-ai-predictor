// 選手プロフィール・期別成績の取得〜保存ロジック（scrape-racer-profiles.js の本体）
//
// BOA-321（期別成績・能力指数）/ BOA-322（racer_profiles自動更新化）対応
// （docs/design/scraping-full-coverage/ FR-2/FR-5）。
// CLI（scripts/maintenance/scrape-racer-profiles.js）と、オフライン検証
// （scripts/maintenance/verify-racer-profile-sync.js、モックしたfetch・Supabaseで実行）の
// 両方から使えるよう、DBクライアントと取得関数は引数で受け取る。
//
// 初回実行で失敗しないための設計（2026-09-19の事前検証で判明した問題への対応）:
//   - 期別成績は upsert ではなく update().eq("racer_id") で書く。upsert は INSERT 側の
//     NOT NULL 検査（name・birth_date）が ON CONFLICT より先に走り、既存行でも 23502 で落ちる
//   - update は対象行が無いと0件更新でもエラーにならないため、更新行数を確認して失敗扱いにする
//   - 値が変わっていない行は書かない（WAL・Disk IO対策。.claude/rules/data-acquisition.md §1）
//   - 対象の選手一覧は racer_profiles（約1,600行）＋直近の race_entries（新規選手の検出）から作る。
//     race_entries 全件（約26万行）のOFFSET巡回はしない
//   - 失敗は終了コードとレポートで可視化する（0件書き込みを成功扱いにしない）

import * as cheerio from "cheerio";
import {
  getSeasonStatsUrl,
  parseSeasonStatsHtml,
  SEASON_STATS_USER_AGENT,
} from "./racerSeasonStats.js";
import { getDateDaysAgo } from "./dateUtils.js";

export const REQUEST_DELAY_MS = 500;
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_RETRIES = 2; // 初回＋2回=最大3回試行
export const FETCH_BACKOFF_MS = 2_000;
// 新規選手（race_entriesにいるがracer_profilesに未登録）を検出する窓。
// 月次実行の間隔（最大31日）を余裕を持って覆う日数
export const DEFAULT_RECENT_DAYS = 35;
// 期別成績の取得・保存に失敗した選手の割合がこれを超えたら実行全体を失敗とする
export const MAX_SEASON_FAIL_RATE = 0.05;
// 成功（書き込み・変更なし確認）が1件も無いまま失敗がこの件数に達したら、全件を巡回せず中断する
// （書き込み側の系統的な失敗で、公式サイトへの無駄なリクエストを続けないため）
export const ABORT_AFTER_FAILURES_WITHOUT_SUCCESS = 20;

const PAGE_SIZE = 1000;

export const SEASON_COLUMNS = [
  "ability_index",
  "flying_count_period",
  "false_start_count_period",
  "period_label",
  "official_win_rate_period",
];

const REQUEST_HEADERS = {
  "User-Agent": SEASON_STATS_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function parseIntArg(name, value, min) {
  if (!/^\d+$/.test(value) || Number(value) < min) {
    throw new Error(
      `--${name} は${min}以上の整数で指定してください（指定値: "${value}"）`,
    );
  }
  return Number(value);
}

// 不明な引数はエラーにする（--racer-id= のような打ち間違いで全件実行になるのを防ぐ）。
// 値が空文字の引数（workflow_dispatchの未入力）は未指定として扱う。
export function parseArgs(argv) {
  const options = {
    dryRun: false,
    verbose: false,
    limit: null,
    offset: 0,
    racerIds: null,
    recentDays: DEFAULT_RECENT_DAYS,
    maxMinutes: null,
    delayMs: REQUEST_DELAY_MS,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else {
      const match = arg.match(/^--([a-z-]+)=(.*)$/);
      if (!match) throw new Error(`不明な引数です: ${arg}`);
      const [, name, value] = match;
      if (value === "") continue;
      if (name === "limit") options.limit = parseIntArg(name, value, 1);
      else if (name === "offset") options.offset = parseIntArg(name, value, 0);
      else if (name === "recent-days")
        options.recentDays = parseIntArg(name, value, 1);
      else if (name === "max-minutes")
        options.maxMinutes = parseIntArg(name, value, 1);
      else if (name === "delay-ms")
        options.delayMs = parseIntArg(name, value, 0);
      else if (name === "racer-ids") {
        options.racerIds = value
          .split(",")
          .map((id) => parseIntArg("racer-ids", id.trim(), 1));
      } else throw new Error(`不明な引数です: ${arg}`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// 公式サイトの取得（タイムアウト・リトライ付き）
// ---------------------------------------------------------------------------

const isRetryableStatus = (status) =>
  status === 408 || status === 429 || status >= 500;

// HTMLを返す。ページが存在しない（恒久的な4xx）場合は null。
// タイムアウト・通信エラー・一時的なHTTPエラー（408/429/5xx）は最大 retries 回リトライし、
// それでも失敗したら例外を投げる（呼び出し側が「取得失敗」として記録する）
export async function fetchHtmlWithRetry(
  url,
  {
    fetchImpl = fetch,
    sleep = defaultSleep,
    timeoutMs = FETCH_TIMEOUT_MS,
    retries = FETCH_RETRIES,
    backoffMs = FETCH_BACKOFF_MS,
  } = {},
) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const response = await fetchImpl(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.text();
      if (!isRetryableStatus(response.status)) return null;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `${url} の取得に失敗（${retries + 1}回試行）: ${lastError?.message}`,
  );
}

// dl.list3 の dt/dd ペアをパースして選手プロフィールを取得する。
// プロフィールが存在しない racer_id は dl.list3 自体が出力されないため null を返す
export function parseProfileHtml(racerId, html) {
  const $ = cheerio.load(html);

  const $dl = $("dl.list3").first();
  if ($dl.length === 0) return null;

  const fields = {};
  const $items = $dl.children();
  for (let i = 0; i < $items.length; i += 2) {
    const key = $($items[i]).text().trim();
    const value = $($items[i + 1])
      .text()
      .trim();
    fields[key] = value;
  }

  const birthDateText = fields["生年月日"]; // "1983/06/09"
  if (!birthDateText) return null;
  const birthDate = birthDateText.replace(/\//g, "-");

  return {
    racerId,
    name: $(".racer1_bodyName").first().text().trim() || null,
    nameKana: $(".racer1_bodyKana").first().text().trim() || null,
    birthDate,
    heightCm: fields["身長"] ? parseInt(fields["身長"], 10) : null,
    weightKg: fields["体重"] ? parseInt(fields["体重"], 10) : null,
    bloodType: fields["血液型"] || null,
    branch: fields["支部"] || null,
    hometown: fields["出身地"] || null,
    registrationPeriod: fields["登録期"] || null,
    gradeAtScrape: fields["級別"] || null,
  };
}

export function getProfileUrl(racerId) {
  return `https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=${racerId}`;
}

async function scrapeProfile(racerId, fetchOptions) {
  const html = await fetchHtmlWithRetry(getProfileUrl(racerId), fetchOptions);
  return html === null ? null : parseProfileHtml(racerId, html);
}

async function scrapeSeasonStatsWithRetry(racerId, fetchOptions) {
  const html = await fetchHtmlWithRetry(
    getSeasonStatsUrl(racerId),
    fetchOptions,
  );
  return html === null ? null : parseSeasonStatsHtml(html);
}

// ---------------------------------------------------------------------------
// 期別成績の行の組み立て・比較・保存
// ---------------------------------------------------------------------------

// 期別成績ページのパース結果を racer_profiles の追加カラムにマッピングする。
// 集計期間内にデータがない項目はnullのまま保存する。
// racer_id は含めない（update().eq() の条件側で指定する）
export function toSeasonStatsRow(
  seasonStats,
  nowIso = new Date().toISOString(),
) {
  return {
    ability_index: seasonStats.abilityIndex,
    flying_count_period: seasonStats.flyingCount,
    false_start_count_period: seasonStats.falseStartCount,
    period_label: seasonStats.periodLabel,
    official_win_rate_period: seasonStats.winRate,
    official_updated_at: nowIso,
  };
}

// official_win_rate_period は numeric(5,2)。DBに書かれる値（小数第2位）に揃えて比較する
function normalizeForCompare(column, value) {
  if (value === undefined || value === null) return null;
  if (column === "official_win_rate_period")
    return Number(Number(value).toFixed(2));
  return value;
}

// 既存行（SEASON_COLUMNSを含む）と書き込み予定の行が同じ内容か。
// official_updated_at は毎回変わるだけで情報を持たないため比較しない。
// 既存行が無い（未登録・取得していない）場合は「変更あり」に倒す（誤ってスキップしない）
export function isSeasonRowUnchanged(existing, row) {
  if (!existing) return false;
  return SEASON_COLUMNS.every(
    (column) =>
      normalizeForCompare(column, existing[column]) ===
      normalizeForCompare(column, row[column]),
  );
}

// 既存行の期別成績カラムだけを更新する。氏名・級別・支部・生年月日等は触らない。
// 更新された行数を確認する（update は対象行が無くてもエラーにならないため）
export async function saveSeasonStats(client, racerId, row) {
  const { data, error } = await client
    .from("racer_profiles")
    .update(row)
    .eq("racer_id", racerId)
    .select("racer_id");
  if (error) return { error: new Error(error.message) };
  if (!data || data.length === 0) {
    return {
      error: new Error("racer_profilesに対象行が無く、更新0件でした"),
    };
  }
  return { error: null };
}

// 新規選手のプロフィールを登録する（全列を送るため upsert のままでよい）
async function saveNewProfile(client, profile) {
  const { error } = await client.from("racer_profiles").upsert({
    racer_id: profile.racerId,
    name: profile.name,
    name_kana: profile.nameKana,
    birth_date: profile.birthDate,
    height_cm: profile.heightCm,
    weight_kg: profile.weightKg,
    blood_type: profile.bloodType,
    branch: profile.branch,
    hometown: profile.hometown,
    registration_period: profile.registrationPeriod,
    grade_at_scrape: profile.gradeAtScrape,
  });
  return { error: error ? new Error(error.message) : null };
}

// ---------------------------------------------------------------------------
// 対象選手の決定
// ---------------------------------------------------------------------------

async function selectAllPages(label, makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(
      offset,
      offset + PAGE_SIZE - 1,
    );
    if (error) throw new Error(`${label}取得エラー: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// 登録済み選手と、その期別成績の現在値（変更なし判定用）。racerIds指定時はその選手だけ読む
export async function loadRegisteredProfiles(client, racerIds) {
  const columns = ["racer_id", ...SEASON_COLUMNS].join(",");
  const rows = await selectAllPages("racer_profiles", () => {
    const query = client.from("racer_profiles").select(columns);
    return (racerIds ? query.in("racer_id", racerIds) : query).order(
      "racer_id",
    );
  });
  return new Map(rows.map((row) => [row.racer_id, row]));
}

// 直近 recentDays 日に出走した選手（新規選手の検出用）。race_id は "YYYY-MM-DD-会場-R" 形式で
// 日付が先頭にあるため、主キー(race_id, boat_number)の範囲走査で絞り込める
export async function loadRecentRacerIds(client, recentDays) {
  const fromDate = getDateDaysAgo(recentDays);
  const rows = await selectAllPages("race_entries", () =>
    client
      .from("race_entries")
      .select("racer_id")
      .not("racer_id", "is", null)
      .gte("race_id", fromDate)
      .order("race_id")
      .order("boat_number"),
  );
  return new Set(rows.map((row) => row.racer_id));
}

// racerIds 指定時はそれだけ。未指定時は「登録済み ∪ 直近出走」の昇順。
// offset/limit は昇順の並びに対して適用する（--offset で途中から再開できる）
export function buildPopulation({
  registered,
  recentIds,
  racerIds,
  limit,
  offset,
}) {
  const ids = racerIds
    ? [...new Set(racerIds)]
    : [...new Set([...registered.keys(), ...recentIds])];
  ids.sort((a, b) => a - b);
  return ids.slice(offset, limit ? offset + limit : undefined);
}

// ---------------------------------------------------------------------------
// 実行結果の判定
// ---------------------------------------------------------------------------

// 失敗を緑にしない（.claude/rules/data-acquisition.md §1「書き込み0件を成功扱いにしない」）。
// 「書き込み」と「変更なしの確認」はどちらも成功（2回目以降の実行は大半が変更なしになる）
export function evaluateRun(summary) {
  const reasons = [];
  const { season } = summary;
  if (summary.targetCount === 0) reasons.push("対象選手が0件");
  if (summary.aborted) {
    reasons.push(
      `成功が1件も無いまま失敗が${season.failCount}件に達したため中断`,
    );
  }
  if (summary.stoppedEarly) {
    reasons.push(
      `時間予算に達して中断（未処理あり。--offset=${summary.nextOffset} で再開）`,
    );
  }
  if (
    summary.targetCount > 0 &&
    season.successCount + season.unchangedCount === 0
  ) {
    reasons.push("期別成績の書き込みも変更なしの確認も0件");
  }
  const failRate =
    summary.targetCount > 0 ? season.failCount / summary.targetCount : 0;
  if (failRate > MAX_SEASON_FAIL_RATE) {
    reasons.push(
      `期別成績の失敗率が${(failRate * 100).toFixed(1)}%（${season.failCount}/${summary.targetCount}件、上限${MAX_SEASON_FAIL_RATE * 100}%）`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * @param {{client: object, options: ReturnType<typeof parseArgs>, deps?: object}} params
 *   deps: {fetchImpl, sleep, now, log, logError}（検証用に差し替え可能）
 * @returns {Promise<{summary: object, verdict: {ok: boolean, reasons: string[]}}>}
 */
export async function runRacerProfileSync({ client, options, deps = {} }) {
  const {
    fetchImpl = fetch,
    sleep = defaultSleep,
    now = () => Date.now(),
    log = console.log,
    logError = console.error,
  } = deps;
  const fetchOptions = { fetchImpl, sleep };
  const startedAt = now();

  log("=== 選手プロフィール・期別成績 取得スクリプト ===");
  log(`モード: ${options.dryRun ? "ドライラン（テスト）" : "本番実行"}`);
  log("");

  const registered = await loadRegisteredProfiles(client, options.racerIds);
  const recentIds = options.racerIds
    ? new Set()
    : await loadRecentRacerIds(client, options.recentDays);
  const population = buildPopulation({
    registered,
    recentIds,
    racerIds: options.racerIds,
    limit: options.limit,
    offset: options.offset,
  });
  const newProfileCount = population.filter((id) => !registered.has(id)).length;
  log(
    `対象racer_id数: ${population.length}件` +
      `（登録済み${registered.size}件・直近${options.recentDays}日の出走${recentIds.size}件` +
      `${options.racerIds ? "・racer-ids指定" : ""}${options.limit ? `・limit=${options.limit}` : ""}` +
      `${options.offset ? `・offset=${options.offset}` : ""}）`,
  );
  log(`うち新規プロフィール登録対象（FR-5）: ${newProfileCount}件`);
  log("");

  const profile = { successCount: 0, failCount: 0, failedRacerIds: [] };
  const season = {
    successCount: 0, // 書き込んだ件数（dry-runでは書く予定の件数）
    unchangedCount: 0, // 既存値と同じため書かなかった件数
    noDataCount: 0, // ページはあるが集計期間内データが無い（新人選手等）
    failCount: 0,
    failedRacerIds: [],
  };
  let stoppedEarly = false;
  let aborted = false;
  let nextOffset = null;
  const maxMs = options.maxMinutes ? options.maxMinutes * 60_000 : null;

  const recordSeasonFailure = (racerId, progress, message) => {
    season.failCount++;
    season.failedRacerIds.push(racerId);
    logError(`${progress} racer_id=${racerId} [season] 失敗: ${message}`);
  };

  for (let i = 0; i < population.length; i++) {
    if (maxMs !== null && now() - startedAt > maxMs) {
      stoppedEarly = true;
      nextOffset = options.offset + i;
      log(`時間予算（${options.maxMinutes}分）に達したため中断します。`);
      break;
    }

    const racerId = population[i];
    const progress = `[${i + 1}/${population.length}]`;
    const isNewProfile = !registered.has(racerId);
    let hasProfile = !isNewProfile;

    // 1. 新規選手のみ: 基本プロフィール取得（FR-5）
    if (isNewProfile) {
      let scraped = null;
      let failureMessage =
        "プロフィールページが存在しない、または生年月日が取得できない";
      try {
        scraped = await scrapeProfile(racerId, fetchOptions);
      } catch (err) {
        failureMessage = err.message;
      }

      if (!scraped) {
        profile.failCount++;
        profile.failedRacerIds.push(racerId);
        log(
          `${progress} racer_id=${racerId} [profile] 取得失敗（スキップ）: ${failureMessage}`,
        );
      } else if (options.dryRun) {
        profile.successCount++;
        hasProfile = true;
        log(
          `${progress} racer_id=${racerId} [profile] → ${scraped.name} 生年月日=${scraped.birthDate} (dry-run)`,
        );
      } else {
        const { error } = await saveNewProfile(client, scraped);
        if (error) {
          profile.failCount++;
          profile.failedRacerIds.push(racerId);
          logError(
            `${progress} racer_id=${racerId} [profile] 保存エラー: ${error.message}`,
          );
        } else {
          profile.successCount++;
          hasProfile = true;
          log(
            `${progress} racer_id=${racerId} [profile] → ${scraped.name} 生年月日=${scraped.birthDate}`,
          );
        }
      }
      await sleep(options.delayMs);
    }

    // 2. 全選手（プロフィールが存在する場合のみ）: 期別成績取得（FR-2）
    //    無効なracer_idへの無駄なリクエストを避けるため、プロフィール未確認の選手はスキップする
    if (hasProfile) {
      let seasonStats = null;
      let failureMessage = "期別成績ページを取得・解析できない";
      try {
        seasonStats = await scrapeSeasonStatsWithRetry(racerId, fetchOptions);
      } catch (err) {
        failureMessage = err.message;
      }

      if (!seasonStats) {
        recordSeasonFailure(racerId, progress, failureMessage);
      } else if (
        seasonStats.abilityIndex === null &&
        seasonStats.starts === null
      ) {
        season.noDataCount++;
        if (options.verbose)
          log(
            `${progress} racer_id=${racerId} [season] 集計期間内データ無し（新人選手等）`,
          );
      } else {
        const row = toSeasonStatsRow(
          seasonStats,
          new Date(now()).toISOString(),
        );
        if (isSeasonRowUnchanged(registered.get(racerId), row)) {
          season.unchangedCount++;
          if (options.verbose)
            log(
              `${progress} racer_id=${racerId} [season] 変更なし（書き込みスキップ）`,
            );
        } else if (options.dryRun) {
          season.successCount++;
          log(
            `${progress} racer_id=${racerId} [season] 能力指数=${seasonStats.abilityIndex} F=${seasonStats.flyingCount} 期=${seasonStats.periodLabel} (dry-run、書き込みなし)`,
          );
        } else {
          const { error } = await saveSeasonStats(client, racerId, row);
          if (error) {
            recordSeasonFailure(
              racerId,
              progress,
              `保存エラー: ${error.message}`,
            );
          } else {
            season.successCount++;
            if (options.verbose)
              log(
                `${progress} racer_id=${racerId} [season] 能力指数=${seasonStats.abilityIndex} F=${seasonStats.flyingCount}`,
              );
          }
        }
      }

      await sleep(options.delayMs);

      if (
        season.failCount >= ABORT_AFTER_FAILURES_WITHOUT_SUCCESS &&
        season.successCount + season.unchangedCount === 0
      ) {
        aborted = true;
        nextOffset = options.offset + i + 1;
        break;
      }
    }

    if ((i + 1) % 50 === 0 || i === population.length - 1) {
      log(
        `${progress} profile成功: ${profile.successCount}件/失敗: ${profile.failCount}件, ` +
          `season書込: ${season.successCount}件/変更なし: ${season.unchangedCount}件/データ無し: ${season.noDataCount}件/失敗: ${season.failCount}件`,
      );
    }
  }

  const summary = {
    executedAt: new Date(now()).toISOString(),
    durationSeconds: Math.round((now() - startedAt) / 1000),
    mode: options.racerIds ? "racer_ids" : "all",
    options: {
      racerIds: options.racerIds,
      limit: options.limit,
      offset: options.offset,
      recentDays: options.recentDays,
    },
    targetCount: population.length,
    stoppedEarly,
    aborted,
    nextOffset,
    profile,
    season,
  };
  const verdict = evaluateRun(summary);

  log("");
  log("=== 完了 ===");
  log(
    `[profile] 成功: ${profile.successCount}件, 失敗（除外）: ${profile.failCount}件`,
  );
  log(
    `[season] 書き込み: ${season.successCount}件, 変更なし: ${season.unchangedCount}件, データ無し: ${season.noDataCount}件, 失敗: ${season.failCount}件`,
  );
  if (season.failedRacerIds.length > 0)
    log(`[season] 失敗した登録番号: ${season.failedRacerIds.join(",")}`);
  if (!verdict.ok) {
    logError(`実行を失敗として扱います: ${verdict.reasons.join(" / ")}`);
  }

  return { summary, verdict };
}
