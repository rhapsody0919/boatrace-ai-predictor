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
  fetchAll,
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
import { latestByRaceId } from "../lib/latestByRaceId.js";

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
async function parseFullOddsCombinations(
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
 * 1レースの単勝・3連単・（wantFull時）全通り系オッズを取得
 *
 * 基本(単勝/3連単)・全通り系(3連複/2連単/2連複/拡連複)の最大5URLを
 * 1回のPromise.allSettledで同時fetchする（旧実装は2波に分かれ逐次実行だった。
 * ADR-0057で全窓全通り化した後、本番cronの処理時間が増加し5分間隔のキューが
 * 詰まる実害が発生したため、レース単体のfetch待ち時間を削るために統合した
 * （BOA-341）。ただし会場間の逐次処理・1秒待機（下記run()参照）はこの変更の
 * スコープ外で温存しており、キュー詰まりを完全に解消する保証はない。
 * cron間隔・全通り捕捉窓自体の見直しはBOA-342で別途検討する。
 * allSettledを使うのは、全通り系URLのfetch自体が失敗（DNSエラー等で
 * Promiseがreject）した場合でも、既に取得できた基本オッズ（単勝・3連単）
 * まで巻き込んでレース全体を失敗扱いにしないため（Promise.allだと1つの
 * rejectで全体がrejectする）
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
  // urls/keysは同じ順序で対応させる。settled配列へのアクセスは必ずkeys経由の
  // 名前引きにし、settled[固定index]という書き方はしない（配列順の変更に
  // 追従できず取り違えるバグを防ぐため、レビューで指摘・修正）
  const urlByKey = {
    win: `https://www.boatrace.jp/owpc/pc/race/oddstf?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`,
    trif: `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`,
    ...(wantFull
      ? {
          trio: `https://www.boatrace.jp/owpc/pc/race/odds3f?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`,
          tf: `https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`,
          wide: `https://www.boatrace.jp/owpc/pc/race/oddsk?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`,
        }
      : {}),
  };
  const keys = Object.keys(urlByKey);

  try {
    const settled = await Promise.allSettled(
      keys.map((k) => fetch(urlByKey[k], { headers: FETCH_HEADERS })),
    );
    const bySettled = Object.fromEntries(keys.map((k, i) => [k, settled[i]]));
    const okResponse = (s) =>
      s && s.status === "fulfilled" && s.value.ok ? s.value : null;
    const settledDetail = (s) =>
      s.status === "fulfilled"
        ? `HTTP ${s.value.status}`
        : (s.reason?.message ?? String(s.reason));

    // win(単勝)は下で個別にエラーログを出す。trif/全通り系のfetch自体の失敗
    // （DNSエラー等でPromiseがreject）は、旧実装ではPromise.allのrejectで
    // 必ずこの関数のcatchに落ちてログされていたが、allSettledに変更した
    // ことで無言で握りつぶされる回帰が起きるため、ここでまとめてログする
    // （HTTP非okは券種未公開等の正常なケースを含みうるため従来通りログしない）
    for (const key of keys) {
      if (key === "win") continue;
      if (bySettled[key].status === "rejected") {
        console.error(
          `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R ${key}オッズ取得失敗（通信エラー）: ${settledDetail(bySettled[key])}`,
        );
      }
    }

    const winRes = okResponse(bySettled.win);
    if (!winRes) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 単勝オッズ取得失敗 ${settledDetail(bySettled.win)}`,
      );
      return null;
    }

    const $win = cheerio.load(await winRes.text());
    const winOdds = scrapeWinOdds($win);
    const placeOdds = scrapePlaceOdds($win);

    const trifRes = okResponse(bySettled.trif);
    let trifecta = [];
    let trifectaAll = null;
    if (trifRes) {
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
        await parseFullOddsCombinations(
          okResponse(bySettled.trio),
          okResponse(bySettled.tf),
          okResponse(bySettled.wide),
          venueCode,
          raceNo,
        ));
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
 * 0分窓（締切時点）で全通り系の一部が欠けたレースをまとめて、直近の成功
 * スナップショットから該当列を補完する（ADR-0057のフォールバック設計）。
 * 取得できなかった券種をエラーとして握りつぶさず、直前の値を実質的な
 * 最終値として扱う。ただしMAX_FALLBACK_AGE_MINUTESより古いスナップショット
 * は採用しない。
 *
 * レースごとに逐次awaitでSupabaseへ問い合わせるN+1呼び出しを避けるため、
 * 対象レースIDをまとめて1回の.in()クエリで取得する（BOA-341）。
 * Supabaseの.select()はデフォルトで最大1000行しか返さず超過分は無言で
 * 切り捨てられるため（本プロジェクトで既知の落とし穴、generate-predictions.js
 * のCHUNK_SIZE運用と同じ理由）、素の.select()ではなくfetchAll()（1000件単位で
 * .range()ページネーション）を使い、.in()側もCHUNK_SIZE単位に分割する
 *
 * @param {Map<string, Object>} patchesByRaceId - race_id -> 今回のスナップショット行（欠けている全通り系キーは未設定）
 * @returns {Promise<Map<string, Object>>} race_id -> 補完できた列のみを持つオブジェクト
 */
async function fillMissingFullOddsFromLatestSnapshots(patchesByRaceId) {
  const targets = [...patchesByRaceId.entries()]
    .map(([raceId, row]) => ({
      raceId,
      missingKeys: FULL_ODDS_KEYS.filter((k) => !(k in row)),
    }))
    .filter((t) => t.missingKeys.length > 0);

  if (targets.length === 0) return new Map();

  const cutoffIso = new Date(
    Date.now() - MAX_FALLBACK_AGE_MINUTES * 60000,
  ).toISOString();

  // fetchAll()自体がエラーを内部でログして空配列を返す設計のため、
  // ここでは追加のtry/catchは不要（コールサイトを揃える）
  const CHUNK_SIZE = 900; // Supabase .in() の1000件制限内（generate-predictions.js踏襲）
  const raceIds = targets.map((t) => t.raceId);
  const data = [];
  for (let i = 0; i < raceIds.length; i += CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + CHUNK_SIZE);
    const rows = await fetchAll(
      "race_odds",
      `race_id, captured_at, ${FULL_ODDS_KEYS.join(", ")}`,
      (q) =>
        q
          .in("race_id", chunk)
          .gte("captured_at", cutoffIso)
          .order("captured_at", { ascending: false }),
    );
    data.push(...rows);
  }

  const latestSnapshotByRaceId = latestByRaceId(data);

  const result = new Map();
  for (const { raceId, missingKeys } of targets) {
    const latest = latestSnapshotByRaceId.get(raceId);
    if (!latest) continue;
    const fallback = {};
    for (const key of missingKeys) {
      if (latest[key]) fallback[key] = latest[key];
    }
    if (Object.keys(fallback).length > 0) result.set(raceId, fallback);
  }

  return result;
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
  // race_idごとのfullOddsPatch（0分窓フォールバック適用前）。フォールバックは
  // 全レース分をまとめて後段で一括取得するため、ここではまだupsert対象の
  // fullOddsRowsに確定しない（BOA-341、逐次awaitのN+1を避けるため全venue処理後に一括処理）
  const pendingFullOdds = [];

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

      const fullOddsPatch = {
        ...(trifectaAll ? { trifecta_all: trifectaAll } : {}),
        ...(trioAll ? { trio_all: trioAll } : {}),
        ...(exactaAll ? { exacta_all: exactaAll } : {}),
        ...(quinellaAll ? { quinella_all: quinellaAll } : {}),
        ...(wideAll ? { wide_all: wideAll } : {}),
      };
      pendingFullOdds.push({ raceId: r.race_id, patch: fullOddsPatch });

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

  // 0分（締切時点）窓で全通り系の一部が欠けたレースをまとめてフォールバック
  // 取得する（ADR-0057）。レースごとの逐次awaitを避けるため1回の.in()クエリに
  // まとめる（BOA-341）
  const fallbackTargets = new Map();
  for (const { raceId, patch } of pendingFullOdds) {
    if (cutoffWindowIds.has(raceId)) fallbackTargets.set(raceId, patch);
  }
  const fallbackByRaceId =
    await fillMissingFullOddsFromLatestSnapshots(fallbackTargets);

  const fullOddsRows = [];
  for (const { raceId, patch } of pendingFullOdds) {
    const fallback = fallbackByRaceId.get(raceId);
    const finalPatch = fallback ? { ...patch, ...fallback } : patch;
    if (Object.keys(finalPatch).length > 0) {
      fullOddsRows.push({
        race_id: raceId,
        captured_at: capturedAt,
        ...finalPatch,
      });
    }
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
    console.log(`✅ race_odds(全通り系): ${fullOddsRows.length}件完了`);
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
