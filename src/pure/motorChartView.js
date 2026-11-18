/**
 * モーター調子（MotorConditionChart）の系列・列の整形（RA21、画面の部品から移した。振る舞いは変えない）。
 * src/pure は根の外を読めない（verify-pure-imports）ので、src/utils の部品（motorRateView・bestOf・
 * isClippedByGeneration・getTodayJST）は呼ぶ側が deps で渡す。文言の t も呼ぶ側の i18n の関数を渡す。
 * JSX の札（venueStatsFailedCell）は画面の側で作る。verify-motor-*（verifyData を含む）が画面の本文を字で読む行
 * （motorRateView の map・generation_power_index・推移グラフの先頭の 0・officialTallyState・使用履歴の向き・
 * 出典注記の列名・期間トグル）は画面の側に残した。
 */

// 展示タイムの推移グラフの元データ（展示の無い日は描かない）
export function exhibitionChartDataOf(trendData) {
  return (trendData?.trend ?? [])
    .filter((row) => row.exhibition_time !== null)
    .map((row) => ({
      date: row.date.slice(5),
      exhibition_time: row.exhibition_time,
    }));
}

// 2連率の列の値ラベル（BOA-830）
function rateLabelOf(t, officialRates, view, i) {
  if (view.kind === "notRun") return t("analysis.motor.freshNotRun");
  if (view.kind === "zero")
    return t("analysis.motor.freshZeroRuns", { n: view.runs });
  return officialRates[i] !== null ? `${officialRates[i].toFixed(1)}%` : "-";
}

// 棒にする2連率と、その値ラベル・最良の印。rateViews（行ごとの motorRateView）は画面の側で作って渡す
export function computeRateView(
  { breakdown, rateViews, freshness, explainBoat, t },
  { motorRateView, bestOf },
) {
  const officialRates = rateViews.map((v) =>
    v.kind === "official" || v.kind === "own"
      ? v.value
      : v.kind === "zero"
        ? 0
        : null,
  );
  const officialRateValues = officialRates.filter((v) => v !== null);
  const officialRateMax =
    officialRateValues.length > 0 ? Math.max(...officialRateValues) : null;
  // 最良の値ラベル（UI統一ルール R1）。判定はレース詳細の他の表と同じ bestOf（同じ値の最良は全部、
  // 全艇同値・値なしなら付けない）。表示と同じ1桁で比べる。生の値だと「38.3」に見える 38.33 と
  // 38.28 の片方にだけ印が付く（9/15〜10/02 で14レース。データ精度検証）。
  // 行全体の .best-motor（期間の2連率の最大）は外した。棒の札と別の列を指すと、どちらが最良か
  // 分からないため（BOA-428、UI統一レーンと合意）。
  // 自前の値（数走の 100% 等）は公式と並べて最良にしない（BOA-830）
  const officialRateBestBoats = bestOf(
    breakdown.map((r, i) => ({
      boat: r.boat_number,
      value: rateViews[i].kind === "official" ? officialRates[i] : null,
    })),
    "max",
    { digits: 1 },
  );
  const rateLabel = (view, i) => rateLabelOf(t, officialRates, view, i);
  // 新しいモーターの最初の節（その日の公式2連率が全行 0）。優出・優勝はまだ機会が無いので「-」
  const firstMeet = freshness?.firstMeet === true;
  const explainRow =
    explainBoat !== null
      ? breakdown.find((r) => r.boat_number === explainBoat)
      : null;
  const explainView = explainRow ? motorRateView(explainRow) : null;
  return {
    rateViews, officialRates, officialRateMax, officialRateBestBoats, rateLabel,
    firstMeet, explainRow, explainView,
  };
}

// 一覧の列を出すか（優出数・優勝数・1着率・前検タイム）。失敗の札（JSX）は画面の側で足す
export function computeStatColumns(breakdown) {
  // kyoteibiyori等の会場出走表に倣い、優出数・優勝数・1着率は艇ごとの
  // 単一バッジではなく、同じレースの全艇を横並びで比較できる列として表示する
  // （1位・2位を色分けするのも合わせて模倣。BOA-264追加調査）
  const firstPlaceRates = breakdown.map((r) =>
    r.race_count && r.first_place_count !== null
      ? (r.first_place_count / r.race_count) * 100
      : null,
  );
  // 全艇が null（その会場・その節で1着率が取れていない）の列は出さない。
  // 「-」だけが6行並んで横幅を50px食い、肝心の2連率・機力指数を画面外へ
  // 押し出していた（2026-09-27、ファン視点のレビュー。条件別タブで
  // n=0の行を畳んだBOA-432と同じ考え方）
  // 会場公式のモーター成績の取得に失敗した行があるとき（BOA-740）は、列を畳まず、その行に「取得失敗」を出す。
  // 畳むと「この会場は公式が出していない」と同じ見た目になり、失敗が見えない
  const venueStatsFailed = breakdown.some((r) => r.venue_stats_failed);
  const showFirstPlaceRate =
    venueStatsFailed || firstPlaceRates.some((v) => v !== null);
  // 優出数・優勝数も、会場の全モーターで値が無い（会場公式サイトが出していない）ときは
  // 列ごと畳む。「-」が並ぶと「0回」と読まれる（BOA-513、ファン4人のパネル）
  const showFinalCount =
    venueStatsFailed ||
    breakdown.some(
      (r) => r.final_count !== null && r.final_count !== undefined,
    );
  const showChampionshipCount =
    venueStatsFailed ||
    breakdown.some(
      (r) =>
        r.championship_count !== null && r.championship_count !== undefined,
    );
  // 前検タイムも同じ扱い（BOA-451）。節に前検の行が無い開催では列ごと出さない
  // （ADR-0067 の 2026-09-26 追記「節に前検の行が無い場合は行ごと出さない」と同じ）
  const hasPretest = breakdown.some(
    (r) => r.pretest_time !== null && r.pretest_time !== undefined,
  );
  return {
    firstPlaceRates, venueStatsFailed, showFirstPlaceRate, showFinalCount,
    showChampionshipCount, hasPretest,
  };
}

// 1位だけを金で示す（同値は全部、全艇同値なら無し）。以前は2位も薄い金で示していたが、
// レース詳細の色分けのルール（最良だけ金。docs/design/race-detail-ui-unify R1）にそろえた。
// 引数は breakdown の行番号
function rankClassFor(bestOf, highlightBestSets, values, digits) {
  const best = bestOf(
    values.map((value, i) => ({ boat: i, value })),
    "max",
    { digits },
  );
  highlightBestSets.push(best);
  return (i) => (best.has(i) ? "motor-stat-rank1" : "");
}

export function computeRankClasses(breakdown, firstPlaceRates, { bestOf }) {
  const highlightBestSets = [];
  const finalCountRankClass = rankClassFor(
    bestOf,
    highlightBestSets,
    breakdown.map((r) => r.final_count),
    0,
  );
  const championshipCountRankClass = rankClassFor(
    bestOf,
    highlightBestSets,
    breakdown.map((r) => r.championship_count),
    0,
  );
  const firstPlaceRateRankClass = rankClassFor(bestOf, highlightBestSets, firstPlaceRates, 1);
  const hasHighlightedCell = highlightBestSets.some((best) => best.size > 0);
  return {
    finalCountRankClass, championshipCountRankClass, firstPlaceRateRankClass,
    hasHighlightedCell,
  };
}

// 期間を選んで中身が変わるか・期間を切り詰めたか（期間トグルを出すかは画面の側）
export function computePeriodClip(m, { getTodayJST, isClippedByGeneration }) {
  const { breakdown, drillDownMotor, generationStart, powerIndex, trendData } = m;
  // 入れ替えから1ヶ月以内は「直近1ヶ月」まで使用開始日で切り詰められ、どちらの
  // 期間を選んでも中身が同じになる。押しても変わらないボタンは出さない
  // （2026-09-29 ファン評価。使用開始日の行と切り詰めの注記は出す）
  const periodChoiceHasEffect = !isClippedByGeneration(
    generationStart,
    getTodayJST(),
    30,
  );
  // 期間を現行モーターの使用開始日で切り詰めたか（入れ替え後で期間が短い）
  const clippedByGeneration =
    drillDownMotor === null
      ? breakdown.some((r) => r.clipped_by_generation)
      : Boolean(
          powerIndex?.clipped_by_generation || trendData?.clippedByGeneration,
        );
  return { periodChoiceHasEffect, clippedByGeneration };
}
