/**
 * レース前オッズ取得スクリプト
 *
 * 発走60/30/15/10/5分前のウィンドウで単勝・複勝・3連単オッズを取得し、
 * Supabase race_odds テーブルに upsert する。単勝・複勝オッズは同一ページ
 * （oddstf）に掲載されており、.oddsPoint の7〜12番目が複勝オッズ
 * （下限-上限のレンジ形式）（2026-08-14追加）。
 *
 * scrape-scheduled.yml から5分毎に実行される。
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
import {
  parseTrifectaAll,
  parseTrioAll,
  parseExactaAll,
  parseQuinellaAll,
  parseWideAll,
  parseRangeOddsValue,
} from "../lib/oddsParser.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// 全通り系（jsonb）列。ADR-0054/0057
const FULL_ODDS_KEYS = [
  "trifecta_all",
  "trio_all",
  "exacta_all",
  "quinella_all",
  "wide_all",
];

// 発走前の取得ウィンドウ（分）: 各ウィンドウで ±3分
// 0分（締切時点）はADR-0057で追加。オーケストレーターでも参照するため export
export const ODDS_WINDOWS = [60, 30, 15, 10, 5, 0];

// 全通り（3連単/3連複/2連単/2連複/拡連複）を捕捉するウィンドウ。
// ADR-0057により全窓を対象に拡大（旧: 発走直前の1窓のみ）
export const FULL_ODDS_WINDOWS = ODDS_WINDOWS;

/**
 * 結果取得済みレースの race_id セットを取得（スキップ判定用）
 */
async function getFinishedRaceIds(date) {
  if (!isSupabaseEnabled()) return new Set();
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id")
    .gte("race_id", date)
    .lt("race_id", `${date}~`)
    .not("payout_win", "is", null);
  if (error) {
    console.error("⚠️ 結果済みレースの確認に失敗:", error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.race_id));
}

/**
 * 単勝オッズページをスクレイプ
 * セレクタ: .oddsPoint（艇1〜6の順）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @returns {Array<number|null>} 艇1〜6の単勝オッズ（取得失敗は null）
 */
function scrapeWinOdds($) {
  const winOdds = [];
  $(".oddsPoint").each((i, el) => {
    if (i >= 6) return false;
    const text = $(el).text().trim();
    const val = parseFloat(text);
    // 0 以下は未公開・無効値として null に変換（有効な単勝オッズは必ず 1.0 以上）
    winOdds.push(!isNaN(val) && val > 0 ? val : null);
  });
  return winOdds;
}

/**
 * 複勝オッズをスクレイプ（単勝オッズと同一ページ内、.oddsPointの7〜12番目）
 * 複勝オッズは「下限-上限」のレンジ表示（例: "3.9-4.6"）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス（scrapeWinOddsと同じページ）
 * @returns {Array<{low: number, high: number}|null>} 艇1〜6の複勝オッズ（取得失敗はnull）
 */
function scrapePlaceOdds($) {
  const placeOdds = [];
  $(".oddsPoint").each((i, el) => {
    if (i < 6 || i >= 12) return;
    // 2026-08-14修正（BOA-186）: 全角ハイフンを正規化する。未対応だとsplit("-")が
    // 1要素になり、high=lowにフォールバックして「幅ゼロの点オッズ」が有効値として
    // 黙って保存されてしまう（nullと区別できない）。parseRangeOddsValueに集約済み
    placeOdds.push(parseRangeOddsValue($(el).text().trim()));
  });
  return placeOdds;
}

/**
 * 3連単人気上位3つをスクレイプ
 * セレクタ: .is-p3-0 tbody tr（上位3行）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @returns {Array<{combination: string|null, odds: number|null}>}
 */
function scrapeTrifectaOdds($) {
  const trifecta = [];
  $(".is-p3-0 tbody tr")
    .slice(0, 3)
    .each((i, row) => {
      const cells = $(row).find("td");
      const raw = $(cells[0]).text().trim();
      // "1-2-3" 形式に正規化（全角ハイフン・スペース等を半角に）
      const combination =
        raw.replace(/[－ー−]/g, "-").replace(/\s+/g, "") || null;
      const oddsText = $(cells[cells.length - 1])
        .text()
        .trim();
      const odds = parseFloat(oddsText);
      trifecta.push({
        combination,
        odds: isNaN(odds) ? null : odds,
      });
    });
  return trifecta;
}

/**
 * 全通り捕捉対象（3連複・2連単・2連複・拡連複）のページを取得し、
 * それぞれのMapをプレーンオブジェクトに変換して返す（ADR-0057、FR-4）
 *
 * @param {string} date - YYYY-MM-DD
 * @param {number} venueCode
 * @param {number} raceNo
 * @returns {Promise<{trioAll: Object|null, exactaAll: Object|null, quinellaAll: Object|null, wideAll: Object|null}>}
 */
async function fetchFullOddsCombinations(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const trioUrl = `https://www.boatrace.jp/owpc/pc/race/odds3f?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const tfUrl = `https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const wideUrl = `https://www.boatrace.jp/owpc/pc/race/oddsk?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  const result = {
    trioAll: null,
    exactaAll: null,
    quinellaAll: null,
    wideAll: null,
  };

  // この関数はfetchOddsForRace内で単勝・3連単の取得成功後に呼ばれる。
  // ここで例外を外側へ伝播させると、既に取得済みの基本オッズまで含めて
  // レース全体がnull扱いになってしまうため、失敗はこの関数内で握りつぶし
  // resultを空のまま返す（基本オッズの取得成功には影響させない）
  try {
    const [trioRes, tfRes, wideRes] = await Promise.all([
      fetch(trioUrl, { headers: FETCH_HEADERS }),
      fetch(tfUrl, { headers: FETCH_HEADERS }),
      fetch(wideUrl, { headers: FETCH_HEADERS }),
    ]);

    if (trioRes.ok) {
      const map = parseTrioAll(cheerio.load(await trioRes.text()));
      if (map.size > 0) result.trioAll = Object.fromEntries(map);
    }
    if (tfRes.ok) {
      const $tf = cheerio.load(await tfRes.text());
      const exactaMap = parseExactaAll($tf);
      const quinellaMap = parseQuinellaAll($tf);
      if (exactaMap.size > 0) result.exactaAll = Object.fromEntries(exactaMap);
      if (quinellaMap.size > 0)
        result.quinellaAll = Object.fromEntries(quinellaMap);
    }
    if (wideRes.ok) {
      const map = parseWideAll(cheerio.load(await wideRes.text()));
      if (map.size > 0) result.wideAll = Object.fromEntries(map);
    }
  } catch (err) {
    console.error(
      `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 全通り系オッズ取得エラー（基本オッズには影響なし）: ${err.message}`,
    );
  }

  return result;
}

/**
 * 1レースの単勝・3連単オッズを取得
 *
 * @param {string} date - YYYY-MM-DD
 * @param {number} venueCode - 会場コード (1-24)
 * @param {number} raceNo - レース番号 (1-12)
 * @param {boolean} wantFull - true なら3連単・3連複・2連単・2連複・拡連複の全通りもパースして返す（ADR-0057）
 * @returns {Promise<{winOdds: Array, trifecta: Array, trifectaAll: Object|null, trioAll: Object|null, exactaAll: Object|null, quinellaAll: Object|null, wideAll: Object|null}|null>}
 */
async function fetchOddsForRace(date, venueCode, raceNo, wantFull = false) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const winUrl = `https://www.boatrace.jp/owpc/pc/race/oddstf?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const trifUrl = `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  try {
    const [winRes, trifRes] = await Promise.all([
      fetch(winUrl, { headers: FETCH_HEADERS }),
      fetch(trifUrl, { headers: FETCH_HEADERS }),
    ]);

    if (!winRes.ok) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 単勝オッズ取得失敗 HTTP ${winRes.status}`,
      );
      return null;
    }

    const $win = cheerio.load(await winRes.text());
    const winOdds = scrapeWinOdds($win);
    const placeOdds = scrapePlaceOdds($win);

    let trifecta = [];
    let trifectaAll = null;
    if (trifRes.ok) {
      const $trif = cheerio.load(await trifRes.text());
      trifecta = scrapeTrifectaOdds($trif);
      // 全通り捕捉ウィンドウ: 120通りをパース（EV分析用・BOA-104）
      if (wantFull) {
        const fullMap = parseTrifectaAll($trif);
        if (fullMap.size > 0) trifectaAll = Object.fromEntries(fullMap);
      }
    }

    // 有効な単勝オッズが1件もなければ null
    if (!winOdds.some((o) => o !== null)) return null;

    let trioAll = null;
    let exactaAll = null;
    let quinellaAll = null;
    let wideAll = null;
    if (wantFull) {
      ({ trioAll, exactaAll, quinellaAll, wideAll } =
        await fetchFullOddsCombinations(date, venueCode, raceNo));
    }

    return {
      winOdds,
      placeOdds,
      trifecta,
      trifectaAll,
      trioAll,
      exactaAll,
      quinellaAll,
      wideAll,
    };
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R オッズ取得エラー: ${err.message}`,
    );
    return null;
  }
}

// フォールバックとして許容する最古のスナップショット年齢（分）。ODDS_WINDOWSの
// 最大値（60分前）に運用上のマージンを加えた値。レース延期等で発走が大幅に
// ずれた場合、何時間も前のスナップショットを「実質最終値」として扱うのは
// 締切間際の市場変動を無視することになり危険なため、上限を設ける
const MAX_FALLBACK_AGE_MINUTES = 75;

/**
 * 0分窓（締切時点）で全通り系の一部が欠けた場合、直近の成功スナップショットから
 * 該当列を補完する（ADR-0057のフォールバック設計）。取得できなかった券種を
 * エラーとして握りつぶさず、直前の値を実質的な最終値として扱う。ただし
 * MAX_FALLBACK_AGE_MINUTESより古いスナップショットは採用しない
 *
 * @param {string} raceId
 * @param {Object} row - 今回のスナップショット行（欠けている全通り系キーは未設定）
 * @returns {Promise<Object>} 補完できた列のみを持つオブジェクト
 */
async function fillMissingFullOddsFromLatestSnapshot(raceId, row) {
  const missingKeys = FULL_ODDS_KEYS.filter((k) => !(k in row));
  if (missingKeys.length === 0) return {};

  const { data, error } = await supabase
    .from("race_odds")
    .select(`captured_at, ${missingKeys.join(", ")}`)
    .eq("race_id", raceId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `⚠️ race_odds全通り系フォールバック取得エラー [${raceId}]:`,
      error.message,
    );
    return {};
  }
  if (!data) return {};

  const ageMinutes =
    (Date.now() - new Date(data.captured_at).getTime()) / 60000;
  if (ageMinutes > MAX_FALLBACK_AGE_MINUTES) return {};

  const fallback = {};
  for (const key of missingKeys) {
    if (data[key]) fallback[key] = data[key];
  }
  return fallback;
}

/**
 * オーケストレーターから呼び出し可能なオッズ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(schedule, date) {
  // 結果取得済みレースはスキップ
  const finishedIds = await getFinishedRaceIds(date);

  // 各ウィンドウで対象レースを収集（重複なし）
  const targetRaces = new Map();
  for (const minutes of ODDS_WINDOWS) {
    const inWindow = getRacesInWindow(schedule, minutes);
    for (const r of inWindow) {
      if (!finishedIds.has(r.race_id) && !targetRaces.has(r.race_id)) {
        targetRaces.set(r.race_id, r);
      }
    }
  }

  // 全窓（60/30/15/10/5/0分前）で全券種の全通りを保存する（ADR-0057）
  const fullOddsIds = new Set();
  for (const minutes of FULL_ODDS_WINDOWS) {
    getRacesInWindow(schedule, minutes).forEach((r) =>
      fullOddsIds.add(r.race_id),
    );
  }

  if (targetRaces.size === 0) {
    console.log("📭 オッズ: 取得対象レースなし（全ウィンドウ外）");
    return { updated: false, count: 0 };
  }

  // 0分（締切時点）ウィンドウのレースID（フォールバック対象の判定用、ADR-0057）
  const cutoffWindowIds = new Set(
    getRacesInWindow(schedule, 0).map((r) => r.race_id),
  );

  console.log(
    `🎯 オッズ取得: ${targetRaces.size}レース (${ODDS_WINDOWS.map((m) => `${m}分前`).join("/")} ウィンドウ)`,
  );

  // 会場ごとにグループ化して並列取得
  const capturedAt = new Date().toISOString();
  const baseRows = [];
  const fullOddsRows = [];

  const byVenue = new Map();
  for (const r of targetRaces.values()) {
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
        fetchOddsForRace(
          date,
          r.venue_code,
          r.race_no,
          fullOddsIds.has(r.race_id),
        ).then((data) => ({ r, data })),
      ),
    );

    for (const { r, data } of results) {
      if (!data) continue;
      const {
        winOdds,
        placeOdds,
        trifecta,
        trifectaAll,
        trioAll,
        exactaAll,
        quinellaAll,
        wideAll,
      } = data;

      // 基本オッズ（単勝・複勝・3連単人気3位）は既存列のみで完結するため
      // 全通り系（新規4列＋trifecta_all）とは別のupsertで書き込む。
      // こうすることで、全通り系側でエラー（マイグレーション未適用等）が
      // 起きても基本オッズの保存には影響しない（2026-09-16実装時に、
      // 全窓全通り化で全レースが同一グループに入り、新規列欠如のエラー1件で
      // 基本オッズまで含めて全件保存されない回帰を実データで確認して分離した）
      baseRows.push({
        race_id: r.race_id,
        captured_at: capturedAt,
        odds_win_1: winOdds[0] ?? null,
        odds_win_2: winOdds[1] ?? null,
        odds_win_3: winOdds[2] ?? null,
        odds_win_4: winOdds[3] ?? null,
        odds_win_5: winOdds[4] ?? null,
        odds_win_6: winOdds[5] ?? null,
        odds_place_1_low: placeOdds[0]?.low ?? null,
        odds_place_1_high: placeOdds[0]?.high ?? null,
        odds_place_2_low: placeOdds[1]?.low ?? null,
        odds_place_2_high: placeOdds[1]?.high ?? null,
        odds_place_3_low: placeOdds[2]?.low ?? null,
        odds_place_3_high: placeOdds[2]?.high ?? null,
        odds_place_4_low: placeOdds[3]?.low ?? null,
        odds_place_4_high: placeOdds[3]?.high ?? null,
        odds_place_5_low: placeOdds[4]?.low ?? null,
        odds_place_5_high: placeOdds[4]?.high ?? null,
        odds_place_6_low: placeOdds[5]?.low ?? null,
        odds_place_6_high: placeOdds[5]?.high ?? null,
        trifecta_popular_1: trifecta[0]?.combination ?? null,
        trifecta_odds_1: trifecta[0]?.odds ?? null,
        trifecta_popular_2: trifecta[1]?.combination ?? null,
        trifecta_odds_2: trifecta[1]?.odds ?? null,
        trifecta_popular_3: trifecta[2]?.combination ?? null,
        trifecta_odds_3: trifecta[2]?.odds ?? null,
      });

      let fullOddsPatch = {
        ...(trifectaAll ? { trifecta_all: trifectaAll } : {}),
        ...(trioAll ? { trio_all: trioAll } : {}),
        ...(exactaAll ? { exacta_all: exactaAll } : {}),
        ...(quinellaAll ? { quinella_all: quinellaAll } : {}),
        ...(wideAll ? { wide_all: wideAll } : {}),
      };

      // 0分（締切時点）窓で全通り系の一部が欠けた場合は、直近の成功
      // スナップショットを実質最終値として補完する（ADR-0057）
      if (cutoffWindowIds.has(r.race_id)) {
        const fallback = await fillMissingFullOddsFromLatestSnapshot(
          r.race_id,
          fullOddsPatch,
        );
        fullOddsPatch = { ...fullOddsPatch, ...fallback };
      }

      if (Object.keys(fullOddsPatch).length > 0) {
        fullOddsRows.push({
          race_id: r.race_id,
          captured_at: capturedAt,
          ...fullOddsPatch,
        });
      }

      const winStr = winOdds
        .map((o, i) => (o !== null ? `${i + 1}号艇:${o}` : null))
        .filter(Boolean)
        .join(", ");
      console.log(`  ✅ ${venueName} ${r.race_no}R — ${winStr}`);
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (baseRows.length === 0) {
    console.log("\n📭 オッズ: 書き込みデータなし");
    return { updated: false, count: 0 };
  }

  console.log(`\n💾 race_odds(基本オッズ): ${baseRows.length}件書き込み中...`);
  for (let i = 0; i < baseRows.length; i += 1000) {
    const batch = baseRows.slice(i, i + 1000);
    const { error } = await supabase
      .from("race_odds")
      .upsert(batch, { onConflict: "race_id,captured_at" });
    if (error) {
      console.error("❌ race_odds(基本オッズ)書き込みエラー:", error.message);
    }
  }
  console.log(`✅ race_odds(基本オッズ): ${baseRows.length}件完了`);

  if (fullOddsRows.length > 0) {
    console.log(`💾 race_odds(全通り系): ${fullOddsRows.length}件追記中...`);
    // PostgRESTの一括upsertは全行同一キーが必要。全通り系5列は個別URL取得のため
    // 行ごとに含まれる列の組み合わせが異なりうる（一部だけ欠ける場合を含む）ため、
    // 実際に含まれる全通り系キーの組み合わせ（シグネチャ）ごとにグループ化する
    const groupBySignature = new Map();
    for (const row of fullOddsRows) {
      const signature = FULL_ODDS_KEYS.filter((k) => k in row).join(",");
      if (!groupBySignature.has(signature)) groupBySignature.set(signature, []);
      groupBySignature.get(signature).push(row);
    }
    for (const group of groupBySignature.values()) {
      for (let i = 0; i < group.length; i += 1000) {
        const batch = group.slice(i, i + 1000);
        const { error } = await supabase
          .from("race_odds")
          .upsert(batch, { onConflict: "race_id,captured_at" });
        if (error) {
          console.error("❌ race_odds(全通り系)書き込みエラー:", error.message);
        }
      }
    }
  }

  return { updated: true, count: baseRows.length };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🎰 オッズスクレイピング開始");
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
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
