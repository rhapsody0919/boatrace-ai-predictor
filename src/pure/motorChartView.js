/**
 * モーター調子（MotorConditionChart）の系列・列の整形（RA21、画面の部品から移した。振る舞いは変えない）。
 * src/pure は根の外を読めない（verify-pure-imports）ので、src/utils の部品（motorRateView・bestOf・
 * isClippedByGeneration・getTodayJST・officialTallyState・exhibitionTimeAxis）は呼ぶ側が deps で渡す。
 * 文言の t も呼ぶ側の i18n の関数を渡す。JSX の札（venueStatsFailedCell・会場内順位のセル）は画面の側で作る。
 * verify-motor-*（verifyData を含む）は画面の本文とこのファイルの本文を合わせて字で読む
 * （verifyData/motorChartSource.js）。画面の側に残すのは motorRateView の map（breakdown.map(motorRateView)）だけ。
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

// 2連率・3連率の推移グラフの元データ
function rateChartData(trendData, firstRatedIndex, drillTallyState) {
  return (
    firstRatedIndex === -1
      ? drillTallyState === "tallied"
        ? (trendData?.trend ?? [])
        : []
      : (trendData?.trend ?? []).slice(firstRatedIndex)
  ).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
  }));
}

// 使用履歴は新しい順の一覧だが、グラフは推移グラフと同じく左が古く右が新しい
// 向きにそろえる（逆向きだと「右肩下がり＝最近悪化」と読み違える。BOA-513）
function usageChartData(usageHistory) {
  const usageHistoryChartData = [...usageHistory]
    .reverse()
    .filter((meet) => meet.rate2 !== null)
    .map((meet) => ({
      date: meet.playerName?.replace(/\s+/g, "") ?? "",
      rate2: meet.rate2,
      rate3: meet.rate3,
    }));
  return usageHistoryChartData;
}

function emptyKeyOf(drillFirstRun, key) {
  return drillFirstRun ? "analysis.motor.drillFirstRunEmpty" : key;
}

// 推移グラフ・展示タイム・使用履歴グラフの元データ
export function computeTrendView(
  { trendData, breakdown, venueMotorStats, powerIndex, usageHistory },
  { officialTallyState, exhibitionTimeAxis },
) {
  // 入れ替え直後は、公式の累計がまだ付かず 2連率・3連率とも 0 の日が続く。この先頭の
  // 0 の点は「1回も連に絡まなかった」と読めるので描かない（BOA-513、ファン4人のパネル）
  const firstRatedIndex = (trendData?.trend ?? []).findIndex(
    (row) => row.motor_2rate !== 0 || row.motor_3rate !== 0,
  );
  // 全部の点が 0 のとき、集計前（最初の節がまだ終わっていない）なら線を引かない。
  // 0% の横線は「一度も2着以内に来ていない」と読まれる（2026-09-29 ファン評価 P1）。
  // 集計済みで本当に 0%（前の節で3着以内に入らなかった）なら、0 の線を引く。
  // 区別には会場公式サイトの出走数を使う（officialTallyState）
  const venueHasOfficialStats = breakdown.some(
    (r) => r.race_count !== null && r.race_count !== undefined,
  );
  // 会場公式の成績が取れなかったとき（BOA-740）は出走数が無いだけなので、「集計前」とは断定しない
  const drillTallyState = officialTallyState(
    venueHasOfficialStats && !venueMotorStats?.fetchFailed,
    venueMotorStats?.raceCount,
  );
  const chartData = rateChartData(trendData, firstRatedIndex, drillTallyState);

  const exhibitionChartData = exhibitionChartDataOf(trendData);
  // このレースがこのモーターの初出走（直前までの走りが0）。「データが見つかりません」
  // だと取得失敗と区別できないので、理由を書く（BOA-557 ファン評価2周目）
  const drillFirstRun =
    powerIndex?.sample_count === 0 && usageHistory.length === 0;
  const emptyKey = (key) => emptyKeyOf(drillFirstRun, key);
  const exhibitionAxis = exhibitionTimeAxis(
    exhibitionChartData.map((row) => row.exhibition_time),
  );

  const usageHistoryChartData = usageChartData(usageHistory);
  return {
    firstRatedIndex, drillTallyState, chartData, exhibitionChartData,
    emptyKey, exhibitionAxis, usageHistoryChartData,
  };
}

// 一覧の機力指数（BOA-830。呼ぶ側の computeRateView が listPowerIndex として渡す）
export function listPowerIndexOf(row) {
  return row.rate_source === "official"
    ? {
        value: row.generation_power_index ?? null,
        n: row.generation_runs ?? null,
      }
    : { value: row.power_index ?? null, n: row.sample_count };
}

// 会場公式サイト由来で、表に出ている列の名前（出典の注記に挙げる）
export function makeVenueColsLabel(t, cols) {
  const { showFirstPlaceRate, showFinalCount, showChampionshipCount } = cols;
  const venueColsLabel = [
    showFirstPlaceRate && "analysis.motor.firstPlaceRateHeader",
    showFinalCount && "analysis.motor.finalCountHeader",
    showChampionshipCount && "analysis.motor.championshipCountHeader",
  ]
    .filter(Boolean)
    .map((key) => t("analysis.motor.quotedLabel", { label: t(key) }))
    .join(t("analysis.motor.quotedLabelSeparator"));
  return venueColsLabel;
}

// 期間トグルを出すか・期間を切り詰めたか
export function computePeriodView(m, { getTodayJST, isClippedByGeneration }) {
  const { breakdown, selectedRace, drillDownMotor, drillPreGeneration } = m;
  // 過去レースの一覧表は出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）。
  // 期間の切り替えは効かないので出さず、1行の注記に置き換える
  const officialMode = breakdown.some((r) => r.rate_source === "official");
  const isPastSelectedRace =
    Boolean(selectedRace) && selectedRace.slice(0, 10) < getTodayJST();
  // 過去レースは、一覧でもドリルダウンでも期間を選ばせない（90日固定）。
  // ドリルダウンだけ選べると、押すだけで機力指数の評価が「実力以上」⇔「低調」に
  // 反転し、一覧の「期間は選べません」とも食い違う（2026-09-29 ファン評価2周目）
  const showPeriodToggle =
    drillDownMotor === null
      ? !officialMode
      : !drillPreGeneration && !isPastSelectedRace;
  return {
    officialMode, showPeriodToggle, ...computePeriodClip(m, { getTodayJST, isClippedByGeneration }),
  };
}
