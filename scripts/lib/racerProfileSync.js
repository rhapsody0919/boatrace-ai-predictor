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
  isRacerPageNotFound,
  parseSeasonStatsHtml,
  SEASON_STATS_REQUEST_HEADERS,
} from "./racerSeasonStats.js";
import { getDateDaysAgo } from "./dateUtils.js";
import {
  buildSyncSummary,
  createSyncCounters,
  createSyncState,
  logSyncCompletion,
  populationLogLine,
  runSyncWorkers,
} from "./racerProfileSyncSteps.js";

export const REQUEST_DELAY_MS = 500;
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_RETRIES = 2; // 初回＋2回=最大3回試行
export const FETCH_BACKOFF_MS = 2_000;
// 新規選手（race_entriesにいるがracer_profilesに未登録）を検出する窓。
// 月次実行の間隔（最大31日）を余裕を持って覆う日数
export const DEFAULT_RECENT_DAYS = 35;
// 期別成績の取得・保存に失敗した選手の割合がこれを超えたら実行全体を失敗とする
export const MAX_SEASON_FAIL_RATE = 0.05;
// 期別成績の失敗がこの件数だけ連続したら、全件を巡回せず中断する（書き込み側の系統的な失敗や
// 公式サイトの停止で、無駄なリクエストを最大5時間続けないため。途中まで成功していても効く）
export const ABORT_AFTER_CONSECUTIVE_FAILURES = 20;
// 新規選手のプロフィール取得が全滅した（成功0件）と判断する最小の失敗件数
// （引退済み等でページが無い選手が1〜2人混ざるだけでは失敗にしない）
const PROFILE_ALL_FAILED_MIN_COUNT = 3;

const PAGE_SIZE = 1000;

export const SEASON_COLUMNS = [
  "ability_index",
  "flying_count_period",
  "false_start_count_period",
  "period_label",
  "official_win_rate_period",
];

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
    // CLI の引数にはしない（Vercel のチャンク処理が、コードから指定する）
    afterRacerId: null, // この登録番号より大きい選手だけを対象にする（チャンクの再開位置）
    concurrency: 1, // 選手ごとの取得の同時数
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
        headers: SEASON_STATS_REQUEST_HEADERS,
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

// 期別成績ページを取得・解析した結果、公式サイトが「この登録番号は存在しない」ページを
// 返したことを示す一意な値（BOA-376）。構造変化・通信エラー等の parseSeasonStatsHtml が
// 返す null（本当の解析失敗）とは区別する
export const RACER_PAGE_NOT_FOUND = Symbol("racer-page-not-found");

async function scrapeSeasonStatsWithRetry(racerId, fetchOptions) {
  const html = await fetchHtmlWithRetry(
    getSeasonStatsUrl(racerId),
    fetchOptions,
  );
  if (html === null) return null;
  if (isRacerPageNotFound(html)) return RACER_PAGE_NOT_FOUND;
  return parseSeasonStatsHtml(html);
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
//
// scraped_at-intentionally-not-set（BOA-463で検討し、更新しないと決めた）:
// racer_profiles の1行は2つの取得元が混ざっている。プロフィール（氏名・生年月日・支部等）は
// 新規選手のときだけ scrapeProfile → saveNewProfile で書かれ、既存選手では**再取得されない**
// （runRacerProfileSync の `if (isNewProfile)`）。したがって scraped_at＝「プロフィールを取得した
// 時刻」は初回挿入時のままで正しく、DEFAULT now() が意図どおり効いている。
// 期別成績側の更新時刻は official_updated_at が別に持つ（toSeasonStatsRow）。
// ここで scraped_at を打つと、プロフィールを取り直していないのに取得時刻が動き、
// 「PATCHは期別成績の列だけを触る」という約束（verify-racer-profile-sync.js が検査）も破る。
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
//
// scraped_at-intentionally-not-set: ここは新規行の挿入だけを行うため、DEFAULT now() が
// 意図どおり効く。既存行を更新する経路は無い（呼び出し元の `if (isNewProfile)`）
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
// afterRacerId 指定時は、その登録番号より大きい選手だけ（チャンク処理の再開位置。件数の増減があっても、
// 位置（offset）がずれない）。offset/limit は、その昇順の並びに対して適用する（--offset で途中から再開できる）
export function buildPopulation({
  registered,
  recentIds,
  racerIds,
  limit,
  offset,
  afterRacerId = null,
  newProfilesOnly = false,
}) {
  const all = racerIds
    ? [...new Set(racerIds)]
    : [...new Set([...registered.keys(), ...recentIds])];
  // 新人だけの回は、絞り込みを limit・再開位置・残件数の計算より先に行う。
  const ids = all.filter(
    (id) =>
      (!newProfilesOnly || !registered.has(id)) &&
      (afterRacerId === null || id > afterRacerId),
  );
  ids.sort((a, b) => a - b);
  return ids.slice(offset, limit ? offset + limit : undefined);
}

// ---------------------------------------------------------------------------
// 実行結果の判定
// ---------------------------------------------------------------------------

// 失敗を緑にしない（.claude/rules/data-acquisition.md §1「書き込み0件を成功扱いにしない」）。
// 「書き込み」と「変更なしの確認」はどちらも成功（2回目以降の実行は大半が変更なしになる）
export function evaluateRun(summary, { allowEmpty = false } = {}) {
  const reasons = [];
  const { season } = summary;
  if (!allowEmpty && summary.targetCount === 0 && !summary.resumed)
    reasons.push("対象選手が0件");
  if (summary.aborted) {
    reasons.push(
      `期別成績の失敗が${ABORT_AFTER_CONSECUTIVE_FAILURES}件連続したため中断`,
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
  const { profile } = summary;
  if (profile.saveErrorCount > 0) {
    reasons.push(
      `新規選手のプロフィール保存でDBエラー${profile.saveErrorCount}件`,
    );
  }
  if (
    profile.successCount === 0 &&
    profile.failCount >= PROFILE_ALL_FAILED_MIN_COUNT
  ) {
    reasons.push(
      `新規選手のプロフィール取得が${profile.failCount}件すべて失敗`,
    );
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
    // true を返したら、以降の選手に着手しない（Vercel: ソフトデッドライン。時間予算 --max-minutes とは別で、
    // 中断は失敗ではなく、チャンクの区切り）
    shouldStop = () => false,
    // fetchImpl が再試行を持つ（Vercel: politeFetch）とき、ここでの再試行を減らして二重にしない
    fetchRetries = FETCH_RETRIES,
  } = deps;
  const fetchOptions = { fetchImpl, sleep, retries: fetchRetries };
  const startedAt = now();

  log("=== 選手プロフィール・期別成績 取得スクリプト ===");
  log(`モード: ${options.dryRun ? "ドライラン（テスト）" : "本番実行"}`);
  log("");

  const registered = await loadRegisteredProfiles(client, options.racerIds);
  const recentIds = options.racerIds
    ? new Set()
    : await loadRecentRacerIds(client, options.recentDays);
  const populationArgs = {
    registered,
    recentIds,
    racerIds: options.racerIds,
    limit: options.limit,
    offset: options.offset,
    afterRacerId: options.afterRacerId,
    newProfilesOnly: options.newProfilesOnly,
  };
  const population = buildPopulation(populationArgs);
  // このチャンクの後に残る選手数（limit・offset を外した、対象全体）を、チャンク処理の完了判定に使う
  const eligibleCount = buildPopulation({
    ...populationArgs,
    limit: null,
  }).length;
  const newProfileCount = population.filter((id) => !registered.has(id)).length;
  log(populationLogLine(options, population, registered, recentIds));
  log(`うち新規プロフィール登録対象（FR-5）: ${newProfileCount}件`);
  log("");

  const run = {
    client,
    options,
    log,
    logError,
    sleep,
    now,
    shouldStop,
    startedAt,
    fetchOptions,
    maxMs: options.maxMinutes ? options.maxMinutes * 60_000 : null,
    population,
    registered,
    ...createSyncCounters(),
    state: createSyncState(),
    io: {
      scrapeProfile,
      saveNewProfile,
      scrapeSeasonStatsWithRetry,
      saveSeasonStats,
      toSeasonStatsRow,
      isSeasonRowUnchanged,
      notFound: RACER_PAGE_NOT_FOUND,
      abortAfter: ABORT_AFTER_CONSECUTIVE_FAILURES,
    },
  };
  await runSyncWorkers(run);

  const summary = buildSyncSummary(run, eligibleCount);
  const verdict = evaluateRun(summary, {
    allowEmpty: options.newProfilesOnly && registered.size > 0,
  });
  logSyncCompletion(run, verdict);

  return { summary, verdict };
}
