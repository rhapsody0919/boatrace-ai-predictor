/**
 * 展示データ専用軽量スクレイピングスクリプト
 *
 * beforeinfo ページから展示タイム・展示STのみを取得し、
 * Supabase exhibition_data テーブルに直接 upsert する。
 * data/races.json には一切触れない。
 *
 * 実行時間: 約3-4分（取得済みレースはスキップ）
 */

import * as cheerio from "cheerio";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { toIntOrNull } from "../lib/venueMotorStats/parserUtils.js";
import {
  buildStartTimeLookup,
  buildWeatherRows,
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

/**
 * ST表記（".07"/"F.10"/"L.05"等）を数値に変換する。フライング・出遅れ接頭辞は
 * 値の抽出には無関係だが、フライング有無の判定に使う
 */
function parseStartTimingText(text) {
  if (!text) return { value: null, isFlying: false };
  const isFlying = text.includes("F");
  const numMatch = text.match(/[FL]?\.(\d+)/);
  const value = numMatch ? parseFloat("0." + numMatch[1]) : null;
  return { value, isFlying };
}

/**
 * Supabase から「展示タイムが取得済み」の race_id セットを取得
 *
 * 行が存在するかではなく exhibition_time が非nullの行があるかで判定する。
 * 鳴門・丸亀・児島・江戸川等では公式ページが展示ST（スタート展示）を展示タイムより
 * 先に公開するため、その間に取得すると exhibition_time=null・start_timing のみの行が
 * 書かれる。行の有無で判定すると、この行が「取得済み」とみなされ展示タイムが
 * 永久に補完されない（2026-09-19判明、9/18は29レース＝16%が該当）。
 *
 * exhibition_data は1レース6行のため、1日180レースで1000行のデフォルト上限を超える。
 * fetchAll でページネーションして取りこぼしを防ぐ。
 */
export async function getRaceIdsWithExhibitionTime(date) {
  if (!isSupabaseEnabled()) return new Set();

  const rows = await fetchAll("exhibition_data", "race_id", (q) =>
    q
      .gte("race_id", date)
      .lt("race_id", `${date}~`)
      .not("exhibition_time", "is", null)
      .order("race_id")
      .order("boat_number"),
  );

  return new Set(rows.map((r) => r.race_id));
}

/**
 * beforeinfo ページから展示データをスクレイピング
 * @returns {{ data: Array|null, reason: string|null }}
 *   reason: 'tables_lt_2' | 'no_boats' | 'no_values' | null(成功)
 */
export function scrapeExhibitionData($) {
  const exhibitionData = [];
  const tables = $(".table1");
  if (tables.length < 2) {
    return { data: null, reason: `tables_lt_2 (found ${tables.length})` };
  }

  // 展示タイム・チルト・プロペラ交換・部品交換・調整重量（table[1]の各tbody、BOA-221で拡張）
  // 当日体重・前走成績（BOA-289で追加）
  // 1艇あたりtbody内は4行（tr）構成: 1行目=枠/写真/選手名/体重/展示タイム/チルト/プロペラ/
  // 部品交換/前走成績R(ラベル)/前走成績レース番号、2行目=進入コース(前走時)、
  // 3行目=調整重量(1列目)/ST(2列目はラベル)/STタイム(前走時)、
  // 4行目=着順(前走時、raceresultへのリンク付き)。
  // 調整重量は1行目ではなく3行目の1列目にある（2026-09-14実データで確認、戸田・常滑）。
  // 当日体重は1行目td[3]、前走成績は1行目td[9](レース番号)+2行目td[1](進入コース)+
  // 3行目td[2](ST)+4行目td[1](着順)の4箇所に分散している（2026-09-14実データで確認、下関）。
  // 今節初戦の艇は前走が存在せずセルが空になる
  const exTable = tables.eq(1);
  const tbodies = exTable.find("tbody");

  tbodies.each((i, tbody) => {
    if (i >= 6) return;
    const rows = $(tbody).find("tr");
    if (rows.length < 1) return;

    const mainCells = rows.eq(0).find("td");
    const boatNumber = parseInt(mainCells.eq(0).text().trim());
    const todayWeight = parseFloat(mainCells.eq(3).text().trim());
    const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());
    const tilt = parseFloat(mainCells.eq(5).text().trim());
    const propellerText = mainCells.eq(6).text().trim();
    const partsChanged = mainCells
      .eq(7)
      .find("li")
      .map((_, li) => $(li).text().trim())
      .get()
      .filter(Boolean);
    const prevRaceNo = parseInt(mainCells.eq(9).text().trim());
    const adjustmentWeight = parseFloat(
      rows.eq(2).find("td").eq(0).text().trim(),
    );
    // rows.eq(N)は範囲外でも空コレクションを返す（cheerioの挙動、adjustmentWeightと
    // 同じ前提）ため、rows.lengthによるガードは不要（PR #645セルフレビューで削除）
    const prevEntryCourse = parseInt(rows.eq(1).find("td").eq(1).text().trim());
    const prevStartTimingText = rows.eq(2).find("td").eq(2).text().trim();
    const { value: prevStartTiming } =
      parseStartTimingText(prevStartTimingText);
    const prevFinishRankText = rows.eq(3).find("td").eq(1).text().trim();
    const prevFinishRank = toIntOrNull(prevFinishRankText);

    if (boatNumber >= 1 && boatNumber <= 6) {
      exhibitionData.push({
        boatNumber,
        exhibitionTime:
          !isNaN(exhibitionTime) && exhibitionTime > 0 ? exhibitionTime : null,
        startTiming: null,
        tilt: !isNaN(tilt) ? tilt : null,
        propellerChange: propellerText || null,
        partsChanged: partsChanged.length > 0 ? partsChanged : null,
        adjustmentWeight: !isNaN(adjustmentWeight) ? adjustmentWeight : null,
        todayWeight:
          !isNaN(todayWeight) && todayWeight > 0 ? todayWeight : null,
        prevRaceNo: !isNaN(prevRaceNo) ? prevRaceNo : null,
        prevEntryCourse: !isNaN(prevEntryCourse) ? prevEntryCourse : null,
        prevStartTiming,
        prevFinishRank,
      });
    }
  });

  if (exhibitionData.length === 0) {
    return { data: null, reason: `no_boats (tbodies=${tbodies.length})` };
  }

  // 展示ST（table[2]）
  if (tables.length >= 3) {
    const startTable = tables.eq(2);
    startTable.find(".table1_boatImage1").each((i, el) => {
      const boatText =
        $(el).find(".table1_boatImage1Number").text().trim() ||
        $(el).text().trim().split("\n")[0].trim();
      const boatNum = parseInt(boatText);

      const stText = $(el).find(".table1_boatImage1Time").text().trim();
      const { value: stValue, isFlying } = parseStartTimingText(stText);

      if (boatNum >= 1 && boatNum <= 6 && stValue !== null) {
        const entry = exhibitionData.find((e) => e.boatNumber === boatNum);
        if (entry) {
          entry.startTiming = stValue;
          entry.isFlying = isFlying;
        }
      }
    });
  }

  const hasData = exhibitionData.some(
    (e) => e.exhibitionTime !== null || e.startTiming !== null,
  );
  if (!hasData) {
    return { data: null, reason: `no_values (boats=${exhibitionData.length})` };
  }
  return { data: exhibitionData, reason: null };
}

// scripts/lib/supabaseClient.js の FETCH_TIMEOUT_MSと同じ値。
// 2026-08-13判明のNode.js標準fetch（undici）無期限ハング不具合と同種のリスクが
// boatrace.jpへのこのfetchにもあるため、PR #639セルフレビューで追加。
const FETCH_TIMEOUT_MS = 15000;

/**
 * 1レースの展示データと気象を取得する（同じ beforeinfo ページから両方を解析する。BOA-358）
 * @returns {{ data: Array|null, reason: string|null, conditions: Object|null }}
 *   conditions: 水面気象情報の解析結果（ページを取得できなかった場合は null）。
 *   展示データが未公開（data が null）でも、気象は解析する
 */
async function fetchExhibitionForRace(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        data: null,
        reason: `http_${response.status}`,
        conditions: null,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const exhibition = scrapeExhibitionData($);
    // 気象の解析失敗は、展示データの取得・保存を妨げない（気象だけ null にする）
    let conditions = null;
    try {
      conditions = scrapeConditions($);
    } catch (weatherError) {
      console.error(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R: 気象の解析エラー: ${weatherError.message}`,
      );
    }
    return { ...exhibition, conditions };
  } catch (error) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R: ${error.message}`,
    );
    return { data: null, reason: `error: ${error.message}`, conditions: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * オーケストレーターから呼び出し可能な展示データ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean}} [options]
 *   updateWeather: 取得した beforeinfo の気象も race_conditions へ反映するか（既定 true、BOA-358）。
 *   過去レースの補完（scrape-exhibition-data の backfill 系）は、beforeinfo が「その日の最新の観測」
 *   を表示するため false にする
 * @returns {Promise<{updated: boolean, count: number, weather?: Object}>}
 */
/**
 * 展示データ取得のウィンドウ（BOA-55: 発走30分前・15分前・10分前）
 * 展示タイム取得済みのレースはスキップするため広めに取っても二重取得なし。
 */
const EXHIBITION_WINDOWS = [30, 15, 10];

export async function run(schedule, date, { updateWeather = true } = {}) {
  // BOA-55: 30分前（初回取得）・15分前・10分前（未取得時リトライ）のウィンドウをカバー
  const exhibitionTargetMap = new Map();
  for (const w of EXHIBITION_WINDOWS) {
    for (const r of getRacesInWindow(schedule, w, 3)) {
      exhibitionTargetMap.set(r.race_id, r);
    }
  }
  const windowRaces = [...exhibitionTargetMap.values()];

  if (windowRaces.length === 0) {
    console.log("📭 展示: 発走10〜33分前ウィンドウの対象レースなし");
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 展示データ取得: ${windowRaces.length}レース（発走30/15/10分前ウィンドウ）`,
  );

  // 展示タイム取得済みの race_id（スキップ判定用）。展示タイム未公開のnull行は
  // 取得済み扱いにせず、次回のcron実行で再取得・上書きする
  const fetchedRaceIds = await getRaceIdsWithExhibitionTime(date);
  const targets = windowRaces.filter((r) => !fetchedRaceIds.has(r.race_id));

  if (targets.length === 0) {
    console.log("📭 展示: 全レース取得済み（スキップ）");
    return { updated: false, count: 0 };
  }

  return scrapeAndUpsertRaces(targets, date, {
    updateWeather,
    // 「N R時点」の気象の観測時刻（Nレース目の発走予定時刻）の解決用
    startTimeLookup: buildStartTimeLookup(schedule),
  });
}

/**
 * 指定レースの展示データを取得して exhibition_data に upsert する
 * （取得済み判定・ウィンドウ判定は呼び出し側の責務。過去分の補完スクリプトからも使う）
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time?: Date}>} targets
 *   start_time: 発走予定時刻。気象の更新（updateWeather）では、発走後の観測を弾くために使う
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean, startTimeLookup?: Function|null}} [options]
 *   updateWeather: 気象も race_conditions へ反映するか。既定 false（過去分の補完は、beforeinfo が
 *   発走後もその日の最新の観測を表示するため、気象を書かない）。run() は既定 true で呼ぶ
 *   startTimeLookup: buildStartTimeLookup() の戻り値（「N R時点」の観測時刻の解決用）
 * @returns {Promise<{updated: boolean, count: number, weather: Object|null}>}
 */
export async function scrapeAndUpsertRaces(
  targets,
  date,
  { updateWeather = false, startTimeLookup = null } = {},
) {
  // 会場ごとにグループ化
  const byVenue = new Map();
  for (const r of targets) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  let totalFetched = 0;
  const allRows = [];
  // 気象の反映対象（レースごとの解析結果）。展示データが未公開でも、ページを取得できたレースは対象
  const weatherFetched = [];

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全対象レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchExhibitionForRace(date, venueCode, r.race_no).then(
          ({ data, reason, conditions }) => ({
            raceId: r.race_id,
            startTime: r.start_time ?? null,
            data,
            reason,
            conditions,
          }),
        ),
      ),
    );

    let venueFetched = 0;
    for (const { raceId, startTime, data, reason, conditions } of results) {
      const raceNo = raceId.split("-")[4];
      if (conditions) {
        weatherFetched.push({ raceId, venueCode, startTime, conditions });
      }
      if (data) {
        for (const ex of data) {
          if (ex.exhibitionTime != null || ex.startTiming != null) {
            allRows.push({
              race_id: raceId,
              boat_number: ex.boatNumber,
              exhibition_time: ex.exhibitionTime,
              start_timing: ex.startTiming,
              tilt: ex.tilt,
              propeller_change: ex.propellerChange,
              parts_changed: ex.partsChanged,
              adjustment_weight: ex.adjustmentWeight,
              today_weight: ex.todayWeight,
              prev_race_no: ex.prevRaceNo,
              prev_entry_course: ex.prevEntryCourse,
              prev_start_timing: ex.prevStartTiming,
              prev_finish_rank: ex.prevFinishRank,
            });
          }
        }
        venueFetched++;
      } else {
        console.log(
          `  ⚠️ ${venueName} ${parseInt(raceNo)}R: データなし (${reason})`,
        );
      }
    }

    if (venueFetched > 0) {
      console.log(`  ✅ ${venueName}: ${venueFetched}R 取得`);
    }
    totalFetched += venueFetched;

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Supabase に upsert
  if (allRows.length > 0) {
    console.log(`\n💾 exhibition_data: ${allRows.length}件書き込み中...`);

    // BOA-221の新列（マイグレーション056）とBOA-289の新列（マイグレーション059）は
    // 別々のマイグレーションのため、片方だけ未適用というケースがありうる（本プロジェクトは
    // Supabase Access Tokenの失効等でマイグレーションを手動・個別に適用してきた実績があり、
    // 054適用済み・056未適用のような部分適用状態は現実的に起こりうる）。1つの列不在エラーで
    // 両方の新列を一律に剥がすと、056が既に適用済みで正常に書き込めていたtilt等まで
    // 巻き添えで書き込み停止してしまう（PR #645セルフレビューで発見）。
    // full→boa221（BOA-289分のみ剥がす）→legacy（両方剥がす）の2段階でフォールバックし、
    // 適用済みのマイグレーション分は引き続き書き込み続ける
    const BOA221_COLUMNS = [
      "tilt",
      "propeller_change",
      "parts_changed",
      "adjustment_weight",
    ];
    const BOA289_COLUMNS = [
      "today_weight",
      "prev_race_no",
      "prev_entry_course",
      "prev_start_timing",
      "prev_finish_rank",
    ];
    const stripColumns = (batch, columns) =>
      batch.map((row) => {
        const stripped = { ...row };
        columns.forEach((col) => delete stripped[col]);
        return stripped;
      });
    const payloadForTier = (batch, tier) => {
      if (tier === "full") return batch;
      if (tier === "boa221") return stripColumns(batch, BOA289_COLUMNS);
      return stripColumns(batch, [...BOA221_COLUMNS, ...BOA289_COLUMNS]);
    };
    const isColumnMissingError = (error) =>
      !!error && /column .* does not exist/i.test(error.message);

    // 一度ダウングレードしたtierは以降のバッチにも引き継ぐ（同じエラーへの
    // リトライを毎バッチ繰り返さない）
    let tier = "full";
    for (let i = 0; i < allRows.length; i += 1000) {
      const batch = allRows.slice(i, i + 1000);
      let { error } = await supabase
        .from("exhibition_data")
        .upsert(payloadForTier(batch, tier), {
          onConflict: "race_id,boat_number",
        });

      while (isColumnMissingError(error) && tier !== "legacy") {
        const nextTier = tier === "full" ? "boa221" : "legacy";
        console.warn(
          `⚠️ exhibition_data: 新列が未適用のため${nextTier === "boa221" ? "BOA-289分（マイグレーション059）" : "BOA-221・BOA-289分（マイグレーション056・059）"}の新列を除いてリトライします: ${error.message}`,
        );
        tier = nextTier;
        ({ error } = await supabase
          .from("exhibition_data")
          .upsert(payloadForTier(batch, tier), {
            onConflict: "race_id,boat_number",
          }));
      }

      if (error) {
        console.error(`❌ exhibition_data 書き込みエラー:`, error.message);
      }
    }

    console.log(`✅ exhibition_data: ${allRows.length}件完了`);
  } else {
    console.log("\n📭 展示: 新規データなし");
  }

  console.log(`📊 展示: 取得${totalFetched}R / データ${allRows.length}件`);

  // 気象の反映（BOA-358）。展示データの保存が済んだ後に行い、失敗しても展示の成否・戻り値
  // （予測リフレッシュの起動条件）には影響させない
  const weather = updateWeather
    ? await updateRaceConditionsWeather(weatherFetched, date, {
        startTimeLookup,
      })
    : null;

  return { updated: allRows.length > 0, count: allRows.length, weather };
}

/**
 * beforeinfo から取得した気象を race_conditions へ反映する（変更のある行だけ書く）。
 * 例外・書き込み失敗は投げず、結果に error として返す（展示データの取得・保存と分離するため）。
 * 気象が1件も反映できなかった場合は、理由の内訳を警告として出す（0件を成功扱いにしない）。
 *
 * @param {Array<{raceId: string, venueCode: number, startTime: Date|null, conditions: Object|null}>} fetched
 * @param {string} date YYYY-MM-DD
 * @param {{startTimeLookup?: Function|null}} [options]
 * @returns {Promise<{fetched: number, parsed: number, written: number, error: string|null}>}
 */
export async function updateRaceConditionsWeather(
  fetched,
  date,
  { startTimeLookup = null } = {},
) {
  try {
    const { rows, stats } = buildWeatherRows(fetched, date, {
      startTimeLookup,
    });
    console.log(`🌤️ 気象: ${formatWeatherStats(stats)}`);
    if (stats.fetched > 0 && rows.length === 0) {
      console.warn(
        "⚠️ 気象: ページを取得したが、反映できる気象が1件も無かった（公式ページの構造変更・観測時刻の書式変更の可能性）",
      );
    }
    if (rows.length === 0) {
      return { fetched: stats.fetched, parsed: 0, written: 0, error: null };
    }
    const result = await upsertRaceConditions(supabase, rows, {
      label: "race_conditions(気象)",
    });
    return {
      fetched: stats.fetched,
      parsed: stats.parsed,
      written: result.written,
      error: result.error ? result.error.message : null,
    };
  } catch (error) {
    console.error(
      `❌ 気象の更新エラー（展示データは保存済み）: ${error.message}`,
    );
    return {
      fetched: fetched.length,
      parsed: 0,
      written: 0,
      error: error.message,
    };
  }
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🚀 展示データ専用スクレイピング開始");
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

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
