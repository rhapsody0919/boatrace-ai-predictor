/**
 * verify-series-day-fallback.js の (g) 節（日目はタブのラベルから読む・中止・順延のある節・その変異検証）と、仕様未定の入力（KNOWN_GAPS）の観測。verify ではない。
 * 判定と期待値は分ける前の verify-series-day-fallback.js と同じ。check は verify 側の物を受け取る（失敗の数は verify が数える）。
 */
import * as cheerio from "cheerio";
import { buildRaceConditionRow } from "../../lib/preRaceRows.js";
import { scrapeSeriesDay } from "../../lib/raceListParser.js";
import {
  buildSeriesDayByVenue,
  hasCancellationBefore,
  planSeriesDayBackfill,
} from "../../lib/raceSeriesLookup.js";

const show = (v) => JSON.stringify(v);


// ---------------------------------------------------------------------------
// (g) 日目はタブのラベルから読む（BOA-501 の訂正。2026-09-28 に公式の出走表ページで確認した並び）
// ---------------------------------------------------------------------------
const tabsHtml = (labels, activeIndex) =>
  `<ul>${labels
    .map(
      (l, i) =>
        `<li${i === activeIndex ? ' class="is-active2"' : ""}><div class="tab2_inner"><span>${l}</span></div></li>`,
    )
    .join("")}</ul>`;
// 津 2026-09-21〜28: 先頭2日が順延・中止。公式は中止・順延の日に日目を振らない
const TSU = [
  "順延",
  "中止",
  "２日目",
  "３日目",
  "４日目",
  "５日目",
  "６日目",
  "最終日",
];
const NORMAL = ["初日", "２日目", "３日目", "４日目", "最終日"];
/** 観測: ラベルから日目を読む（津の最終日は7・順延の日は null で tabsFound、通常の節の最終日はタブの総数） */
function labelsRead(scrape = scrapeSeriesDay) {
  const at = (labels, i) => scrape(cheerio.load(tabsHtml(labels, i)));
  const tsuPostponed = at(TSU, 0);
  const tsuDay2 = at(TSU, 2);
  const tsuFinal = at(TSU, 7);
  const normalFinal = at(NORMAL, 4);
  const normalFirst = at(NORMAL, 0);
  const noTabs = scrape(cheerio.load("<div></div>"));
  return (
    tsuPostponed.seriesDay === null &&
    tsuPostponed.isFinalDay === null &&
    tsuPostponed.tabsFound === true &&
    tsuDay2.seriesDay === 2 &&
    tsuFinal.seriesDay === 7 &&
    tsuFinal.isFinalDay === true &&
    normalFinal.seriesDay === 5 &&
    normalFinal.isFinalDay === true &&
    normalFirst.seriesDay === 1 &&
    noTabs.seriesDay === null &&
    noTabs.tabsFound === false
  );
}

/** 観測: 補うのはタブが読めないときだけ（順延・中止の日は、節からの導出があっても null のまま） */
function fallbackOnlyWithoutTabs(build = buildRaceConditionRow) {
  const meta = (m) => ({
    raceTitle: "t",
    raceStage: null,
    isFinalDay: null,
    distanceM: null,
    labels: [],
    ...m,
  });
  const postponed = build(
    "2026-09-21-09-01",
    meta({ seriesDay: null, seriesDayTabsFound: true }),
    { fallbackSeriesDay: 1 },
  );
  const noTabs = build(
    "2026-09-16-23-01",
    meta({ seriesDay: null, seriesDayTabsFound: false }),
    { fallbackSeriesDay: 3 },
  );
  const fromPage = build(
    "2026-09-23-09-01",
    meta({ seriesDay: 2, seriesDayTabsFound: true }),
    { fallbackSeriesDay: 3 },
  );
  return (
    !("series_day" in postponed) &&
    !("is_final_day" in postponed) &&
    noTabs.series_day === 3 &&
    fromPage.series_day === 2
  );
}

// 節の中の中止・順延（確定）: その日より前にあれば、導出しない（その日・後なら導出してよい）
const TSU_SERIES = [
  { venue_code: 9, start_date: "2026-09-21", end_date: "2026-09-28" },
];
const TSU_CANCELLED = [{ venue_code: 9, race_date: "2026-09-22" }];

// 仕様が未定の入力。現在値は観測だけ行い、assert・failures の対象にしない。
const KNOWN_GAPS = [
  {
    label: "行の会場コードが文字列（数値との同一視は未定。DB は数値の前提）",
    input: [[{ venue_code: "9", race_date: "2026-09-22" }], 9, "2026-09-21", "2026-09-23"],
  },
  {
    label: "引数の会場コードが文字列（数値との同一視は未定）",
    input: [TSU_CANCELLED, "9", "2026-09-21", "2026-09-23"],
  },
  {
    label: "時刻つきの日付（受入仕様は未定。現在は文字列比較）",
    input: [[{ venue_code: 9, race_date: "2026-09-21T00:00:00" }], 9, "2026-09-21", "2026-09-22"],
  },
  {
    label: "null 配列（受入仕様は未定。呼出元は cancelled.data ?? [] と既定の [] を使用）",
    input: [null, 9, "2026-09-21", "2026-09-23"],
  },
];

/** 観測: ローダーの導出と、バックフィルの計画が、中止・順延のある節を埋めない */
function skipsSeriesWithCancellation(
  buildMap = buildSeriesDayByVenue,
  plan = planSeriesDayBackfill,
) {
  const after = buildMap(TSU_SERIES, "2026-09-23", {
    cancelledRaces: TSU_CANCELLED,
  });
  const before = buildMap(TSU_SERIES, "2026-09-22", {
    cancelledRaces: TSU_CANCELLED,
  });
  const p = plan({
    races: [
      { race_id: "2026-09-23-09-01", race_date: "2026-09-23", venue_code: 9 },
      { race_id: "2026-09-21-09-01", race_date: "2026-09-21", venue_code: 9 },
    ],
    existingSeriesDay: new Map(),
    seriesRows: TSU_SERIES,
    cancelledRaces: TSU_CANCELLED,
  });
  return (
    !after.has(9) &&
    before.get(9) === 2 &&
    show(p.inserts) ===
      show([{ race_id: "2026-09-21-09-01", series_day: 1 }]) &&
    p.skipped.length === 1 &&
    p.skipped[0].reason === "series_has_cancellation"
  );
}

/** タブのラベル・補い・hasCancellationBefore の境界 */
export function checkTabsAndBoundaries(check) {
  check(
    "タブのラベル: 津（順延・中止を含む8タブ）の最終日は 6日目の次の7（タブの総数8ではない）、2日目は2、順延の日は日目なし（tabsFound=true）。通常の節の最終日はタブの総数（5）、初日は1。タブが無ければ tabsFound=false",
    labelsRead(),
  );
  check(
    "補い: タブが読めて順延・中止の日は、日目の列を行に含めない（既存の値を残す。導出でも null でも上書きしない）。タブが無いときだけ導出で補う。ページの値は常に優先",
    fallbackOnlyWithoutTabs(),
  );
  // hasCancellationBefore を直接呼び、開始日を含み・当日を含まない境界と会場一致を固定する。
  for (const [label, cancelled, venue, start, date, expected] of [
    ["節の中・その日より前", TSU_CANCELLED, 9, "2026-09-21", "2026-09-23", true],
    ["中止の日が開始日（開始日を含む）", TSU_CANCELLED, 9, "2026-09-22", "2026-09-23", true],
    ["中止の日が当日（当日を含まない）", TSU_CANCELLED, 9, "2026-09-21", "2026-09-22", false],
    ["節の開始より前", TSU_CANCELLED, 9, "2026-09-23", "2026-09-24", false],
    ["別の会場", TSU_CANCELLED, 10, "2026-09-21", "2026-09-23", false],
    ["空配列", [], 9, "2026-09-21", "2026-09-23", false],
    ["前の節の中止", [{ venue_code: 9, race_date: "2026-09-20" }], 9, "2026-09-21", "2026-09-23", false],
    ["指定日の中止", [{ venue_code: 9, race_date: "2026-09-23" }], 9, "2026-09-21", "2026-09-23", false],
    ["別会場の行に続く一致行があれば true", [
      { venue_code: 10, race_date: "2026-09-22" },
      { venue_code: 9, race_date: "2026-09-22" },
    ], 9, "2026-09-21", "2026-09-23", true],
  ]) {
    const actual = hasCancellationBefore(cancelled, venue, start, date);
    check(`hasCancellationBefore: ${label}`, actual === expected, show(actual));
  }
}

/** 中止・順延のある節と、(g) の変異検証 */
export function checkCancelledSeries(check) {
  check(
    "中止・順延のある節: 津 9/22 の中止より後（9/23）は、ローダーもバックフィルも導出しない（公式2日目・導出3のずれを書かない）。中止より前（9/21・9/22 自身）は導出してよい",
    skipsSeriesWithCancellation(),
  );
  {
    // 変異検証
    const oldFinal = ($) => {
      const r = scrapeSeriesDay($);
      return r.isFinalDay ? { ...r, seriesDay: r.totalDays } : r;
    };
    const ignoreTabs = (raceId, meta, options) =>
      buildRaceConditionRow(
        raceId,
        { ...meta, seriesDayTabsFound: false },
        options,
      );
    const ignoreCancellations = (series, date) =>
      buildSeriesDayByVenue(series, date);
    const planIgnoring = (input) =>
      planSeriesDayBackfill({ ...input, cancelledRaces: [] });
    check(
      "変異検証の前提: 正しい実装は、ラベル・補い・中止のある節の検証に合格する",
      labelsRead() && fallbackOnlyWithoutTabs() && skipsSeriesWithCancellation(),
    );
    check(
      "変異検証: 「最終日＝タブの総数」版（修正前）では、津の最終日が8になり失敗する",
      !labelsRead(oldFinal),
    );
    check(
      "変異検証: 「タブが読めても導出で補う」版（修正前）では、順延の日に導出の日目が入り失敗する",
      !fallbackOnlyWithoutTabs(ignoreTabs),
    );
    check(
      "変異検証: 「中止・順延を見ない」版（修正前）では、ローダーもバックフィルも津 9/23 を3で埋めて失敗する",
      !skipsSeriesWithCancellation(ignoreCancellations, planSeriesDayBackfill) &&
        !skipsSeriesWithCancellation(buildSeriesDayByVenue, planIgnoring),
    );
  }
}

/** 仕様が未定の入力の今の値を出す（失敗に含めない） */
export function printKnownGaps() {
  console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length} 件（仕様未定・失敗に含めない）`);
  for (const { label, input } of KNOWN_GAPS) {
    let actual;
    try {
      actual = hasCancellationBefore(...input);
    } catch (error) {
      actual = `例外: ${error.name}`;
    }
    console.log(`${label}: 入力=${show(input)}, 今の値=${show(actual)}`);
  }
}
