/**
 * verify-scrape-odds-job.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-odds-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  fetchOddsDetailed,
  FULL_ODDS_KEYS,
  fullOddsPatchOf,
  scrapeTrifectaOdds,
  topTrifectaByOdds,
  buildBaseRow,
  isWinOddsUnpublished,
} from "../../daily/scrape-odds.js";
import * as cheerio from "cheerio";
import { computeOddsDigest } from "../../lib/scrapeJobs/oddsDigest.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";

let check, show, same, PAGES, HTML_UNPUBLISHED, HTML_ZERO_VOTES, HTML_ALL_ZERO_VOTES, DATE, RACE_A, NOW, clone, createFetcher;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher(),
  });
  const d = r.data;
  check(
    "解析: 桐生1Rの単勝6・複勝6（下限・上限）が取れる",
    r.status === "ok" &&
      d.winOdds.length === 6 &&
      d.winOdds.every((o) => o > 0) &&
      d.placeOdds.length === 6 &&
      d.placeOdds.every((p) => p && p.low > 0 && p.high >= p.low),
    show({ status: r.status, win: d?.winOdds }),
  );
  check(
    "解析: 全通り5券種が取れる（3連単120・3連複20・2連単30・2連複15・拡連複15通り）、missing は空",
    Object.keys(d.trifectaAll).length === 120 &&
      Object.keys(d.trioAll).length === 20 &&
      Object.keys(d.exactaAll).length === 30 &&
      Object.keys(d.quinellaAll).length === 15 &&
      Object.keys(d.wideAll).length === 15 &&
      r.missing.length === 0,
  );
  check(
    "解析: 全通り系の列名は5つ固定（FULL_ODDS_KEYS）で、取得結果と1対1に対応する",
    same(FULL_ODDS_KEYS, [
      "trifecta_all",
      "trio_all",
      "exacta_all",
      "quinella_all",
      "wide_all",
    ]) && same(Object.keys(fullOddsPatchOf(d)), FULL_ODDS_KEYS),
  );
  // 3連単の人気上位3件: 桐生1Rのフィクスチャで、120通りのグリッドを独立に並べ替えた結果と一致する。
  // 期待値は、フィクスチャのHTMLに書かれている値（1-2-6=7.6・1-2-3=10.0・1-6-2=14.8。第1セクション=1着1号艇の表で確認）
  check(
    "3連単人気: 桐生1Rの人気1〜3位が、オッズの低い順（1-2-6:7.6・1-2-3:10.0・1-6-2:14.8）で取れる",
    same(d.trifecta, [
      { combination: "1-2-6", odds: 7.6 },
      { combination: "1-2-3", odds: 10 },
      { combination: "1-6-2", odds: 14.8 },
    ]),
    show(d.trifecta),
  );
  check(
    "3連単人気: 上位3件は trifecta_all（120通り）のオッズ昇順の先頭3件と同じで、順序は非減少",
    (() => {
      const sorted = Object.entries(d.trifectaAll).sort((a, b) => a[1] - b[1]);
      return (
        d.trifecta.length === 3 &&
        d.trifecta.every(
          (t, i) =>
            t.odds === sorted[i][1] && d.trifectaAll[t.combination] === t.odds,
        ) &&
        d.trifecta[0].odds <= d.trifecta[1].odds &&
        d.trifecta[1].odds <= d.trifecta[2].odds
      );
    })(),
    show(d.trifecta),
  );
  {
    // 旧セレクタが0件だったことの再現（.is-p3-0 は <tbody> 自身のクラスで、内側に <tbody> は無い）
    const $t = cheerio.load(PAGES.odds3t);
    check(
      "3連単人気: 旧セレクタ（.is-p3-0 tbody tr）は実ページで0件（不具合の再現）。新しい解析は3件返す",
      $t(".is-p3-0 tbody tr").length === 0 &&
        $t("tbody.is-p3-0 tr").length > 0 &&
        scrapeTrifectaOdds($t).length === 3,
    );
  }
  return { d };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ d }) {
  check(
    "3連単人気: 同じオッズは組番の昇順で決定的に並べる。グリッドが空・不完全でも例外にしない（n件未満で返す）",
    same(
      topTrifectaByOdds(
        new Map([
          ["2-1-3", 5],
          ["1-3-2", 5],
          ["1-2-3", 5],
          ["4-5-6", 3],
          ["6-5-4", 9],
        ]),
      ),
      [
        { combination: "4-5-6", odds: 3 },
        { combination: "1-2-3", odds: 5 },
        { combination: "1-3-2", odds: 5 },
      ],
    ) &&
      same(topTrifectaByOdds(new Map()), []) &&
      same(topTrifectaByOdds(new Map([["1-2-3", 2]])), [
        { combination: "1-2-3", odds: 2 },
      ]),
  );
  {
    // wantFull=false（全通り系を取らない呼び出し）でも、人気上位は取れる。trifectaAll は取らない
    const r0 = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: false,
      fetchFn: createFetcher(),
    });
    check(
      "3連単人気: wantFull=false でも人気上位3件は取れ、trifectaAll は null のまま（取得ページ数・保存列は変わらない）",
      r0.status === "ok" &&
        same(r0.data.trifecta, d.trifecta) &&
        r0.data.trifectaAll === null,
      show(r0.data?.trifecta),
    );
  }
  const row = {
    ...buildBaseRow(RACE_A, NOW.toISOString(), d),
    ...fullOddsPatchOf(d),
  };
  const digest = computeOddsDigest(row);
  check(
    "ダイジェスト: 16桁の16進数で、同じ行なら同じ値",
    /^[0-9a-f]{16}$/.test(digest) && digest === computeOddsDigest(clone(row)),
    digest,
  );
  check(
    "ダイジェスト: trifecta_popular_*・trifecta_odds_* の有無・値に依存しない（修正前のNULLの行と、修正後の行で同じ値。並走中の shadow との比較を壊さない）",
    computeOddsDigest({
      ...row,
      trifecta_popular_1: null,
      trifecta_odds_1: null,
      trifecta_popular_2: null,
      trifecta_odds_2: null,
      trifecta_popular_3: null,
      trifecta_odds_3: null,
    }) === digest &&
      computeOddsDigest({ ...row, trifecta_popular_1: "9-9-9" }) === digest,
  );
  check(
    "ダイジェスト: オッズの値・captured_at が変わっても変わらない（時刻がずれた既存基盤の行と比べられる）",
    computeOddsDigest({
      ...row,
      odds_win_1: 99,
      trifecta_odds_1: 1,
      captured_at: "2030-01-01T00:00:00Z",
      trifecta_all: Object.fromEntries(
        Object.keys(row.trifecta_all).map((k) => [k, 1]),
      ),
    }) === digest,
  );
  const dropKey = (obj) => {
    const c = { ...obj };
    delete c[Object.keys(c)[0]];
    return c;
  };
  return { row, digest, dropKey };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ row, digest, dropKey }) {
  check(
    "ダイジェスト: 全通り系の組み合わせが1つ欠ける・券種が丸ごと欠ける・単勝が欠けると変わる",
    computeOddsDigest({ ...row, trio_all: dropKey(row.trio_all) }) !== digest &&
      computeOddsDigest({ ...row, wide_all: null }) !== digest &&
      computeOddsDigest({ ...row, odds_win_3: null }) !== digest &&
      computeOddsDigest({ ...row, odds_place_2_high: null }) !== digest,
  );
  check(
    "ダイジェスト: 組み合わせのキー集合が違えば（個数が同じでも）変わる",
    computeOddsDigest({
      ...row,
      quinella_all: Object.fromEntries(
        Object.keys(row.quinella_all).map((k) => [`x${k}`, 1]),
      ),
    }) !== digest,
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    scene3(s2);
  }
  {
    const r = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({ oddstf: HTML_UNPUBLISHED }),
    });
    check(
      "解析: 未公開ページ（.oddsPoint なし）は no_values（例外にしない）",
      r.status === "no_values" && r.data === null,
    );
  }
  // BOA-486: 発売済み・票0（.oddsPoint があって値が 0.0）を、未公開（.oddsPoint が0件）と区別する。
  // 以前は「有効な単勝オッズが1件も無い」で no_values にしていたため、全艇0.0のレースで
  // 解析済みの3連単120通り等まで捨てて、オッズ一覧タブが発走20分前でも空になっていた
  {
    const rZero = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({ oddstf: HTML_ZERO_VOTES }),
    });
    check(
      "解析: 発売済み・一部の艇が票0（0.0）なら、その艇だけ null で ok（捨てない）",
      rZero.status === "ok" &&
        same(rZero.data.winOdds, [1.0, 14.2, 14.2, null, 14.2, 14.2]) &&
        Object.keys(rZero.data.trifectaAll ?? {}).length === 120,
      show(rZero.status) + " " + show(rZero.data?.winOdds),
    );
    check(
      "解析: 複勝も票0（0.0-0.0）の艇だけ null になり、他の艇の値は残る",
      same(rZero.data.placeOdds, [
        { low: 1.0, high: 1.5 },
        { low: 1.0, high: 1.5 },
        null,
        null,
        null,
        null,
      ]),
      show(rZero.data?.placeOdds),
    );

    const rAllZero = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({ oddstf: HTML_ALL_ZERO_VOTES }),
    });
    check(
      "解析: 全艇が票0（0.0）でも no_values にせず、単勝は全て null のまま全通り系5券種を返す（BOA-486の回帰）",
      rAllZero.status === "ok" &&
        same(rAllZero.data.winOdds, [null, null, null, null, null, null]) &&
        FULL_ODDS_KEYS.every((k) => fullOddsPatchOf(rAllZero.data)[k]),
      show(rAllZero.status) + " " + show(rAllZero.data?.winOdds),
    );
    check(
      "解析: 未公開（.oddsPoint が0件）と全艇票0（0.0）は別の結果になる（件数で区別している）",
      (
        await fetchOddsDetailed(DATE, 5, 1, {
          wantFull: true,
          fetchFn: createFetcher({ oddstf: HTML_UNPUBLISHED }),
        })
      ).status === "no_values" && rAllZero.status === "ok",
    );
    check(
      "isWinOddsUnpublished: 空配列だけが未公開（全て null は発売済み）",
      isWinOddsUnpublished([]) === true &&
        isWinOddsUnpublished([null, null, null, null, null, null]) === false &&
        isWinOddsUnpublished([1.0, null, null, null, null, null]) === false,
    );
  }
  {
    const r = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({ odds3f: 404, oddsk: new Error("ECONNRESET") }),
    });
    check(
      "解析: 3連複が404・拡連複が通信エラーなら partial（単勝は取れる。missing に列名）",
      r.status === "partial" &&
        r.data.winOdds.length === 6 &&
        same(r.missing, ["trio_all", "wide_all"]),
      show(r.missing),
    );
  }
}

async function scene5() {
  {
    const r = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({ oddstf: 500 }),
    });
    check(
      "解析: 単勝ページが500なら error（HTTP ステータスをメッセージに含む）",
      r.status === "error" && /HTTP 500/.test(r.error),
      r.error,
    );
    const b = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: true,
      fetchFn: createFetcher({
        oddstf: new BreakerOpenError("host:boatrace.jp", Date.now() + 60000),
      }),
    });
    check(
      "解析: ブレーカーが開いていれば breaker_open（retryAt は Date）",
      b.status === "breaker_open" && b.retryAt instanceof Date,
      show(b),
    );
    const w = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: false,
      fetchFn: createFetcher(),
    });
    check(
      "解析: wantFull=false（従来の run の基本オッズのみ）は2ページだけ取り、全通り系は取らない・partial にならない",
      w.status === "ok" &&
        w.missing.length === 0 &&
        w.data.trioAll === null &&
        w.data.trifectaAll === null,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・PAGES・HTML_UNPUBLISHED・HTML_ZERO_VOTES・HTML_ALL_ZERO_VOTES・DATE・RACE_A・NOW・clone・createFetcher） */
export async function runScrapeOddsJobScenes1(env) {
  ({ check, show, same, PAGES, HTML_UNPUBLISHED, HTML_ZERO_VOTES, HTML_ALL_ZERO_VOTES, DATE, RACE_A, NOW, clone, createFetcher } = env);
  await scene4();
  await scene5();
}
