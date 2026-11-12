/**
 * RaceBeforeInfoTab の「展示情報」表に足す行（今節のオリジナル展示・展示1位勝率・今節の展示）。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import {
  computeExhibitionTopRates,
  recordsBeforeRace,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import { bestOf } from "../../utils/bestOf";

const smallSampleClass = (n) =>
  n !== null && n > 0 && n < SMALL_SAMPLE_THRESHOLD ? "drt-n-small-sample" : "";

// 取得中は従来の凡例を保ち、全艇の今節に比較値が無いときだけ説明を省く。
export function hasNoMeetComparison(
  sortedPlayers,
  meetTrendByRacer,
  meetOriginalRows,
) {
  const meetTargets = sortedPlayers.filter((p) => p.racerId && p.motorNumber);
  return (
    meetTargets.length > 0 &&
    meetTargets.every((p) => {
      const trend = meetTrendByRacer[p.racerId];
      return (
        trend !== undefined &&
        !(trend ?? []).some((e) => e.exhibitionTime !== null)
      );
    }) &&
    meetOriginalRows.length === 0
  );
}

function renderExhibitionTopRateCell({
  p,
  t,
  raceId,
  scopedStatsByRacer,
  bestExhibitionTopRate,
}) {
  if (!p.racerId) return "—";
  const state = scopedStatsByRacer[p.racerId];
  if (state === undefined)
    return <span className="drt-skeleton" aria-hidden="true" />;
  // null＝取得失敗。「展示1位なし」に化けさせず「—」にする
  // （失敗はカード側の InlineFetchError が知らせる）
  if (state === null) return "—";
  // 表示中のレースより前の走だけ（BOA-605）。過去のレースで、そのレース自身や
  // 後日の走の「展示1位で勝った」が入っていた
  const rates = computeExhibitionTopRates(recordsBeforeRace(state, raceId));
  if (rates.n === 0)
    return (
      <span className="drt-sub">{t("beforeInfo.noFastestExhibition")}</span>
    );
  return (
    <span className="drt-value">
      <span
        className={`drt-sub${bestExhibitionTopRate.has(p.number) ? " ind-best" : ""}`}
      >
        {t("beforeInfo.winRateAbbrev")} {rates.winRate.toFixed(0)}%
      </span>
      <span className="drt-sub">
        {t("beforeInfo.top2RateAbbrev")} {rates.top2Rate.toFixed(0)}%
      </span>
      <span className="drt-sub">
        {t("beforeInfo.top3RateAbbrev")} {rates.top3Rate.toFixed(0)}%
      </span>
      <span className={`drt-sub ${smallSampleClass(rates.n)}`}>
        {/* 件数が少ない参考値に⚠（注記の説明と対応させる。PR #1193 ファン評価1周目） */}
        {rates.n < SMALL_SAMPLE_THRESHOLD && "⚠"}
        {t("beforeInfo.sampleCount", { n: rates.n })}
      </span>
    </span>
  );
}

function renderMeetExhibitionCell({
  p,
  t,
  meetTrendByRacer,
  bestMeetExhibition,
}) {
  if (!p.racerId || !p.motorNumber) return "—";
  const state = meetTrendByRacer[p.racerId];
  if (state === undefined)
    return <span className="drt-skeleton" aria-hidden="true" />;
  const trend = (state ?? []).filter((e) => e.exhibitionTime !== null);
  if (trend.length === 0)
    return (
      <span className="drt-sub drt-nowrap">{t("dataTable.meetFirstRace")}</span>
    );
  const prev = trend[trend.length - 1].exhibitionTime;
  const avg =
    trend.reduce((sum, e) => sum + e.exhibitionTime, 0) / trend.length;
  return (
    <span className="drt-value">
      <span
        className={`drt-sub${bestMeetExhibition.has(p.number) ? " ind-best" : ""}`}
      >
        {t("beforeInfo.prevAbbrev")} {prev.toFixed(2)}
      </span>
      <span className="drt-sub">
        {t("beforeInfo.avgAbbrev")} {avg.toFixed(2)}
      </span>
    </span>
  );
}

// 「展示タイム1位勝率」の6艇の最良（race-detail-ui-unify FR-5、R1）。
// 展示1位勝率はセルの先頭に出す1着率（高いほど良い、0桁）で比べ、件数が少ない艇（⚠）は
// 比べるが最良でも光らせない（繰り下げない）
function bestExhibitionTopRateOf(sortedPlayers, scopedStatsByRacer, raceId) {
  const exhibitionTopRateOf = (p) => {
    const state = p.racerId ? scopedStatsByRacer[p.racerId] : null;
    if (!Array.isArray(state)) return null;
    const rates = computeExhibitionTopRates(recordsBeforeRace(state, raceId));
    return rates.n === 0 ? null : rates;
  };
  return bestOf(
    sortedPlayers.map((p) => {
      const rates = exhibitionTopRateOf(p);
      return {
        boat: p.number,
        value: rates?.winRate ?? null,
        hidden: rates !== null && rates.n < SMALL_SAMPLE_THRESHOLD,
      };
    }),
    "max",
    { digits: 0 },
  );
}

// 今節の展示はセルの先頭に出す前走の展示タイム（低いほど良い、2桁）で比べる
function bestMeetExhibitionOf(sortedPlayers, meetTrendByRacer) {
  const meetExhibitionPrevOf = (p) => {
    if (!p.racerId || !p.motorNumber) return null;
    const trend = (meetTrendByRacer[p.racerId] ?? []).filter(
      (e) => e.exhibitionTime !== null,
    );
    return trend.length === 0 ? null : trend[trend.length - 1].exhibitionTime;
  };
  return bestOf(
    sortedPlayers.map((p) => ({
      boat: p.number,
      value: meetExhibitionPrevOf(p),
    })),
    "min",
    { digits: 2 },
  );
}

export function buildExtraRows({
  t,
  raceId,
  sortedPlayers,
  scopedStatsByRacer,
  meetTrendByRacer,
  meetOriginalRows,
}) {
  const bestExhibitionTopRate = bestExhibitionTopRateOf(
    sortedPlayers,
    scopedStatsByRacer,
    raceId,
  );
  const bestMeetExhibition = bestMeetExhibitionOf(
    sortedPlayers,
    meetTrendByRacer,
  );
  return [
    {
      key: "exhibitionTopRate",
      label: t("beforeInfo.rowExhibitionTopRate"),
      shortLabel: t("beforeInfo.rowExhibitionTopRateShort"),
      tab: null,
      // 金枠はセル全体ではなく1着率の値だけに付ける（2連対・3連対は比べていない）
      best: null,
      render: (p) =>
        renderExhibitionTopRateCell({
          p,
          t,
          raceId,
          scopedStatsByRacer,
          bestExhibitionTopRate,
        }),
    },
    {
      key: "meetExhibitionTrend",
      label: t("beforeInfo.rowMeetExhibition"),
      shortLabel: t("beforeInfo.rowMeetExhibitionShort"),
      tab: null,
      // 金枠はセル全体ではなく前走の値だけに付ける。セルごとだと平均まで太字の
      // 金枠に入り、平均でも最良と読まれた（PR #1193 ファン評価1周目）
      best: null,
      render: (p) =>
        renderMeetExhibitionCell({
          p,
          t,
          meetTrendByRacer,
          bestMeetExhibition,
        }),
    },
    // 今節のオリジナル展示（BOA-473）。展示タイムの前走・平均と同じ形で、
    // 一周・半周ラップ・まわり足・直線も出す。**そのレースの展示が発表される前でも
    // 読める**のがこの行の役割（「展示情報」表のオリジナル展示は発走30〜10分前まで出ない）。
    // 取れた種別のぶんだけ行を作り、096未適用・未取得のときは行ごと出さない
    ...meetOriginalRows,
  ];
}
