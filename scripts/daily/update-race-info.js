/**
 * レース情報リアルタイム更新スクリプト
 *
 * 発走1時間前のウィンドウで racelist・beforeinfo をスクレイプし、
 * 出場選手情報・天候データを Supabase に更新する。
 * 欠場・代替選手・レース中止の検出もここで行う。
 *
 * scrape-scheduled.yml から5分毎に実行される（1時間前ウィンドウのレースのみ対象）。
 * 実装パターン: scrape-exhibition-data.js に準拠
 */

import * as cheerio from "cheerio";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { computeCancellationTransition } from "../lib/cancellationStatus.js";
import { scrapeRaceStage } from "../lib/raceStageParser.js";
import {
  parseRaceListPage,
  scrapeRaceMeta,
  scrapeSeriesDay,
} from "../lib/raceListParser.js";
import {
  buildRaceConditionRow,
  buildRaceEntryRows,
  planDeadlineUpdates,
} from "../lib/preRaceRows.js";
import {
  PRE_RACE_OPTIONAL_COLUMN_GROUPS,
  detectPreRaceSchema,
} from "../lib/preRaceSchema.js";
import {
  diffRows,
  formatSkipSummary,
  planWriteAll,
  upsertChangedRows,
} from "../lib/unchangedRows.js";
import {
  buildStartTimeLookup,
  buildWeatherRows,
  convertWindDirection,
  formatWeatherStats,
  scrapeConditions,
} from "../lib/beforeinfoWeather.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// 発走1時間前ウィンドウ（±3分）
const WINDOW_MINUTES = 60;

/**
 * 1レースの racelist + beforeinfo を並列取得
 */
async function fetchRaceInfo(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const racelistUrl = `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const beforeinfoUrl = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  try {
    const [racelistRes, beforeinfoRes] = await Promise.all([
      fetch(racelistUrl, { headers: FETCH_HEADERS }),
      fetch(beforeinfoUrl, { headers: FETCH_HEADERS }),
    ]);

    if (!racelistRes.ok) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R racelist 取得失敗 HTTP ${racelistRes.status}`,
      );
      return null;
    }

    // 出走表は、全項目を1回で解析する（scripts/lib/raceListParser.js）
    const page = parseRaceListPage(await racelistRes.text());
    const racers = page.entries;

    // 選手が1人も取得できない場合は中止・未公開の可能性
    if (racers.length === 0) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 選手情報なし（中止・未公開の可能性）`,
      );
      return null;
    }

    // 欠場検出: 出走表で欠場の表示（tbody の is-miss）の艇、または登録番号を読めない艇
    const absentBoats = racers
      .filter((r) => r.is_absent || r.racer_id === null)
      .map((r) => r.boat_number);
    if (absentBoats.length > 0) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 欠場/代替の可能性: ${absentBoats.map((b) => `${b}号艇`).join(", ")}`,
      );
    }
    for (const anomaly of page.anomalies) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 出走表: ${anomaly}`,
      );
    }

    let conditions = null;
    if (beforeinfoRes.ok) {
      conditions = scrapeConditions(cheerio.load(await beforeinfoRes.text()));
    }

    return { page, conditions };
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 取得エラー: ${err.message}`,
    );
    return null;
  }
}

/**
 * オーケストレーターから呼び出し可能なレース情報更新処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{dryRun?: boolean, syncDeadlines?: boolean, client?: import("@supabase/supabase-js").SupabaseClient}} [options]
 *   dryRun=trueならDBへ書き込まず、書くはずの件数だけログに出す。
 *   syncDeadlines: 出走表の「締切予定時刻」の行が races.start_time と違うレースの start_time を更新するか
 *   （既定 true。日中の時刻変更への追従。N15）。client: テスト用のSupabaseクライアントの差し替え
 * @returns {Promise<{updated: boolean, count: number, deadlineUpdates?: number}>}
 *   updated/count は「取得できた件数」で、DBへ実際に書いた件数ではない（変更の無い行は
 *   書かないが、後続の予測リフレッシュの起動条件は従来どおり取得ベースのまま変えない）
 */
export async function run(
  schedule,
  date,
  { dryRun = false, syncDeadlines = true, client = supabase } = {},
) {
  // 発走1時間前ウィンドウのレースのみ対象
  const targetRaces = getRacesInWindow(schedule, WINDOW_MINUTES);
  if (targetRaces.length === 0) {
    console.log(
      `📭 レース情報: 発走${WINDOW_MINUTES}分前ウィンドウの対象レースなし`,
    );
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 レース情報更新: ${targetRaces.length}レース（発走${WINDOW_MINUTES}分前ウィンドウ）`,
  );
  // 気象の観測時刻の解決用（「N R時点」の気象は、Nレース目の発走予定時刻を観測時刻とする）
  const startTimeLookup = buildStartTimeLookup(schedule);

  // 出走表の新しい列（マイグレーション081）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const schema = await detectPreRaceSchema(client);
  const entriesExtended = schema.raceEntries;
  const conditionsExtended = schema.raceConditions;

  // 中止・順延の暫定検知（BOA-254 FR1）用に、対象レースの現在の状態を取得
  const { data: cancellationRows, error: cancellationFetchError } = await client
    .from("races")
    // race_grade は、後段の races.race_grade 更新で「変更なし」を判定する既存値として使う
    // （追加の読み取りをしないため、同じクエリで取得する）
    .select(
      "race_id, cancellation_status, cancellation_check_streak, race_grade",
    )
    .in(
      "race_id",
      targetRaces.map((r) => r.race_id),
    );
  if (cancellationFetchError) {
    console.error(
      "⚠️ cancellation_status取得エラー（今回は暫定検知をスキップ）:",
      cancellationFetchError.message,
    );
  }
  const cancellationMap = new Map(
    (cancellationRows || []).map((r) => [r.race_id, r]),
  );

  // 会場ごとにグループ化して並列取得
  const entriesRows = [];
  const conditionsRows = [];
  const weatherFetched = [];
  const racesGradeUpdates = [];
  const cancellationUpdates = [];
  // 出走表の締切予定時刻による races.start_time の更新（race_id で重複を除く）
  const deadlineUpdates = new Map();

  const byVenue = new Map();
  for (const r of targetRaces) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchRaceInfo(date, r.venue_code, r.race_no).then((data) => ({
          r,
          data,
        })),
      ),
    );

    for (const { r, data } of results) {
      // 中止・順延の暫定検知（BOA-254 FR1）: data有無に関わらず全レース分計算する。
      // 現在の状態の取得自体に失敗している場合、全レースがcancellationMapに
      // 存在しない=デフォルト値（null/0）にフォールバックしてしまい、既に
      // tentativeへ昇格済みのレースのstreakを誤ってリセットする恐れがあるため、
      // その回はまるごと計算をスキップする（cancellationFetchErrorのログ通り）
      if (!cancellationFetchError) {
        const cancellationCurrent = cancellationMap.get(r.race_id) || {
          cancellation_status: null,
          cancellation_check_streak: 0,
        };
        const cancellationNext = computeCancellationTransition({
          currentStatus: cancellationCurrent.cancellation_status,
          currentStreak: cancellationCurrent.cancellation_check_streak,
          racersFound: Boolean(data),
        });
        if (cancellationNext.changed) {
          cancellationUpdates.push({
            race_id: r.race_id,
            cancellation_status: cancellationNext.nextStatus,
            cancellation_check_streak: cancellationNext.nextStreak,
          });
        }
      }

      if (!data) continue;
      const { page, conditions } = data;
      const { raceGrade, raceTitle, raceStage } = page.meta;

      // race_entries 行を構築（ai_score系は更新しない）
      entriesRows.push(
        ...buildRaceEntryRows(r.race_id, page.entries, {
          extended: entriesExtended,
        }),
      );

      // 締切予定時刻（同日12レース分）が races.start_time と違うレースは、start_time を更新する（N15）
      if (syncDeadlines) {
        const plan = planDeadlineUpdates(schedule, venueCode, page.deadlines);
        for (const update of plan.updates) {
          deadlineUpdates.set(update.race_id, update);
        }
      }

      // race_conditions 行を構築（race_grade は除外、races テーブルで管理）
      // upsertは全カラムを書き込むため、判定条件にseriesDayの有無を含めると
      // 「conditions取得のみ失敗、seriesDayだけ成功」という再ポーリング時に
      // 既存の天候データをnullで上書きしてしまう。元の条件のまま変えない
      // （conditions取得はほぼ常に成功するため、seriesDay単独成功のレアケースを
      // 拾えなくても実害は小さい）
      if (conditions || raceTitle || raceStage) {
        // 気象の列（と観測時刻）は、書き込みの直前にまとめて作る（下の buildWeatherRows。展示取得と
        // 同じ規則）。気象を取得できなかったレースは、気象の列を含めず、既存の良い値を消さない
        conditionsRows.push(
          buildRaceConditionRow(r.race_id, page.meta, {
            extended: conditionsExtended,
          }),
        );
        weatherFetched.push({
          raceId: r.race_id,
          venueCode: r.venue_code,
          startTime: r.start_time,
          conditions,
        });
      }

      // race_grade を races テーブルに記録（発走60分前の更新用）
      if (raceGrade) {
        racesGradeUpdates.push({
          race_id: r.race_id,
          race_grade: raceGrade,
        });
      }

      const racerSummary = page.entries
        .map(
          (e) =>
            `${e.boat_number}号艇:${e.player_name ?? "不明"}(${e.grade ?? "??"})`,
        )
        .join(", ");
      console.log(`  ✅ ${venueName} ${r.race_no}R — ${racerSummary}`);
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // races.cancellation_status / cancellation_check_streak を更新（BOA-254 FR1）
  // entriesRowsが空（対象レース全てが中止疑い等）でも早期returnより前に書き込む
  let cancellationUpdateCount = 0;
  // dry-run では書き込まない（状態が変化するレースのみが対象で、既に変更時のみの更新）
  for (const {
    race_id,
    cancellation_status,
    cancellation_check_streak,
  } of dryRun ? [] : cancellationUpdates) {
    const { error } = await client
      .from("races")
      .update({ cancellation_status, cancellation_check_streak })
      .eq("race_id", race_id);
    if (!error) cancellationUpdateCount++;
    else
      console.error(
        `❌ races (cancellation_status) 更新エラー [${race_id}]:`,
        error.message,
      );
  }
  if (cancellationUpdateCount > 0) {
    console.log(
      `  ⚠️ races (cancellation_status): ${cancellationUpdateCount}件`,
    );
  }

  // races.start_time を、出走表の締切予定時刻に追従させる（N15）。書き込みデータが無くても、時刻の変更は反映する
  let deadlineUpdateCount = 0;
  for (const update of dryRun ? [] : deadlineUpdates.values()) {
    const { error } = await client
      .from("races")
      .update({ start_time: update.start_time })
      .eq("race_id", update.race_id);
    if (!error) deadlineUpdateCount++;
    else
      console.error(
        `❌ races (start_time) 更新エラー [${update.race_id}]:`,
        error.message,
      );
  }
  if (deadlineUpdates.size > 0) {
    console.log(
      `  ${dryRun ? "[DRY-RUN] " : ""}🕒 races.start_time: ${[...deadlineUpdates.values()].map((u) => `${u.race_id} ${u.previous}→${u.start_time.slice(0, 5)}`).join(", ")}` +
        (dryRun ? "" : `（更新${deadlineUpdateCount}件）`),
    );
  }

  if (entriesRows.length === 0) {
    console.log("\n📭 レース情報: 書き込みデータなし");
    return { updated: false, count: 0, deadlineUpdates: deadlineUpdateCount };
  }

  console.log(`\n💾 レース情報書き込み中...`);

  // 以下の3テーブルは、発走60分前ウィンドウ（±3分）に取得のたびに全行をupsertしていたが、
  // 前回と同じ値の行は書かない（WS8(b)）。取得できた件数(entriesRows.length等)は
  // 予測リフレッシュの起動条件のため、戻り値・後続処理は従来のまま変えない

  // race_entries upsert（ai_score系は書き込み対象の列に含まれないため比較にも現れない）
  // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
  await upsertChangedRows(client, "race_entries", entriesRows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "race_entries",
    dryRun,
    stampUpdatedAt: true,
    // 未適用の列は、行に含めない（上の detectPreRaceSchema）。判定後に列が無くなった場合の書き直し用
    optionalColumnGroups: PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceEntries,
  });

  // race_conditions upsert
  if (conditionsRows.length > 0) {
    // 気象の列（観測時刻を含む）は、展示取得と同じ規則で作る（BOA-358）。気象を書ける行と、
    // 書けない行（取得失敗・気象ブロックなし・発走後の観測）は、キーの組み合わせが違うため
    // 別々にupsertする（PostgRESTの一括upsertは、キーの無い行に明示的にNULLを書くため）
    const { rows: weatherRows, stats: weatherStats } = buildWeatherRows(
      weatherFetched,
      date,
      { startTimeLookup },
    );
    console.log(`  🌤️ 気象: ${formatWeatherStats(weatherStats)}`);
    const weatherByRaceId = new Map(
      weatherRows.map((row) => [row.race_id, row]),
    );
    const withWeather = [];
    const withoutWeather = [];
    for (const row of conditionsRows) {
      const weatherRow = weatherByRaceId.get(row.race_id);
      if (weatherRow) withWeather.push({ ...row, ...weatherRow });
      else withoutWeather.push(row);
    }
    // weather_observed_at 列（マイグレーション069）が未適用でも書き込めるよう、共通の書き込み関数を使う
    for (const [group, label] of [
      [withWeather, "race_conditions"],
      [withoutWeather, "race_conditions（気象なし）"],
    ]) {
      if (group.length > 0) {
        await upsertRaceConditions(client, group, {
          label,
          dryRun,
          optionalColumnGroups: PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceConditions,
        });
      }
    }
  }

  // races.race_grade を更新（Source of Truth = races テーブル）
  // 既存値の取得に失敗している場合（cancellationFetchError）は全件を従来どおり更新する
  const { toWrite: racesGradeToWrite, stats: racesGradeStats } =
    cancellationFetchError
      ? planWriteAll(racesGradeUpdates)
      : diffRows(cancellationRows || [], racesGradeUpdates, {
          keyColumns: ["race_id"],
          writeMissing: false, // racesに行が無ければUPDATEしても0件
        });
  let racesGradeUpdateCount = 0;
  if (!dryRun) {
    for (const { race_id, race_grade } of racesGradeToWrite) {
      const { error } = await client
        .from("races")
        .update({ race_grade })
        .eq("race_id", race_id);
      if (!error) racesGradeUpdateCount++;
    }
  }
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary("races.race_grade", racesGradeStats)}` +
      (dryRun ? "" : ` / 更新${racesGradeUpdateCount}件`),
  );

  return {
    updated: true,
    count: entriesRows.length,
    deadlineUpdates: deadlineUpdateCount,
  };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("📋 レース情報更新開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

export const _internal = {
  scrapeRaceMeta,
  scrapeRaceStage,
  scrapeSeriesDay,
  scrapeConditions,
  convertWindDirection,
};

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
