/**
 * RaceBeforeInfoTab - レース詳細ページ「直前情報」タブ（BOA-304）
 *
 * DataRaceTable（基本情報、過去実績系）から「当日更新・レース前は未確定」の
 * 4指標（展示ST・展示タイム・チルト・調整重量）を分離し、性質の異なるデータを
 * 混在させない。あわせて表示欠落だった気象情報（race_conditions）を追加し、
 * モーター調子ドリルダウン（BOA-221、部品交換/プロペラ交換履歴）への参照導線を
 * 置く。選手コメント（BOA-273未実装）・今節展示情報の周回/周り足/直線タイム
 * 内訳（BOA-266）・スタート展示の並び（BOA-290）・潮汐（BOA-295）はデータが
 * 無いためスコープ外（ダミー表示は作らない）。
 *
 * 行の定義・レンダリングロジックはDataRaceTableと同じraceIndicators.jsx
 * （buildBeforeInfoRows）を共有し、二重実装を避ける。
 *
 * 2026-09-16追記(ユーザーによる日和再調査後のフィードバック): 除外理由の無い
 * 抜けが4つ見つかったため追加した。いずれも新規スクレイピング不要、既存データの
 * 集計のみ:
 * - 展示タイム1位勝率（と、BOA-485で平均進入順を置き換えた「この枠からの
 *   進入コース」カード）: RaceBasicInfoTab（BOA-306）と同じ
 *   getRacerScopedRaceStats(racerId)の生データ（既にactualCourse/
 *   isFastestExhibitionを追加済み）をこのタブでも取得し、basicInfoStats.jsの
 *   computeFrameEntryDistribution/computeExhibitionTopRatesで集計する
 * - 今節展示情報（展示タイムのみ）: getRacerMeetExhibitionTrendBefore。今節タブと
 *   同じ節判定（groupIntoMeetBeforeRace、会場で絞り表示中のレースを目印にする）
 *
 * 2026-09-24（phase a FR-5 / BOA-222）に「本日の成績サマリー」をこのタブから
 * 外した。粒度（レース単位ではなく会場×当日単位）と更新タイミング（発走前に
 * 確定していくのではなく、レースが終わるたびに増える事後集計）が、このタブの
 * 他の項目とずれていたため。移設先は結果タブ（払戻の下）と会場ページで、
 * 実装は VenueDaySummaryCard。getVenueDaySummary の呼び出しもそちらへ移した
 */
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import {
  buildBeforeInfoRows,
  buildExhibitionCourseRow,
  exhibitionCourseCapturedAt,
  hasExhibitionCourse,
  isExhibitionCourseOutOfRange,
  toNumber,
} from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import InlineFetchError from "../InlineFetchError";
import "./RaceBeforeInfoTab.css";
import { bestOf } from "../../utils/bestOf";
import { formatCapturedAtJst } from "../../utils/formatters";
import { hasDistinctTurnTime } from "../../utils/turnTimeVenues";
import { parseRaceId } from "../../utils/raceId";
import { useBeforeInfoFetches } from "./RaceBeforeInfoTabFetch";
import { buildExtraRows, hasNoMeetComparison } from "./RaceBeforeInfoTabRows";
import RaceBeforeInfoTabChart from "./RaceBeforeInfoTabChart";
import RaceBeforeInfoTabWeather from "./RaceBeforeInfoTabWeather";
import RaceBeforeInfoTabTable from "./RaceBeforeInfoTabTable";
import RaceBeforeInfoTabNotes from "./RaceBeforeInfoTabNotes";
import RaceBeforeInfoTabCards from "./RaceBeforeInfoTabCards";

/**
 * 今節展示情報に出すオリジナル展示の種別（BOA-473）。
 * 「展示情報」表の行（`raceIndicators.jsx` の `ORIGINAL_EXHIBITION_ROW_META`）と
 * 同じ4種で、ラベルだけ「今節◯◯」に変える
 */
const MEET_ORIGINAL_KINDS = Object.freeze([
  { kind: "一周", key: "meetOriLap", labelKey: "beforeInfo.rowMeetOriLap" },
  {
    kind: "半周ラップ",
    key: "meetOriHalfLap",
    labelKey: "beforeInfo.rowMeetOriHalfLap",
  },
  {
    kind: "まわり足",
    key: "meetOriTurn",
    labelKey: "beforeInfo.rowMeetOriTurn",
  },
  {
    kind: "直線",
    key: "meetOriStraight",
    labelKey: "beforeInfo.rowMeetOriStraight",
  },
]);

// 1選手・1種別の「前走」「節平均」。値が無ければ null
const meetOriginalValueFor = (p, kind, meetOriginal, meetTrendByRacer) => {
  const trend = meetTrendByRacer[p.racerId];
  if (!Array.isArray(trend)) return null;
  const series = trend
    .map((e) => meetOriginal.byKey?.[`${e.raceId}-${e.boatNumber}`])
    .map((v) => toNumber(v?.[kind.kind]))
    .filter((v) => v !== null);
  if (series.length === 0) return null;
  return {
    prev: series[series.length - 1],
    avg: series.reduce((sum, v) => sum + v, 0) / series.length,
  };
};

function renderMeetOriginalCell({
  p,
  t,
  valueFor,
  meetTrendByRacer,
  bestPrev,
}) {
  if (!p.racerId || !p.motorNumber) return "—";
  if (meetTrendByRacer[p.racerId] === undefined)
    return <span className="drt-skeleton" aria-hidden="true" />;
  const v = valueFor(p);
  if (!v)
    return (
      <span className="drt-sub drt-nowrap">{t("dataTable.meetFirstRace")}</span>
    );
  return (
    <span className="drt-value">
      <span className={`drt-sub${bestPrev.has(p.number) ? " ind-best" : ""}`}>
        {t("beforeInfo.prevAbbrev")} {v.prev.toFixed(2)}
      </span>
      <span className="drt-sub">
        {t("beforeInfo.avgAbbrev")} {v.avg.toFixed(2)}
      </span>
    </span>
  );
}

function buildMeetOriginalRow({ kind, t, sortedPlayers, ...ctx }) {
  const valueFor = (p) =>
    meetOriginalValueFor(p, kind, ctx.meetOriginal, ctx.meetTrendByRacer);
  const anyValue = sortedPlayers.some((p) => valueFor(p) !== null);
  if (!anyValue) return null;
  // 前走の最良（どれもタイムで低いほど良い、2桁）に金枠。「今節展示」と同じ規則で、
  // 比べた前走の値だけを囲む（2026-10-03 ユーザー判断、BOA-711）
  const bestPrev = bestOf(
    sortedPlayers.map((p) => ({
      boat: p.number,
      value: p.racerId && p.motorNumber ? (valueFor(p)?.prev ?? null) : null,
    })),
    "min",
    { digits: 2 },
  );
  return {
    key: kind.key,
    label: t(kind.labelKey),
    shortLabel: t(kind.labelKey),
    tab: null,
    best: null,
    render: (p) =>
      renderMeetOriginalCell({
        p,
        t,
        valueFor,
        meetTrendByRacer: ctx.meetTrendByRacer,
        bestPrev,
      }),
  };
}

// 今節のオリジナル展示から、種別ごとに「前走」「節平均」を作る（BOA-473）。
// 値が1つも無い種別は行を作らない（「—」を6つ並べない）
function buildMeetOriginalRows({
  t,
  sortedPlayers,
  meetOriginal,
  meetTrendByRacer,
}) {
  if (meetOriginal?.state !== "published") return [];
  return MEET_ORIGINAL_KINDS.map((kind) =>
    buildMeetOriginalRow({
      kind,
      t,
      sortedPlayers,
      meetOriginal,
      meetTrendByRacer,
    }),
  ).filter(Boolean);
}

const TURN_ROW_KEYS = ["oriTurn", "meetOriTurn"];

// 住之江・尼崎・徳山の「まわり足」は会場独自の計測で、他場と値の水準が違う（11秒台）。
// 行の見出しに「※」を付け、表の下に注記を出す（data-catalog E12）
const markTurnRow = (turnTimeDiffers) => (row) =>
  turnTimeDiffers && TURN_ROW_KEYS.includes(row.key)
    ? {
        ...row,
        label: `${row.label} ※`,
        shortLabel: `${row.shortLabel} ※`,
        turnMark: true,
      }
    : row;

// 「展示情報」表の行と、それに付随する注記・出典の判定
function buildTableView(ctx) {
  const {
    t,
    raceId,
    sortedPlayers,
    analysis,
    originalExhibition,
    entryWeights,
    scopedStatsByRacer,
    meetTrendByRacer,
    meetOriginal,
  } = ctx;
  const meetOriginalRows = buildMeetOriginalRows({
    t,
    sortedPlayers,
    meetOriginal,
    meetTrendByRacer,
  });
  const noMeetComparison = hasNoMeetComparison(
    sortedPlayers,
    meetTrendByRacer,
    meetOriginalRows,
  );
  const extraRows = buildExtraRows({
    t,
    raceId,
    sortedPlayers,
    scopedStatsByRacer,
    meetTrendByRacer,
    meetOriginalRows,
  });

  // 展示進入（BOA-485）はスタート展示の結果なので、展示STの前＝表の先頭に置く
  const exhibitionCourseRow = buildExhibitionCourseRow({
    t,
    raceId,
    motorMaintenance: analysis.motorMaintenance,
    pending: analysis.pending,
  });
  const turnTimeDiffers = hasDistinctTurnTime(parseRaceId(raceId)?.venueCode);
  const rows = [
    ...(exhibitionCourseRow ? [exhibitionCourseRow] : []),
    ...buildBeforeInfoRows({
      t,
      players: sortedPlayers,
      analysis,
      pending: analysis.pending,
      originalExhibition,
      entryWeights,
    }),
    ...extraRows,
  ].map(markTurnRow(turnTimeDiffers));
  return {
    rows,
    noMeetComparison,
    turnTimeDiffers,
    showTurnTimeNote:
      turnTimeDiffers && rows.some((r) => TURN_ROW_KEYS.includes(r.key)),
    exhibitionCourseOutOfRange: isExhibitionCourseOutOfRange(
      raceId,
      analysis.motorMaintenance,
    ),
    exhibitionCourseTime: formatCapturedAtJst(
      exhibitionCourseCapturedAt(analysis.motorMaintenance),
    ),
    hasOriginalExhibitionSource: originalExhibition?.state === "published",
    // 値を1つでも出したときだけ出典を出す（取得時刻は取れたときだけ添える）
    hasExhibitionCourseSource:
      exhibitionCourseRow !== null &&
      hasExhibitionCourse(analysis.motorMaintenance),
  };
}

// 展示前の注記（BOA-484）: 体重・調整重量が出ていて、チルトがまだ1艇も出ていない間。
// チルトは展示航走の後に公開される（2026-09-28、9会場の展示前ページで全て空欄を確認）ため、
// 「—」を未取得の不具合と読まれないようにする。展示後（チルトが出た後）は出さない。
// 直前情報の設定値（exhibition_data）の取得に失敗したときは、チルトが無いのは
// 「未公開」ではなく「取得失敗」なので出さない（失敗は上部の InlineFetchError が示す）。
// 確定済みのレース（展示データが最後まで入らなかった中止・取得漏れ等）にも出さない
function shouldShowPreExhibitionNote(analysis, entryWeights, isFinished) {
  const maintenanceRows = analysis.motorMaintenance ?? [];
  const tiltPublished = maintenanceRows.some((r) => toNumber(r.tilt) !== null);
  const hasPreExhibitionWeight =
    maintenanceRows.some(
      (r) =>
        toNumber(r.today_weight) !== null ||
        toNumber(r.adjustment_weight) !== null,
    ) ||
    (entryWeights.state === "published" &&
      Object.keys(entryWeights.byBoat ?? {}).length > 0);
  return (
    !isFinished &&
    !analysis.pending?.motorMaintenance &&
    !analysis.failed?.motorMaintenance &&
    !tiltPublished &&
    hasPreExhibitionWeight
  );
}

const makeDeepLink = (venueCode, raceId) => (tab) =>
  venueCode && raceId
    ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
    : `/winning-technique?tab=${tab}`;

const onLinkClick = (tab) => () =>
  trackEvent("deep_link_click", {
    tab,
    link_source: "race_before_info_tab",
  });

function RaceBeforeInfoTab({
  focusedBoat = null,
  onFocusBoat,
  raceId,
  venueCode,
  players,
  weather,
  raceGrade,
  isFinished = false,
}) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  const fetched = useBeforeInfoFetches(raceId, venueCode, sortedPlayers);
  const { originalExhibition, entryWeights } = fetched;

  // 展示情報の表は390pxで5号艇までしか入らない。**早期returnより前**に
  // 置く（フックの呼び出し順は毎回同じでなければならない）
  const detailScroll = useHorizontalScrollHint([sortedPlayers.length]);

  if (sortedPlayers.length === 0) return null;

  const view = buildTableView({
    t,
    raceId,
    sortedPlayers,
    analysis,
    originalExhibition,
    entryWeights,
    scopedStatsByRacer: fetched.scopedStatsByRacer,
    meetTrendByRacer: fetched.meetTrendByRacer,
    meetOriginal: fetched.meetOriginal,
  });
  const deepLink = makeDeepLink(venueCode, raceId);

  return (
    <div className="race-before-info-tab" id="race-before-info-tab">
      <p className="rbi-subtitle">{t("beforeInfo.subtitle")}</p>

      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}

      <RaceBeforeInfoTabWeather weather={weather} venueCode={venueCode} />

      <RaceBeforeInfoTabChart
        sortedPlayers={sortedPlayers}
        analysis={analysis}
      />

      <section className="rbi-card">
        <h3 className="rbi-heading">{t("beforeInfo.detailTableTitle")}</h3>
        <RaceBeforeInfoTabTable
          sortedPlayers={sortedPlayers}
          rows={view.rows}
          detailScroll={detailScroll}
          scrollRef={detailScroll.ref}
          deepLink={deepLink}
          onLinkClick={onLinkClick}
        />
        <RaceBeforeInfoTabNotes
          entryWeights={entryWeights}
          sortedPlayers={sortedPlayers}
          analysis={analysis}
          onRetryEntryWeights={fetched.retryEntryWeights}
          showPreExhibitionNote={shouldShowPreExhibitionNote(
            analysis,
            entryWeights,
            isFinished,
          )}
          showTurnTimeNote={view.showTurnTimeNote}
          noMeetComparison={view.noMeetComparison}
          exhibitionCourseOutOfRange={view.exhibitionCourseOutOfRange}
          hasOriginalExhibitionSource={view.hasOriginalExhibitionSource}
          hasExhibitionCourseSource={view.hasExhibitionCourseSource}
          exhibitionCourseTime={view.exhibitionCourseTime}
          originalExhibition={originalExhibition}
        />
      </section>

      <RaceBeforeInfoTabCards
        focusedBoat={focusedBoat}
        onFocusBoat={onFocusBoat}
        raceId={raceId}
        raceGrade={raceGrade}
        sortedPlayers={sortedPlayers}
        fetched={fetched}
        turnTimeDiffers={view.turnTimeDiffers}
        motorLink={deepLink("motor")}
        onMotorLinkClick={onLinkClick("motor")}
      />
    </div>
  );
}

export default RaceBeforeInfoTab;
