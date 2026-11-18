/**
 * オッズページの読み（scrape-odds.js から分けた純粋関数）: 単勝・複勝・3連単・全通り系・race_odds の基本の行。
 * 呼び出し元はこれまでどおり scrape-odds.js から import できる
 */
import * as cheerio from "cheerio";
import { VENUE_NAMES } from "./venueNames.js";
import {
  parseTrifectaAll,
  parseTrioAll,
  parseExactaAll,
  parseQuinellaAll,
  parseWideAll,
  parseRangeOddsValue,
} from "./oddsParser.js";

// 全通り系（jsonb）列。ADR-0054/0057
export const FULL_ODDS_KEYS = [
  "trifecta_all",
  "trio_all",
  "exacta_all",
  "quinella_all",
  "wide_all",
];

/**
 * 単勝オッズページをスクレイプ
 * セレクタ: .oddsPoint（艇1〜6の順）
 *
 * 返る配列の長さ = ページ上の単勝セルの数（未公開のページは0件）。値が無いこと（0.0）と
 * 行そのものが無いこと（未公開）を呼び出し側が区別できるようにするため、
 * 値が null の艇も詰めずにそのまま並べる（isWinOddsUnpublished 参照。BOA-486）
 *
 * keepZero=true（ライブ表示用、BOA-487）なら、票0の「0.0」を 0 のまま返す（既定は null。race_odds への
 * 保存は従来どおり null）。
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @param {{keepZero?: boolean}} [options]
 * @returns {Array<number|null>} 艇1〜6の単勝オッズ（取得失敗・票0は null。keepZero なら票0は 0）
 */
export function scrapeWinOdds($, { keepZero = false } = {}) {
  const winOdds = [];
  $(".oddsPoint").each((i, el) => {
    if (i >= 6) return false;
    const text = $(el).text().trim();
    const val = parseFloat(text);
    // 0 以下はオッズ未確定として null に変換（有効な単勝オッズは必ず 1.0 以上）。
    // 公式ページは票がまだ0の艇を「0.0」と表示するため、null は「未公開」を意味しない
    if (keepZero && val === 0) winOdds.push(0);
    else winOdds.push(!isNaN(val) && val > 0 ? val : null);
  });
  return winOdds;
}

/**
 * 単勝が未公開か（発売前・中止・順延）。scrapeWinOdds の返り値で判定する。
 *
 * | 状態 | .oddsPoint |
 * |---|---|
 * | 未公開 | 0件（scrapeWinOdds が空配列を返す） |
 * | 発売済み・票0 | あって値が「0.0」（scrapeWinOdds が [null, ...] を返す） |
 *
 * 「有効な値が1件も無いこと」で未公開を判定すると、朝の1R〜4R等で単勝の票が極端に少ない
 * （全艇0.0）レースを未公開とみなし、同時に解析できていた3連単等まで捨ててしまう（BOA-486）。
 *
 * @param {Array<number|null>} winOdds
 * @returns {boolean}
 */
export function isWinOddsUnpublished(winOdds) {
  return winOdds.length === 0;
}

/**
 * 複勝オッズをスクレイプ（単勝オッズと同一ページ内、.oddsPointの7〜12番目）
 * 複勝オッズは「下限-上限」のレンジ表示（例: "3.9-4.6"）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス（scrapeWinOddsと同じページ）
 * @param {{keepZero?: boolean}} [options] keepZero=true なら票0の「0.0-0.0」を {low: 0, high: 0} で返す（BOA-487）
 * @returns {Array<{low: number, high: number}|null>} 艇1〜6の複勝オッズ（取得失敗はnull）
 */
export function scrapePlaceOdds($, { keepZero = false } = {}) {
  const placeOdds = [];
  $(".oddsPoint").each((i, el) => {
    if (i < 6 || i >= 12) return;
    // 2026-08-14修正（BOA-186）: 全角ハイフンを正規化する。未対応だとsplit("-")が
    // 1要素になり、high=lowにフォールバックして「幅ゼロの点オッズ」が有効値として
    // 黙って保存されてしまう（nullと区別できない）。parseRangeOddsValueに集約済み
    placeOdds.push(parseRangeOddsValue($(el).text().trim(), { keepZero }));
  });
  return placeOdds;
}

/**
 * 3連単の全通り（"1-2-3" -> オッズ）から、人気上位（オッズの低い順）の n 件を選ぶ（純粋関数）。
 * 人気順はオッズの昇順（低いほど人気）。同じオッズは組番の昇順で並べ、結果を決定的にする。
 *
 * @param {Map<string, number>} trifectaMap parseTrifectaAll の返り値
 * @param {number} [n]
 * @returns {Array<{combination: string, odds: number}>}
 */
export function topTrifectaByOdds(trifectaMap, n = 3) {
  const compareBoats = (a, b) => {
    const pa = a.split("-").map(Number);
    const pb = b.split("-").map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  };
  return [...trifectaMap.entries()]
    .sort(([ka, oa], [kb, ob]) => oa - ob || compareBoats(ka, kb))
    .slice(0, n)
    .map(([combination, odds]) => ({ combination, odds }));
}

/**
 * 3連単人気上位3つを、odds3t の全通りの表から求める。
 *
 * 公式の odds3t ページに「人気順」の表は無い（2026-09-21に実ページとフィクスチャで確認。ページの表は、
 * 1着艇ごとに6セクションを横に並べた120通りの組番順のグリッド1つだけ）。旧実装は `.is-p3-0 tbody tr` を
 * 探していたが、`is-p3-0` はそのグリッドの <tbody> 自身のクラスで、内側に <tbody> は無いため、常に0件に
 * なり、trifecta_popular_*・trifecta_odds_* が全行で NULL だった。全通りのグリッド
 * （oddsParser.parseTrifectaAll）から、オッズの低い順に3件選ぶ。
 *
 * @param {CheerioAPI} $ - odds3t ページの cheerio インスタンス
 * @returns {Array<{combination: string|null, odds: number|null}>} 最大3件（グリッドが取れなければ空）
 */
export function scrapeTrifectaOdds($) {
  return topTrifectaByOdds(parseTrifectaAll($));
}

/**
 * 全通り捕捉対象（3連複・2連単・2連複・拡連複）のfetch済みレスポンスを
 * パースし、それぞれのMapをプレーンオブジェクトに変換して返す（ADR-0057、FR-4）
 *
 * @param {Response|null} trioRes
 * @param {Response|null} tfRes
 * @param {Response|null} wideRes
 * @param {number} venueCode
 * @param {number} raceNo
 * @returns {Promise<{trioAll: Object|null, exactaAll: Object|null, quinellaAll: Object|null, wideAll: Object|null}>}
 */
export async function parseFullOddsCombinations(
  trioRes,
  tfRes,
  wideRes,
  venueCode,
  raceNo,
) {
  const result = {
    trioAll: null,
    exactaAll: null,
    quinellaAll: null,
    wideAll: null,
  };

  // 呼び出し元（fetchOddsForRace）では単勝・3連単の取得に既に成功している。
  // ここで例外を外側へ伝播させると、既に取得済みの基本オッズまで含めて
  // レース全体がnull扱いになってしまうため、失敗はこの関数内で握りつぶし
  // resultを空のまま返す（基本オッズの取得成功には影響させない）
  try {
    if (trioRes?.ok) {
      const map = parseTrioAll(cheerio.load(await trioRes.text()));
      if (map.size > 0) result.trioAll = Object.fromEntries(map);
    }
    if (tfRes?.ok) {
      const $tf = cheerio.load(await tfRes.text());
      const exactaMap = parseExactaAll($tf);
      const quinellaMap = parseQuinellaAll($tf);
      if (exactaMap.size > 0) result.exactaAll = Object.fromEntries(exactaMap);
      if (quinellaMap.size > 0)
        result.quinellaAll = Object.fromEntries(quinellaMap);
    }
    if (wideRes?.ok) {
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
 * 解析結果（fetchOddsDetailed の data）から、race_odds の全通り系（jsonb）列だけを取り出す。
 * 取得できなかった券種（null）は含めない
 *
 * @param {{trifectaAll?: Object|null, trioAll?: Object|null, exactaAll?: Object|null, quinellaAll?: Object|null, wideAll?: Object|null}} data
 * @returns {Object}
 */
export function fullOddsPatchOf(data) {
  return {
    ...(data.trifectaAll ? { trifecta_all: data.trifectaAll } : {}),
    ...(data.trioAll ? { trio_all: data.trioAll } : {}),
    ...(data.exactaAll ? { exacta_all: data.exactaAll } : {}),
    ...(data.quinellaAll ? { quinella_all: data.quinellaAll } : {}),
    ...(data.wideAll ? { wide_all: data.wideAll } : {}),
  };
}

/**
 * race_odds の基本オッズ（単勝・複勝・3連単人気3位）の行を組み立てる。
 * 基本オッズは既存列のみで完結するため、全通り系（新規4列＋trifecta_all）とは別のupsertで書き込む
 * （run() の従来の書き込み）。runForRaces（Vercel）は、基本オッズと全通り系を1行にまとめて書く
 *
 * @param {string} raceId
 * @param {string} capturedAt ISO文字列
 * @param {{winOdds: Array<number|null>, placeOdds: Array<{low: number, high: number}|null>, trifecta: Array<{combination: string|null, odds: number|null}>}} data
 */
const nth = (arr, i) => arr[i] ?? null;

const nthKey = (arr, i, key) => arr[i]?.[key] ?? null;

export function buildBaseRow(raceId, capturedAt, data) {
  const { winOdds, placeOdds, trifecta } = data;
  return {
    race_id: raceId,
    captured_at: capturedAt,
    odds_win_1: nth(winOdds, 0),
    odds_win_2: nth(winOdds, 1),
    odds_win_3: nth(winOdds, 2),
    odds_win_4: nth(winOdds, 3),
    odds_win_5: nth(winOdds, 4),
    odds_win_6: nth(winOdds, 5),
    odds_place_1_low: nthKey(placeOdds, 0, "low"),
    odds_place_1_high: nthKey(placeOdds, 0, "high"),
    odds_place_2_low: nthKey(placeOdds, 1, "low"),
    odds_place_2_high: nthKey(placeOdds, 1, "high"),
    odds_place_3_low: nthKey(placeOdds, 2, "low"),
    odds_place_3_high: nthKey(placeOdds, 2, "high"),
    odds_place_4_low: nthKey(placeOdds, 3, "low"),
    odds_place_4_high: nthKey(placeOdds, 3, "high"),
    odds_place_5_low: nthKey(placeOdds, 4, "low"),
    odds_place_5_high: nthKey(placeOdds, 4, "high"),
    odds_place_6_low: nthKey(placeOdds, 5, "low"),
    odds_place_6_high: nthKey(placeOdds, 5, "high"),
    trifecta_popular_1: nthKey(trifecta, 0, "combination"),
    trifecta_odds_1: nthKey(trifecta, 0, "odds"),
    trifecta_popular_2: nthKey(trifecta, 1, "combination"),
    trifecta_odds_2: nthKey(trifecta, 1, "odds"),
    trifecta_popular_3: nthKey(trifecta, 2, "combination"),
    trifecta_odds_3: nthKey(trifecta, 2, "odds"),
  };
}
