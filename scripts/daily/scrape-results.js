// Race Results Scraper
// Supabaseからレース一覧を取得し、結果をスクレイピングしてSupabaseに書き込む

import * as cheerio from "cheerio";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import {
  getTodayDateJST,
  getDateDaysAgo,
  formatDateForUrl,
  parseDateArg,
} from "../lib/dateUtils.js";
import { calculateHits, isTurnHit } from "../lib/hitCalculator.js";
import {
  getRaceSchedule,
  getRacesAfterStart,
  getRacesPastResultWindow,
} from "../lib/raceSchedule.js";
import {
  fetchKFileText,
  parseKFileText,
  parseKFileRankings,
} from "../lib/kfileParser.js";
import {
  filterUnchangedRows,
  formatSkipSummary,
  upsertChangedRows,
} from "../lib/unchangedRows.js";
import {
  buildResultWeatherRows,
  scrapeConditions,
} from "../lib/beforeinfoWeather.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";

// Generate race result page URL
function getRaceResultUrl(venueCode, raceNo, dateStr) {
  const ymd = formatDateForUrl(dateStr);
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

// Scrape course info (進入コース)
function scrapeCourseInfo($) {
  const courseInfo = {};

  // スタート情報テーブルを取得
  const startInfoTable = $(".is-w495.is-h292__3rdadd");
  if (startInfoTable.length === 0) {
    return courseInfo;
  }

  startInfoTable.find(".table1_boatImage1").each((index, el) => {
    // コース番号（1-6）
    const courseText = $(el).find(".table1_boatImage1Number").text().trim();
    const courseNum = parseInt(courseText);

    // 艇番（画像URLから抽出）
    const imgSrc = $(el).find(".table1_boatImage1Boat img").attr("src") || "";
    const boatMatch = imgSrc.match(/img_boat2_(\d)\.png/);
    const boatNum = boatMatch ? parseInt(boatMatch[1]) : null;

    if (courseNum >= 1 && courseNum <= 6 && boatNum) {
      courseInfo[`course_${courseNum}`] = boatNum;
    }
  });

  return courseInfo;
}

// Scrape start timings (各艇のST)
function scrapeStartTimings($) {
  const startTimings = [];

  // スタート情報テーブル（scrapeCourseInfoと同じテーブル）
  const startInfoTable = $(".is-w495.is-h292__3rdadd");
  if (startInfoTable.length === 0) {
    return startTimings;
  }

  startInfoTable.find(".table1_boatImage1").each((index, el) => {
    // 艇番（画像URLから抽出）
    const imgSrc = $(el).find(".table1_boatImage1Boat img").attr("src") || "";
    const boatMatch = imgSrc.match(/img_boat2_(\d)\.png/);
    const boatNum = boatMatch ? parseInt(boatMatch[1]) : null;

    if (!boatNum) return;

    // ST値を取得
    const stText = $(el).find(".table1_boatImage1Time").text().trim();

    // フライング（F）やレイトスタート（L）を判定
    const isFlying = stText.includes("F");
    const isLateStart = stText.includes("L");

    // 数値部分を抽出（例: "F.05" → 0.05, ".12" → 0.12）
    const numMatch = stText.match(/[FL]?\.?(\d+)/);
    let stValue = null;
    if (numMatch) {
      stValue = parseFloat("0." + numMatch[1]);
    }

    if (stValue !== null) {
      startTimings.push({
        boat_number: boatNum,
        start_timing: stValue,
        is_flying: isFlying,
        is_late_start: isLateStart,
      });
    }
  });

  return startTimings;
}

// Scrape winning technique (決まり手)
function scrapeWinningTechnique($) {
  let winningTechnique = null;
  // 決まり手は.is-w243テーブルに含まれる
  $(".is-w243").each((i, table) => {
    const header = $(table).find("th").first().text().trim();
    if (header === "決まり手") {
      winningTechnique = $(table).find("tbody td").first().text().trim();
    }
  });
  return winningTechnique || null;
}

// Scrape payout data
function scrapePayouts($) {
  // ⚠️ 命名注意: 既存の単勝/複勝/3連複/3連単のみDB列名と英語名が逆転している（歴史的経緯）
  //   trifecta (英語=3連単) → 実際は3連複の値を格納
  //   trio (英語=3連複)     → 実際は3連単の値を格納
  // 2026-09追加のexacta(2連単)/quinella(2連複)/wide(拡連複)は逆転を踏襲せず正しい意味で命名。
  // 各comboの値は{amount, popularity}（人気=払戻金テーブルに直接表示されている人気順位）
  const payouts = {
    win: {}, // 単勝
    place: {}, // 複勝
    trifecta: {}, // → DB: payout_trifecta（実態: 3連複の払戻金）
    trio: {}, // → DB: payout_trio（実態: 3連単の払戻金）
    exacta: {}, // 2連単
    quinella: {}, // 2連複
    wide: {}, // 拡連複（最大3コンボ）
  };

  try {
    // 払戻金テーブルをヘッダー内容（勝式/組番）で特定する。
    // 位置（.is-w495の何番目か）に依存すると、結果ページの上部セクション
    // （着順・スタート情報テーブル）が欠落する稀なケースで払戻金テーブルの
    // 位置がズレ、取得漏れになる（2026-09-09、桐生2Rで実際に発生）
    let payoutTable = null;
    $(".is-w495").each((_, table) => {
      const headerText = $(table).find("thead").first().text();
      if (headerText.includes("勝式") && headerText.includes("組番")) {
        payoutTable = $(table);
        return false;
      }
    });

    if (!payoutTable) {
      return payouts;
    }

    const TYPE_LABELS = [
      "単勝",
      "複勝",
      "3連単",
      "3連複",
      "2連単",
      "2連複",
      "拡連複",
    ];
    const TYPE_TO_KEY = {
      単勝: "win",
      複勝: "place",
      "3連複": "trifecta",
      "3連単": "trio",
      "2連単": "exacta",
      "2連複": "quinella",
      拡連複: "wide",
    };

    let currentType = "";

    const normalizeCombo = (combo) =>
      combo
        .replace(/[０-９]/g, (s) =>
          String.fromCharCode(s.charCodeAt(0) - 0xfee0),
        )
        .replace(/[→－−ー=]/g, "-")
        .replace(/\s+/g, "");

    const storeEntry = (combo, amountText, popularityText) => {
      const amount = parseInt(amountText.replace(/[^0-9]/g, ""));
      if (isNaN(amount) || amount <= 0 || !combo || !currentType) return;
      const popularity = parseInt(
        (popularityText || "").replace(/[^0-9]/g, ""),
      );
      payouts[TYPE_TO_KEY[currentType]][normalizeCombo(combo)] = {
        amount,
        popularity: !isNaN(popularity) && popularity > 0 ? popularity : null,
      };
    };

    // 型ラベル行は4セル（型名/組番/配当/人気）、継続行（複勝2口目・拡連複2〜3口目）は
    // 3セル（組番/配当/人気）。人気は複勝には表示されず空文字になる
    payoutTable.find("tbody tr").each((i, row) => {
      const cells = $(row).find("td");

      if (cells.length === 4) {
        const typeLabel = cells.eq(0).text().trim();
        if (TYPE_LABELS.includes(typeLabel)) {
          currentType = typeLabel;
        }
        storeEntry(
          cells.eq(1).text().trim(),
          cells.eq(2).text().trim(),
          cells.eq(3).text().trim(),
        );
      } else if (cells.length === 3) {
        storeEntry(
          cells.eq(0).text().trim(),
          cells.eq(1).text().trim(),
          cells.eq(2).text().trim(),
        );
      }
    });
  } catch (error) {
    console.error(`  Payout scraping error: ${error.message}`);
  }

  return payouts;
}

// Scrape race result
async function scrapeRaceResult(venueCode, raceNo, dateStr) {
  const url = getRaceResultUrl(venueCode, raceNo, dateStr);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
      },
    });

    if (!response.ok) {
      console.log(`  [HTTP ${response.status}]`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 着順テーブルをヘッダー内容（着/ボートレーサー）で特定する。
    // 位置（.is-w495の1番目）に依存すると、稀に着順テーブル自体が
    // ページに存在しないケース（払戻金テーブルのみ存在）で、無関係な
    // 払戻金テーブルを誤って着順として誤認識してしまう（2026-09-09、
    // 桐生2Rで実際に発生: 払戻金テーブルの「組番」欄先頭の数字が艇番として
    // 誤読され、全着順が同じ艇番になる不具合があった）
    let resultTable = null;
    $(".is-w495").each((_, table) => {
      const headerText = $(table).find("thead").first().text();
      if (headerText.includes("着") && headerText.includes("ボートレーサー")) {
        resultTable = table;
        return false;
      }
    });

    // 払戻金データは着順テーブルの有無に関わらず必要（着順テーブルが
    // 無い場合のフォールバック復元にも使うため先に取得する）
    const payouts = scrapePayouts($);

    let rankings = [];
    let raceTimes = [];

    if (resultTable) {
      // Get all 6 boat numbers + race times, ordered by finish position
      // （5〜6着はタイムが空欄のことがある）
      $(resultTable)
        .find("tbody tr")
        .each((index, row) => {
          if (index < 6) {
            const $row = $(row);
            const cells = $row.find("td");
            const boatNumber = parseInt(cells.eq(1).text().trim());
            if (boatNumber && !isNaN(boatNumber)) {
              rankings.push(boatNumber);
              raceTimes.push(cells.eq(3).text().trim() || null);
            }
          }
        });
    }

    // 着順に重複がある場合（テーブル誤認識時の典型症状）は無効データとして扱う
    const hasDuplicates =
      rankings.length > 0 && new Set(rankings).size !== rankings.length;

    if (!resultTable || rankings.length < 3 || hasDuplicates) {
      // 着順テーブルを取得できない場合、3連単（DB上のキー名は"trio"、
      // 命名の歴史的経緯によりねじれている）の払戻金コンボは1〜3着の
      // 艇番をそのまま表すため、それだけは復元できる
      const trifectaCombo = Object.keys(payouts.trio || {})[0];
      const trifectaBoats = trifectaCombo
        ? trifectaCombo.split("-").map((n) => parseInt(n, 10))
        : [];
      const trifectaValid =
        trifectaBoats.length === 3 &&
        trifectaBoats.every((n) => n >= 1 && n <= 6) &&
        new Set(trifectaBoats).size === 3;

      if (!trifectaValid) {
        console.log(
          hasDuplicates
            ? `  Incomplete data (duplicate boat numbers: ${rankings.join("-")})`
            : `  Incomplete data (got ${rankings.length} boats)`,
        );
        return null;
      }

      console.log(
        `  着順テーブル欠落、3連単払戻(${trifectaCombo})から上位3着を復元`,
      );
      rankings = trifectaBoats;
      raceTimes = [null, null, null];
    }

    // Get winning technique (決まり手)
    const winningTechnique = scrapeWinningTechnique($);

    // Get course info (進入コース)
    const courseInfo = scrapeCourseInfo($);

    // Get start timings (各艇のST)
    const startTimings = scrapeStartTimings($);

    return {
      rank1: rankings[0],
      rank2: rankings[1],
      rank3: rankings[2],
      rank4: rankings[3] || null,
      rank5: rankings[4] || null,
      rank6: rankings[5] || null,
      raceTime1: raceTimes[0] || null,
      raceTime2: raceTimes[1] || null,
      raceTime3: raceTimes[2] || null,
      raceTime4: raceTimes[3] || null,
      raceTime5: raceTimes[4] || null,
      raceTime6: raceTimes[5] || null,
      payouts: payouts,
      winningTechnique: winningTechnique,
      courseInfo: courseInfo,
      startTimings: startTimings,
      // レース時点の気象（水面気象情報）。beforeinfoの最終観測と一致する確定値（BOA-358）
      weather: scrapeConditions($),
    };
  } catch (error) {
    console.error(`  Scraping error: ${error.message}`);
    return null;
  }
}

/**
 * オーケストレーターから呼び出し可能な結果取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(schedule, date) {
  const startedRaces = getRacesAfterStart(schedule, 5);

  let resultSummary = { updated: false, count: 0 };
  if (startedRaces.length === 0) {
    console.log("📭 結果: 発走後5分以上経過したレースなし");
  } else {
    console.log(`🎯 結果取得: ${startedRaces.length}レース（発走後5分以上）`);

    // schedule から直接 races 情報を構築（追加 DB 呼び出し不要）
    const races = startedRaces.map((r) => ({
      race_id: r.race_id,
      venue_code: r.venue_code,
      race_number: r.race_no,
      start_time: r.start_time,
    }));

    resultSummary = await scrapeAndSaveResults(races, date);
  }

  // 発走90分超・結果未取得のレースを中止・順延「確定」として扱う（BOA-254 FR2、ADR 0040）。
  // startedRaces（5〜90分後ウィンドウ）が0件の日でも、90分を超えて見捨てられた
  // レースは別途存在しうるため、上のearly returnとは独立して必ず実行する
  await confirmOverdueCancellations(schedule);

  // 進入コース（Kファイル方式、BOA-257）を過去数日分について同期。
  // Kファイルは開催日当日の夜〜翌日に公開されるため「当日」は対象にせず、
  // 直近数日分を毎回チェックすることで取得漏れ・公開遅延を自己修復する
  await syncRecentActualCourse();

  // rank4/5/6（BOA-338、Kファイル方式）を過去数日分について同期。
  // scrapeAndSaveResults()のfinishedRaceIds判定はpayout_win等のみを見て
  // 「完了」を判定するためrank4の有無をチェックせず、一度完了判定された
  // レースは再スクレイピングされない（BOA-340）。上記と同じKファイル方式で
  // 独立して自己修復する
  await syncRecentRank456();

  return resultSummary;
}

/**
 * 進入コース（Kファイル方式、BOA-257）の同期対象日数（当日を除く直近N日）。
 * 大きくし過ぎるとKファイル未取得日も毎回ダウンロードを試みてしまうため、
 * 通常運用での取得漏れを拾える程度の小さい値にとどめる。
 */
const ACTUAL_COURSE_SYNC_LOOKBACK_DAYS = 4;

/**
 * 直近数日分について、進入コース(actual_course_1〜6)が未取得のレースが
 * あるかを確認し、あれば該当日のKファイルを取得・パースして同期する。
 */
async function syncRecentActualCourse() {
  for (let i = 1; i <= ACTUAL_COURSE_SYNC_LOOKBACK_DAYS; i++) {
    await syncActualCourseFromKFile(getDateDaysAgo(i));
  }
}

/**
 * 実進入コース同期で書き込む列（race_id は更新条件）。Kファイルのパース結果には
 * venue_code・race_numberも含まれるが race_results の列ではないため、比較・更新には含めない
 */
const ACTUAL_COURSE_COLUMNS = [1, 2, 3, 4, 5, 6].map(
  (n) => `actual_course_${n}`,
);

/**
 * 指定日について、公式成績ファイル（Kファイル）から実進入コースを取得し
 * race_results.actual_course_1〜6にマージする（BOA-257）。
 *
 * BOA-349（原因）: 「未取得レースがあるか」の判定が actual_course_1 のnull判定だったため、
 * 1号艇が欠場したレース（Kファイルの結果行が「K0」「K1」等の欠場行で、1号艇は進入コースを
 * 持たない＝actual_course_1がnullなのが正しい状態。2026-09-15 平和島3R・2026-09-16 唐津12R等）が
 * 永久に「未取得」と判定され続け、その日の全レースを毎回UPDATEしていた
 * （累計167,072回・WAL 1.3GB）。しかも race_results のUPDATEは trg_update_predictions で
 * predictions・bet_recommendations の再UPDATEも連鎖させる。パーサーの不具合ではない
 * （生のKファイルで欠場行を確認済み、verify-unchanged-rows.js で固定）。
 * 対策:
 *   (a) 既存値と同じレースはUPDATEを発行しない（変更のある行だけ書く）
 *   (b) 「未取得」の判定を「actual_course_1〜6が全てnull」に改める。欠場艇はその艇のcolumnだけが
 *       nullで、他の艇のcolumnは埋まるため、欠場を含む同期済みレースを未取得と誤判定しない
 *       （2026-09-01〜18の2,506レースで、actual_course_1がnullのレース3件は全て
 *       他の艇のcolumnが埋まっており、全columnがnullのレースは0件）
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {{dryRun?: boolean}} [options] dryRun=trueならDBへ書き込まず、書くはずの件数だけ数える
 * @returns {Promise<{updated: number, skipped: number}>} updated=書き込んだ件数（dry-runでは書くはずの件数）
 */
export async function syncActualCourseFromKFile(
  dateStr,
  { dryRun = false } = {},
) {
  // 結果確定済み（rank1あり）だが進入コースが1艇分も未取得（actual_course_1〜6が全てnull）の
  // レースが無ければ、Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）。
  // 1艇でも埋まっていれば同期済み（欠場艇のcolumnだけがnullのレースを含む。上のBOA-349参照）
  const { data: pending, error: pendingError } =
    await ACTUAL_COURSE_COLUMNS.reduce(
      (query, column) => query.is(column, null),
      supabase
        .from("race_results")
        .select("race_id")
        .gte("race_id", dateStr)
        .lt("race_id", `${dateStr}~`)
        .not("rank1", "is", null),
    ).limit(1);

  if (pendingError) {
    // actual_course_1列がまだ存在しない場合（マイグレーション未適用）もここに来る。
    // 日次パイプライン全体を止めないよう、ログのみでスキップする
    console.error(
      `  ⚠️ actual_course対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return { updated: 0, skipped: 0 };
  }
  if (!pending || pending.length === 0) {
    return { updated: 0, skipped: 0 }; // 同期済み、または対象レース無し
  }

  let text;
  try {
    text = await fetchKFileText(dateStr);
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return { updated: 0, skipped: 0 };
  }
  if (!text) {
    console.log(`  進入コース: Kファイル未公開/開催なし (${dateStr})`);
    return { updated: 0, skipped: 0 };
  }

  const parsed = parseKFileText(text, dateStr);
  if (parsed.length === 0) {
    console.log(`  進入コース: Kファイルからレースを抽出できず (${dateStr})`);
    return { updated: 0, skipped: 0 };
  }

  const rows = parsed.map((row) => ({
    race_id: row.race_id,
    ...Object.fromEntries(ACTUAL_COURSE_COLUMNS.map((c) => [c, row[c]])),
  }));
  // race_resultsに行が無いレースはUPDATEしても0件のため書かない（writeMissing: false）。
  // 既存値と同じ行（=何もUPDATEで変わらない行）もUPDATEしない
  const { toWrite, stats, fallback } = await filterUnchangedRows(
    supabase,
    "race_results",
    rows,
    { keyColumns: ["race_id"], writeMissing: false },
  );

  let updated = 0;
  if (dryRun) {
    updated = toWrite.length;
  } else {
    for (const row of toWrite) {
      const { race_id: raceId, ...columns } = row;
      const { error: updateError } = await supabase
        .from("race_results")
        .update(columns)
        .eq("race_id", raceId);
      if (updateError) {
        console.error(
          `  ⚠️ actual_course更新エラー(${raceId}): ${updateError.message}`,
        );
      } else {
        updated++;
      }
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary(`進入コース(Kファイル方式, ${dateStr})`, stats, { fallback })}` +
      ` / 更新${updated}件（Kファイル${rows.length}件中、race_results未登録${stats.missing}件）`,
  );
  return { updated, skipped: stats.unchanged };
}

/**
 * rank4/5/6（BOA-338、Kファイル方式）の同期対象日数（当日を除く直近N日）。
 * ACTUAL_COURSE_SYNC_LOOKBACK_DAYSと同じ理由で、通常運用での取得漏れを
 * 拾える程度の小さい値にとどめる。
 */
const RANK456_SYNC_LOOKBACK_DAYS = 4;

/**
 * 直近数日分について、rank1はあるがrank4が未取得のレースがあるかを確認し、
 * あれば該当日のKファイルを取得・パースして同期する（BOA-340）。
 */
async function syncRecentRank456() {
  for (let i = 1; i <= RANK456_SYNC_LOOKBACK_DAYS; i++) {
    await syncRank456FromKFile(getDateDaysAgo(i));
  }
}

/**
 * 指定日について、公式成績ファイル（Kファイル）からrank4/5/6を取得し
 * race_results.rank4〜6にマージする（BOA-340）。
 *
 * 安全策（BOA-338のバックフィルスクリプトと同じ）: Kファイルからパースした
 * 1〜3着が既存のrank1〜3と完全一致する場合のみ更新する。不一致・重複艇番
 * （パース異常の疑い）・Kファイル側に該当レースが無い場合は更新せずスキップする。
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<{updated: number}>}
 */
export async function syncRank456FromKFile(dateStr) {
  // rank1はある（結果確定済み）がrank4が未取得のレースが無ければ
  // Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）
  const { data: pending, error: pendingError } = await supabase
    .from("race_results")
    .select("race_id, rank1, rank2, rank3")
    .gte("race_id", dateStr)
    .lt("race_id", `${dateStr}~`)
    .not("rank1", "is", null)
    .is("rank4", null);

  if (pendingError) {
    console.error(
      `  ⚠️ rank456対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return { updated: 0 };
  }
  if (!pending || pending.length === 0) {
    return { updated: 0 }; // 同期済み、または対象レース無し
  }

  let text;
  try {
    text = await fetchKFileText(dateStr);
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return { updated: 0 };
  }
  if (!text) {
    console.log(`  rank456: Kファイル未公開/開催なし (${dateStr})`);
    return { updated: 0 };
  }

  const rows = parseKFileRankings(text, dateStr);
  if (rows.length === 0) {
    console.log(`  rank456: Kファイルからレースを抽出できず (${dateStr})`);
    return { updated: 0 };
  }
  const kfileByRaceId = new Map(rows.map((r) => [r.race_id, r]));

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const race of pending) {
    const k = kfileByRaceId.get(race.race_id);
    if (
      !k ||
      !k.valid ||
      k.rank1 !== race.rank1 ||
      k.rank2 !== race.rank2 ||
      k.rank3 !== race.rank3
    ) {
      skipped++;
      // BOA-338のbackfill-rank456-from-kfile.jsのmismatchDetailsと同様、
      // race_id・理由・両側の値を残す。集計件数だけでは恒常的な不一致
      // レースがあっても気づけないため（毎日スキップされ続けるだけになる）
      const reason = !k
        ? "not_in_kfile"
        : !k.valid
          ? "duplicate_boat_in_kfile"
          : "rank1_3_mismatch";
      console.log(
        `  ⚠️ rank456スキップ(${race.race_id}): ${reason}` +
          (k
            ? ` db=[${race.rank1},${race.rank2},${race.rank3}] kfile=[${k.rank1},${k.rank2},${k.rank3}]`
            : ""),
      );
      continue;
    }

    // Kファイルにも4〜6着が無いレース（3着以内しか完走していない等）は、pendingの条件
    // （rank4がnull）を永久に満たし続けるため、null→nullの空UPDATEを毎回発行してしまう
    // （BOA-349と同種）。既存値（null）と同じなら書かない
    if (k.rank4 == null && k.rank5 == null && k.rank6 == null) {
      unchanged++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("race_results")
      .update({ rank4: k.rank4, rank5: k.rank5, rank6: k.rank6 })
      .eq("race_id", race.race_id);
    if (updateError) {
      console.error(
        `  ⚠️ rank456更新エラー(${race.race_id}): ${updateError.message}`,
      );
    } else {
      updated++;
    }
  }
  console.log(
    `  ✅ rank456(Kファイル方式): ${updated}/${pending.length}件更新 (${dateStr}, スキップ${skipped}件, 変更なし${unchanged}件スキップ)`,
  );
  return { updated };
}

/**
 * 発走90分超で結果が取得できていないレースを中止・順延「確定」として扱う（BOA-254 FR2）。
 * getRacesAfterStart(schedule, 5) が対象とする5〜90分後ウィンドウを抜けた
 * レースが対象。既存の結果取得ロジック（scrapeAndSaveResults）は変更しない。
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 */
async function confirmOverdueCancellations(schedule) {
  const overdueRaces = getRacesPastResultWindow(schedule, 90);
  if (overdueRaces.length === 0) return;

  const overdueIds = overdueRaces.map((r) => r.race_id);

  const [{ data: existingResults }, { data: raceRows }] = await Promise.all([
    supabase.from("race_results").select("race_id").in("race_id", overdueIds),
    supabase
      .from("races")
      .select("race_id, cancellation_status")
      .in("race_id", overdueIds),
  ]);

  const hasResult = new Set((existingResults || []).map((r) => r.race_id));
  const alreadyConfirmed = new Set(
    (raceRows || [])
      .filter((r) => r.cancellation_status === "confirmed")
      .map((r) => r.race_id),
  );

  const toConfirm = overdueIds.filter(
    (id) => !hasResult.has(id) && !alreadyConfirmed.has(id),
  );
  if (toConfirm.length === 0) return;

  const { error } = await supabase
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in("race_id", toConfirm);
  if (error) {
    console.error(
      "❌ races (cancellation_status確定) 一括更新エラー:",
      error.message,
    );
    return;
  }
  const confirmedCount = toConfirm.length;
  if (confirmedCount > 0) {
    console.log(
      `  ⚠️ 中止・順延を確定: ${confirmedCount}件（発走90分超・結果未取得）`,
    );
  }
}

/**
 * 結果スクレイピング・DB書き込みの共通処理
 * @param {Array} races - { race_id, venue_code, race_number, start_time? }[] の配列
 *   start_time（発走予定時刻）は、結果ページの気象の観測時刻に使う。無ければ観測時刻はNULL
 * @param {string} targetDate - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function scrapeAndSaveResults(races, targetDate) {
  // 既に結果があるレースを取得
  const { data: existingResults } = await supabase
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .gte("race_id", targetDate)
    .lt("race_id", `${targetDate}~`);

  // 配当データに加え決まり手（winning_technique）も揃っているレースのみ「完了」扱いにする。
  // 決まり手・進入コース・スタートタイミング（race_start_timings）は公式サイト側で
  // 着順・払戻金より掲載が遅く（発走20〜30分後以降）、payout_winだけで判定すると
  // 3連単払戻からの着順復元フォールバック（PR#612）で早期に確定してしまい、以降
  // 再取得されないまま決まり手・STが永久にnullで残ってしまう（BOA-323）
  const finishedRaceIds = new Set(
    (existingResults || [])
      .filter((r) => r.payout_win !== null && r.winning_technique !== null)
      .map((r) => r.race_id),
  );

  console.log(
    `Fetching results for ${races.length} races (${finishedRaceIds.size} already finished)\n`,
  );

  let updatedCount = 0;
  let alreadyFinishedCount = 0;
  let notYetCount = 0;
  const newResults = [];
  const scrapeCache = new Map(); // race_id → scraped result (for start timings)
  const startTimeByRaceId = new Map(
    races.filter((r) => r.start_time).map((r) => [r.race_id, r.start_time]),
  );

  // Fetch results for each race
  for (const race of races) {
    const venueName = VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`;
    const raceInfo = `${venueName} R${race.race_number}`;
    process.stdout.write(`${raceInfo.padEnd(20)} `);

    // Skip if already finished with payout data
    if (finishedRaceIds.has(race.race_id)) {
      console.log(`Already finished`);
      alreadyFinishedCount++;
      continue;
    }

    // Scrape result
    const result = await scrapeRaceResult(
      race.venue_code,
      race.race_number,
      targetDate,
    );

    if (result) {
      console.log(
        `New result: ${result.rank1}-${result.rank2}-${result.rank3}`,
      );
      scrapeCache.set(race.race_id, result);

      const payouts = result.payouts || {};
      // combo単位で{amount, popularity}を格納しているscrapePayouts()の構造から
      // 実際の着順に対応するコンボを引き当てる
      const sortedPairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");
      const winEntry = payouts.win ? Object.values(payouts.win)[0] : null;
      const placeEntries = payouts.place ? Object.entries(payouts.place) : [];
      const place1Entry = placeEntries.find(
        ([k]) => k === String(result.rank1),
      )?.[1];
      const place2Entry = placeEntries.find(
        ([k]) => k === String(result.rank2),
      )?.[1];
      const trioEntry = payouts.trio ? Object.values(payouts.trio)[0] : null;
      const trifectaEntry = payouts.trifecta
        ? Object.values(payouts.trifecta)[0]
        : null;
      const exactaEntry = payouts.exacta?.[`${result.rank1}-${result.rank2}`];
      const quinellaEntry =
        payouts.quinella?.[sortedPairKey(result.rank1, result.rank2)];
      const wide1Entry =
        payouts.wide?.[sortedPairKey(result.rank1, result.rank2)];
      const wide2Entry =
        payouts.wide?.[sortedPairKey(result.rank1, result.rank3)];
      const wide3Entry =
        payouts.wide?.[sortedPairKey(result.rank2, result.rank3)];

      newResults.push({
        race_id: race.race_id,
        rank1: result.rank1,
        rank2: result.rank2,
        rank3: result.rank3,
        rank4: result.rank4,
        rank5: result.rank5,
        rank6: result.rank6,
        race_time_1: result.raceTime1,
        race_time_2: result.raceTime2,
        race_time_3: result.raceTime3,
        race_time_4: result.raceTime4,
        race_time_5: result.raceTime5,
        race_time_6: result.raceTime6,
        payout_win: winEntry?.amount ?? null,
        payout_place_1: place1Entry?.amount ?? null,
        payout_place_2: place2Entry?.amount ?? null,
        payout_trifecta: trifectaEntry?.amount ?? null,
        payout_trio: trioEntry?.amount ?? null,
        payout_exacta: exactaEntry?.amount ?? null,
        payout_quinella: quinellaEntry?.amount ?? null,
        payout_wide_1: wide1Entry?.amount ?? null,
        payout_wide_2: wide2Entry?.amount ?? null,
        payout_wide_3: wide3Entry?.amount ?? null,
        popularity_trifecta: trifectaEntry?.popularity ?? null,
        popularity_trio: trioEntry?.popularity ?? null,
        popularity_exacta: exactaEntry?.popularity ?? null,
        popularity_quinella: quinellaEntry?.popularity ?? null,
        popularity_wide_1: wide1Entry?.popularity ?? null,
        popularity_wide_2: wide2Entry?.popularity ?? null,
        popularity_wide_3: wide3Entry?.popularity ?? null,
        winning_technique: result.winningTechnique,
        course_1: result.courseInfo?.course_1 || null,
        course_2: result.courseInfo?.course_2 || null,
        course_3: result.courseInfo?.course_3 || null,
        course_4: result.courseInfo?.course_4 || null,
        course_5: result.courseInfo?.course_5 || null,
        course_6: result.courseInfo?.course_6 || null,
        result_at: new Date().toISOString(),
      });
      updatedCount++;
    } else {
      console.log(`Not yet finished`);
      notYetCount++;
    }

    // Wait to avoid server overload
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\nResults summary:`);
  console.log(`  - Newly fetched: ${updatedCount} races`);
  console.log(`  - Already finished: ${alreadyFinishedCount} races`);
  console.log(`  - Not yet finished: ${notYetCount} races`);

  // Supabaseに書き込み
  if (newResults.length > 0) {
    console.log(`\n📤 Supabaseに結果を書き込み中...`);

    // 決まり手・ST等が公式サイトに出るまで（発走20〜30分後以降）、着順・払戻金だけ揃った
    // レースは「完了」扱いにならず毎回再取得される（BOA-323）。その間の再取得では、
    // 前回と同じ値をupsertし直していた。race_results の書き込みは trg_update_predictions で
    // predictions・bet_recommendations の再UPDATEも連鎖させるため、変更の無い行は書かない。
    // result_at は取得時刻で毎回変わるが情報を持たないため比較から外す
    // （変更なしのレースは最初に取得できた時刻が残る）
    const { toWrite: changedResults } = await upsertChangedRows(
      supabase,
      "race_results",
      newResults,
      {
        onConflict: "race_id",
        keyColumns: ["race_id"],
        ignoreColumns: ["result_at"],
        label: "race_results",
      },
    );

    // race_start_timingsにST情報を書き込み
    const allStartTimings = [];
    for (const [raceId, scraped] of scrapeCache) {
      if (scraped.startTimings && scraped.startTimings.length > 0) {
        for (const st of scraped.startTimings) {
          allStartTimings.push({
            race_id: raceId,
            ...st,
          });
        }
      }
    }

    if (allStartTimings.length > 0) {
      // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
      await upsertChangedRows(supabase, "race_start_timings", allStartTimings, {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        label: "race_start_timings",
        stampUpdatedAt: true,
      });
    }

    // レース時点の気象（結果ページの水面気象情報）を race_conditions へ反映する（BOA-358）。
    // 発走前に取得した値（beforeinfo）より新しい確定値のため上書きする。変更のある行だけ書く。
    // 失敗しても、以降の的中判定を止めない
    try {
      const { rows: weatherRows, stats: weatherStats } = buildResultWeatherRows(
        [...scrapeCache].map(([raceId, scraped]) => ({
          raceId,
          startTime: startTimeByRaceId.get(raceId) ?? null,
          conditions: scraped.weather,
        })),
      );
      console.log(
        `🌤️ 結果ページの気象: 取得${weatherStats.fetched}レース / 解析${weatherStats.parsed}レース`,
      );
      if (weatherStats.fetched > 0 && weatherRows.length === 0) {
        console.warn(
          "⚠️ 結果ページの気象: 結果を取得したが、気象が1件も解析できなかった（公式ページの構造変更の可能性）",
        );
      }
      if (weatherRows.length > 0) {
        await upsertRaceConditions(supabase, weatherRows, {
          label: "race_conditions(結果ページの気象)",
        });
      }
    } catch (weatherError) {
      console.error(
        `❌ 結果ページの気象の更新エラー（結果は保存済み）: ${weatherError.message}`,
      );
    }

    // predictions の的中判定を更新（N+1 → 1クエリでバッチ取得）
    console.log(`\n📤 predictions の的中判定を更新中...`);
    let winHits = 0;
    let placeHits = 0;
    let trifectaHits = 0;
    let trioHits = 0;

    // 的中判定は、race_resultsが新規・変更のレースだけ行う。変更の無いレース（上と同じ理由で
    // 再取得されただけ）は前回の実行で判定済みで、trg_update_predictions も同じ判定を行うため、
    // 毎回predictionsを再UPDATEしない。判定漏れは fixMissingHitFlags が自己修復する
    const changedResultIds = new Set(changedResults.map((r) => r.race_id));
    const resultsToJudge = newResults.filter((r) =>
      changedResultIds.has(r.race_id),
    );
    const newResultIds = resultsToJudge.map((r) => r.race_id);
    const { data: allPredictions } =
      newResultIds.length === 0
        ? { data: [] } // 全レースが変更なしなら、predictionsの読み取りも不要
        : await supabase
            .from("predictions")
            .select(
              "prediction_id, model_id, top_pick, top_2nd, top_3rd, race_id, feature_contributions",
            )
            .in("race_id", newResultIds);

    // race_id ごとにグループ化
    const predsByRace = new Map();
    for (const pred of allPredictions || []) {
      if (!predsByRace.has(pred.race_id)) predsByRace.set(pred.race_id, []);
      predsByRace.get(pred.race_id).push(pred);
    }

    for (const result of resultsToJudge) {
      const predictions = predsByRace.get(result.race_id) || [];
      if (predictions.length === 0) continue;

      for (const pred of predictions) {
        // 単勝: 1着予測が的中
        const isWinHit = pred.top_pick === result.rank1;

        // 複勝: 1着予測が2着以内（ボートレースのルール）
        const isPlaceHit =
          pred.top_pick === result.rank1 || pred.top_pick === result.rank2;

        // unified（top_3rdを予想しないモデル）には3連複/3連単の的中判定を適用しない
        // （2026-08-14修正、BOA-191）。旧実装はtop_3rd=nullのままfalse判定してしまい、
        // race_history_cacheの動的集計に「unifiedモデルの3連単的中率0%」という
        // 実態と異なる偽エントリが混入していた
        const predictsTrio = pred.top_3rd != null;

        let isTrifectaHit = null;
        let isTrioHit = null;
        if (predictsTrio) {
          const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].sort(
            (a, b) => a - b,
          );
          const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
            (a, b) => a - b,
          );

          // ⚠️ 命名注意: 変数名の英語と日本語が逆転（DB列名に合わせている）
          // isTrifectaHit → 実態: 3連複的中（順不同）
          isTrifectaHit =
            predTop3[0] === resultTop3[0] &&
            predTop3[1] === resultTop3[1] &&
            predTop3[2] === resultTop3[2];

          // isTrioHit → 実態: 3連単的中（順序一致）
          isTrioHit =
            pred.top_pick === result.rank1 &&
            pred.top_2nd === result.rank2 &&
            pred.top_3rd === result.rank3;
        }

        // 複勝の配当を計算（top_pickが何着かによって異なる）
        let payoutPlace = 0;
        if (isPlaceHit) {
          if (pred.top_pick === result.rank1) {
            payoutPlace = result.payout_place_1 || 0;
          } else if (pred.top_pick === result.rank2) {
            payoutPlace = result.payout_place_2 || 0;
          }
        }

        // 展開予測的中（unifiedモデルのみ。feature_contributions.turnPrediction
        // が無い旧モデルはnullのまま＝「対象外」として区別する。ADR 0013）
        const turnPatterns =
          pred.feature_contributions?.turnPrediction?.patterns;
        const hasTurnPrediction =
          Array.isArray(turnPatterns) && turnPatterns.length > 0;
        const turnHit = hasTurnPrediction
          ? isTurnHit(turnPatterns, result.rank1)
          : null;

        const updateData = {
          is_hit_win: isWinHit,
          is_hit_place: isPlaceHit,
          is_hit_trifecta: isTrifectaHit,
          is_hit_trio: isTrioHit,
          is_hit_turn: turnHit,
          payout_win: isWinHit ? result.payout_win : 0,
          payout_place: payoutPlace,
          payout_trifecta: predictsTrio
            ? isTrifectaHit
              ? result.payout_trifecta
              : 0
            : null,
          payout_trio: predictsTrio
            ? isTrioHit
              ? result.payout_trio
              : 0
            : null,
        };

        const { error: updateError } = await supabase
          .from("predictions")
          .update(updateData)
          .eq("prediction_id", pred.prediction_id);

        if (!updateError) {
          if (isWinHit) winHits++;
          if (isPlaceHit) placeHits++;
          if (isTrifectaHit) trifectaHits++;
          if (isTrioHit) trioHits++;
        }
      }
    }

    console.log(`  ✅ 単勝的中: ${winHits}件, 複勝的中: ${placeHits}件`);
    console.log(`  ✅ 3連複的中: ${trifectaHits}件, 3連単的中: ${trioHits}件`);
  } else {
    console.log("\n📤 結果: 新規データなし");
  }

  // 欠落した的中フラグを修正（新結果の有無に関わらず毎回実行）
  // 直近10日分を対象にすることで、当日限定では拾えない過去日の
  // 一時的な書き込み失敗を後続の実行で自己修復できるようにする。
  // newResults.length > 0の時だけに限定すると、対象日の結果が既に
  // 全件scrape済みになった時点で「新規データなし」が続き、二度と
  // このチェックが走らなくなる（2026-09-06、当日分の的中フラグが
  // 132件全件NULLのまま固着していた実例で発覚）
  await fixMissingHitFlags(getDateDaysAgo(9), targetDate);

  return { updated: newResults.length > 0, count: newResults.length };
}

// Main function（スタンドアローン実行用の後方互換ラッパー）
async function scrapeResults(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Starting race result scraping: ${targetDate}`);

  const schedule = await getRaceSchedule(targetDate);
  let races;
  if (schedule.length > 0) {
    const startedRaces = getRacesAfterStart(schedule, 5);
    if (startedRaces.length === 0) {
      console.log("📭 発走後5分以上経過したレースなし");
      return;
    }
    console.log(`🎯 取得対象: ${startedRaces.length}レース（発走後5分以上）`);
    races = startedRaces.map((r) => ({
      race_id: r.race_id,
      venue_code: r.venue_code,
      race_number: r.race_no,
    }));
  } else {
    // スケジュール取得失敗時: races テーブルから全件取得（フォールバック）
    console.warn("⚠️ スケジュール取得失敗: races テーブルから全レースを対象");
    const { data: allRaces, error: racesError } = await supabase
      .from("races")
      .select("race_id, venue_code, race_number")
      .eq("race_date", targetDate)
      .order("race_id");
    if (racesError) {
      console.error("❌ レース取得エラー:", racesError.message);
      process.exit(1);
    }
    races = allRaces || [];
    if (races.length === 0) {
      console.log("⚠️ 対象レースがありません");
      return;
    }
  }

  await scrapeAndSaveResults(races, targetDate);
}

// Supabaseのデフォルトlimit(1000行)を超えるクエリを.range()でページネーションして全件取得する
async function fetchAllRange(table, select, buildQuery) {
  const results = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(
      supabase.from(table).select(select),
    ).range(from, from + pageSize - 1);
    if (error) {
      console.error(`  ❌ ${table}取得エラー:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

// 結果があるのにis_hit_winがNULLの予測を修正
// startDate〜endDate（両端含む、race_id昇順比較）の範囲で欠落を検知・修復する。
// 通常呼び出しは直近数日分の範囲を渡し、当日限定では拾えない過去日の
// 一時的な書き込み失敗（2026-09-06発覚）を後続の実行で自己修復できるようにする。
export async function fixMissingHitFlags(startDate, endDate = startDate) {
  // is_hit_winがNULLの予測を取得
  // ⚠️ Supabaseのデフォルトlimit(1000行)を超える可能性があるため.range()でページネーションする
  // （2026-09-06発覚: 日付範囲を広げた際に無ページネーションのままだったため、範囲内の件数が
  // 1000件を超えると挿入順で末尾＝直近日（当日）の結果が切り捨てられ、当日分の欠落が
  // 一切修復されないまま固着していた）
  const missingPredictions = await fetchAllRange(
    "predictions",
    "prediction_id, race_id, top_pick, top_2nd, top_3rd, feature_contributions",
    (q) =>
      q
        .gte("race_id", startDate)
        .lt("race_id", `${endDate}~`)
        .is("is_hit_win", null),
  );

  if (missingPredictions.length === 0) {
    return; // 欠落なし
  }

  console.log(
    `\n🔧 欠落した的中フラグを修正中... (${missingPredictions.length}件, ${startDate}〜${endDate})`,
  );

  // 結果データを取得（同様にページネーション）
  const results = await fetchAllRange(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio",
    (q) => q.gte("race_id", startDate).lt("race_id", `${endDate}~`),
  );

  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  let fixed = 0;
  for (const pred of missingPredictions) {
    const result = resultsMap.get(pred.race_id);
    if (!result || !result.rank1) continue;

    const isWinHit = pred.top_pick === result.rank1;
    const isPlaceHit =
      pred.top_pick === result.rank1 || pred.top_pick === result.rank2;

    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].sort(
      (a, b) => a - b,
    );
    const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
      (a, b) => a - b,
    );
    const isTrifectaHit =
      predTop3[0] === resultTop3[0] &&
      predTop3[1] === resultTop3[1] &&
      predTop3[2] === resultTop3[2];
    const isTrioHit =
      pred.top_pick === result.rank1 &&
      pred.top_2nd === result.rank2 &&
      pred.top_3rd === result.rank3;

    let payoutPlace = 0;
    if (isPlaceHit) {
      if (pred.top_pick === result.rank1) {
        payoutPlace = result.payout_place_1 || 0;
      } else if (pred.top_pick === result.rank2) {
        payoutPlace = result.payout_place_2 || 0;
      }
    }

    // 展開予測的中（unifiedモデルのみ。ADR 0013）
    const turnPatterns = pred.feature_contributions?.turnPrediction?.patterns;
    const hasTurnPrediction =
      Array.isArray(turnPatterns) && turnPatterns.length > 0;
    const turnHit = hasTurnPrediction
      ? isTurnHit(turnPatterns, result.rank1)
      : null;

    const { error: updateError } = await supabase
      .from("predictions")
      .update({
        is_hit_win: isWinHit,
        is_hit_place: isPlaceHit,
        is_hit_trifecta: isTrifectaHit,
        is_hit_trio: isTrioHit,
        is_hit_turn: turnHit,
        payout_win: isWinHit ? result.payout_win : 0,
        payout_place: payoutPlace,
        payout_trifecta: isTrifectaHit ? result.payout_trifecta : 0,
        payout_trio: isTrioHit ? result.payout_trio : 0,
      })
      .eq("prediction_id", pred.prediction_id);

    if (!updateError) fixed++;
  }

  if (fixed > 0) {
    console.log(`  ✅ ${fixed}件の欠落フラグを修正`);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const targetDate = parseDateArg();
  scrapeResults(targetDate);
}
