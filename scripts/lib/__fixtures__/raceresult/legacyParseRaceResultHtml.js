/**
 * 【凍結】旧実装（2026-09-20時点の master の scripts/daily/scrape-results.js）の結果ページの解析と行の組み立て。
 *
 * 用途は、新しい全項目パーサー（scripts/lib/raceResultParser.js）との互換の検証だけ
 * （scripts/maintenance/verify-race-result-parser.js）。本番のコードからは使わない。
 * 変えてはならない（旧実装の挙動の基準として固定している）。旧実装の既知の誤りも、そのまま残している:
 *   - 着欄を読まず、表の先頭6行を着順とする（欠場・フライング等の非完走艇が rank4〜6 に入る。BOA-362）
 *   - 払戻の「不成立 ¥100」を金額として入れる
 *   - course_1〜6 は、スタート情報の行の枠番の色分け（Numberセルの数字）を進入コースとして読むため艇番と恒等
 */
import * as cheerio from "cheerio";
import { scrapeConditions } from "../../beforeinfoWeather.js";

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

/**
 * 結果ページのHTMLを解析する（純粋関数）。着順・払戻が取れない（未公開・構造の違い）場合は null。
 * 解析中の例外は、握りつぶさずに投げる（呼び出し側が「未公開」と「解析の失敗」を区別できるように）。
 */
export function legacyParseRaceResultHtml(html) {
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
}

export function legacyBuildRaceResultRow(
  raceId,
  result,
  { resultAt = new Date().toISOString() } = {},
) {
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
  const wide1Entry = payouts.wide?.[sortedPairKey(result.rank1, result.rank2)];
  const wide2Entry = payouts.wide?.[sortedPairKey(result.rank1, result.rank3)];
  const wide3Entry = payouts.wide?.[sortedPairKey(result.rank2, result.rank3)];

  return {
    race_id: raceId,
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
    result_at: resultAt,
  };
}
