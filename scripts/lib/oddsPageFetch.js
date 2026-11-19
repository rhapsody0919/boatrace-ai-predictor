/**
 * レース前オッズの取得（scrape-odds.js から分けた部分）: オッズページの URL・取得と待ち合わせ・単勝と3連単の読み。
 * DB には触れない（書くのは scrape-odds.js の run・runForRaces）。呼び出し元はこれまでどおり scrape-odds.js から import できる
 */
import * as cheerio from "cheerio";
import { parseTrifectaAll } from "./oddsParser.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { VENUE_NAMES } from "./venueNames.js";
import {
  FULL_ODDS_KEYS,
  fullOddsPatchOf,
  isWinOddsUnpublished,
  parseFullOddsCombinations,
  scrapePlaceOdds,
  scrapeWinOdds,
  topTrifectaByOdds,
} from "./oddsPageParse.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// 既定の取得（グローバルの fetch）。Vercel Cron のスロット消化では、politeFetch（タイムアウト・429/503の
// バックオフ・ブレーカー込み）を fetchFn として差し込む
export const defaultFetch = (url) => fetch(url, { headers: FETCH_HEADERS });

/** 1レースのオッズページの URL（win・trif と、wantFull なら trio・tf・wide） */
function oddsUrlsByKey(date, venueCode, raceNo, wantFull) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  // urls/keysは同じ順序で対応させる。settled配列へのアクセスは必ずkeys経由の
  // 名前引きにし、settled[固定index]という書き方はしない（配列順の変更に
  // 追従できず取り違えるバグを防ぐため、レビューで指摘・修正）
  return {
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
}

/** settleWinFirst が「単勝が未公開」を返す印 */
const NO_VALUES = Symbol("no_values");

const okResponse = (s) =>
  s && s.status === "fulfilled" && s.value.ok ? s.value : null;
const settledDetail = (s) =>
  s.status === "fulfilled"
    ? `HTTP ${s.value.status}`
    : (s.reason?.message ?? String(s.reason));

/**
 * 単勝ページだけを先に取得する。未公開なら NO_VALUES を返す（他のページは取得しない）。公開されていれば、
 * 読み取った本文を Response に包み直して、以降の処理（単勝の解析）に渡し、残りのページを並列に取得する
 */
async function settleWinFirst(settleKeys, keys) {
  const [winSettled] = await settleKeys(["win"]);
  let winProbe = winSettled;
  if (winSettled.status === "fulfilled" && winSettled.value.ok) {
    const winText = await winSettled.value.text();
    if (isWinOddsUnpublished(scrapeWinOdds(cheerio.load(winText)))) {
      return NO_VALUES;
    }
    winProbe = {
      status: "fulfilled",
      value: new Response(winText, { status: 200 }),
    };
  }
  const restKeys = keys.filter((k) => k !== "win");
  // 単勝ページが取得できなかった（通信エラー・HTTP非200・ブレーカー）ときは、他のページを取得しない
  // （下の単勝の失敗の処理で終わる。取得しなかったページは、通信エラーのログを出さない印 skipped を付ける）
  const winFailed = winProbe.status !== "fulfilled" || !winProbe.value.ok;
  const restSettled = winFailed
    ? restKeys.map(() => ({
        status: "rejected",
        reason: new Error("単勝ページの取得に失敗したため、取得しませんでした"),
        skipped: true,
      }))
    : await settleKeys(restKeys);
  return {
    win: winProbe,
    ...Object.fromEntries(restKeys.map((k, i) => [k, restSettled[i]])),
  };
}

/**
 * win(単勝)は別に個別にエラーログを出す。trif/全通り系のfetch自体の失敗
 * （DNSエラー等でPromiseがreject）は、旧実装ではPromise.allのrejectで
 * 必ずこの関数のcatchに落ちてログされていたが、allSettledに変更した
 * ことで無言で握りつぶされる回帰が起きるため、ここでまとめてログする
 * （HTTP非okは券種未公開等の正常なケースを含みうるため従来通りログしない）
 */
function logRestFetchFailures(keys, bySettled, venueCode, raceNo) {
  for (const key of keys) {
    if (key === "win") continue;
    if (bySettled[key].status === "rejected" && !bySettled[key].skipped) {
      console.error(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R ${key}オッズ取得失敗（通信エラー）: ${settledDetail(bySettled[key])}`,
      );
    }
  }
}

/** 単勝ページが取れなかったときの fetchOddsDetailed の戻り値（ブレーカーなら breaker_open、他は error） */
function winFailureResult(s, venueCode, raceNo) {
  console.error(
    `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 単勝オッズ取得失敗 ${settledDetail(s)}`,
  );
  if (s.status === "rejected" && s.reason instanceof BreakerOpenError) {
    return {
      status: "breaker_open",
      data: null,
      missing: [],
      error: s.reason.message,
      retryAt: new Date(s.reason.until),
    };
  }
  return {
    status: "error",
    data: null,
    missing: [],
    error: `単勝オッズ取得失敗 ${settledDetail(s)}`,
  };
}

/**
 * 1レースの単勝・3連単・（wantFull時）全通り系オッズを取得し、結果の種別つきで返す
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
 * status（Vercel Cron のスロットの outcome と対応）:
 *   ok            単勝ページが発売済みで、wantFull なら全通り系5列も全て取得できた
 *                 （単勝の値は票0で全て null のことがある。BOA-486）
 *   partial       単勝ページは発売済みだが、全通り系のいずれかが取得・解析できなかった（missing に列名）
 *   no_values     単勝ページは取得できたが、単勝の行そのものが無い（未公開・中止・順延の可能性）
 *   error         単勝ページの取得に失敗した（HTTP非200・通信エラー）、または解析中の想定外の例外
 *   breaker_open  サーキットブレーカーが開いていて取得しなかった（retryAt まで待つ）
 *
 * @param {string} date - YYYY-MM-DD
 * @param {number} venueCode - 会場コード (1-24)
 * @param {number} raceNo - レース番号 (1-12)
 * @param {Object} [options]
 * @param {boolean} [options.wantFull] - true なら3連単・3連複・2連単・2連複・拡連複の全通りもパースして返す（ADR-0057）
 * @param {boolean} [options.winFirst] - true なら、単勝ページだけを先に取得し、未公開（単勝の行が無い）なら、
 *   他のページを取得せずに no_values を返す。公開されていれば、続けて他のページを（並列に）取得する。
 *   未公開の間の再試行で、取得先へのリクエストを1ページに絞るため（オッズの発走60分前の窓の延長。registry.js の odds）。
 *   既定は false（従来どおり、全ページを並列に取得する。公開済みの通常の取得の所要時間を変えない）
 * @param {(url: string) => Promise<Response>} [options.fetchFn] - 取得関数（既定はグローバルの fetch）
 * @returns {Promise<{status: "ok"|"partial"|"no_values"|"error"|"breaker_open", data: {winOdds: Array, placeOdds: Array, trifecta: Array, trifectaAll: Object|null, trioAll: Object|null, exactaAll: Object|null, quinellaAll: Object|null, wideAll: Object|null}|null, missing: string[], error?: string, retryAt?: Date}>}
 */
export async function fetchOddsDetailed(
  date,
  venueCode,
  raceNo,
  { wantFull = false, winFirst = false, fetchFn = defaultFetch } = {},
) {
  const urlByKey = oddsUrlsByKey(date, venueCode, raceNo, wantFull);
  const keys = Object.keys(urlByKey);

  try {
    // fetchFn が同期的に例外を投げても、他のURLの取得を巻き込まないよう Promise にそろえる
    const settleKeys = (ks) =>
      Promise.allSettled(
        ks.map((k) => Promise.resolve().then(() => fetchFn(urlByKey[k]))),
      );
    // 全ページを並列に取得する（key → allSettled の結果）。async の殻を挟まず、分ける前と同じ待ちの段数にする
    let bySettled;
    if (winFirst) {
      bySettled = await settleWinFirst(settleKeys, keys);
    } else {
      const settled = await settleKeys(keys);
      bySettled = Object.fromEntries(keys.map((k, i) => [k, settled[i]]));
    }
    if (bySettled === NO_VALUES) {
      return { status: "no_values", data: null, missing: [] };
    }

    logRestFetchFailures(keys, bySettled, venueCode, raceNo);

    const winRes = okResponse(bySettled.win);
    if (!winRes) return winFailureResult(bySettled.win, venueCode, raceNo);

    const $win = cheerio.load(await winRes.text());
    const winOdds = scrapeWinOdds($win);
    const placeOdds = scrapePlaceOdds($win);

    const trifRes = okResponse(bySettled.trif);
    let trifecta = [];
    let trifectaAll = null;
    if (trifRes) {
      const $trif = cheerio.load(await trifRes.text());
      // 120通りのグリッドを1回だけ解析し、人気上位3件（trifecta_popular_*）と全通り（trifecta_all）の両方に使う
      const fullMap = parseTrifectaAll($trif);
      trifecta = topTrifectaByOdds(fullMap);
      // 全通り捕捉ウィンドウ: 120通りを保存（EV分析用・BOA-104）
      if (wantFull && fullMap.size > 0) {
        trifectaAll = Object.fromEntries(fullMap);
      }
    }

    // 単勝の行そのものが無ければ、未公開（null）。値が全て 0.0（票0）のときは発売済みなので、
    // 単勝は null のまま、他券種を保存する（BOA-486）
    if (isWinOddsUnpublished(winOdds)) {
      return { status: "no_values", data: null, missing: [] };
    }

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

    const data = {
      winOdds,
      placeOdds,
      trifecta,
      trifectaAll,
      trioAll,
      exactaAll,
      quinellaAll,
      wideAll,
    };
    const patch = fullOddsPatchOf(data);
    const missing = wantFull ? FULL_ODDS_KEYS.filter((k) => !(k in patch)) : [];
    return { status: missing.length > 0 ? "partial" : "ok", data, missing };
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R オッズ取得エラー: ${err.message}`,
    );
    return { status: "error", data: null, missing: [], error: err.message };
  }
}

/**
 * 1レースの単勝・3連単・（wantFull時）全通り系オッズを取得（run() 用。取得できなければ null）
 *
 * @returns {Promise<{winOdds: Array, placeOdds: Array, trifecta: Array, trifectaAll: Object|null, trioAll: Object|null, exactaAll: Object|null, quinellaAll: Object|null, wideAll: Object|null}|null>}
 */
export async function fetchOddsForRace(
  date,
  venueCode,
  raceNo,
  wantFull = false,
) {
  const { data } = await fetchOddsDetailed(date, venueCode, raceNo, {
    wantFull,
  });
  return data;
}
