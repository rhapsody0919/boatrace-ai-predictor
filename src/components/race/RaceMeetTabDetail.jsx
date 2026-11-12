/**
 * RaceMeetTab の「選んだ1艇の詳細」（選手単位）。得点率の見出し・早見の終了の断り・
 * 走りの小さな線と日別の表。値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import { BOAT_COLORS } from "../../utils/colors";
import RacerPageLink from "./RacerPageLink";
import RaceHistoryTable from "./RaceHistoryTable";
import { raceStageLabel } from "../../constants/raceStageConfig";
import { meetRateHidden } from "./seriesPoints";
import { EXCLUDED_LABEL_KEY, rankInBorder } from "./RaceMeetTabModel";
import RaceMeetTabSparks from "./RaceMeetTabSparks";

function BoatChips({ m }) {
  const { t, sortedPlayers, selectedPlayer, onFocusBoat } = m;
  return (
    <div
      className="rmt-chip-row"
      role="group"
      aria-label={t("wakuInfo.boatLabel")}
    >
      {sortedPlayers.map((p) => {
        const color = BOAT_COLORS[p.number] || {};
        const active = selectedPlayer?.number === p.number;
        return (
          <button
            key={p.number}
            type="button"
            className={`rmt-select-chip${active ? " is-active" : ""}`}
            style={
              active ? { background: color.bg, color: color.text } : undefined
            }
            onClick={() => onFocusBoat(p.number)}
            aria-pressed={active}
          >
            <span>{p.number}</span>
            <span translate="no">{p.name?.replace(/\s+/g, "")}</span>
          </button>
        );
      })}
    </div>
  );
}

// 目安との距離の文。順位の対象外（賞典除外・途中帰郷）は目安との距離を言わない。
// rank が null なので `<= slots` で比べると「目安の中」になる（BOA-587）
function borderDistanceText(m) {
  const { t, mine, slots, border } = m;
  if (mine.withdrawn)
    return t(
      `meetTab.${EXCLUDED_LABEL_KEY[mine.excludedReason] ?? "withdrawn"}Title`,
    );
  return rankInBorder(mine, slots)
    ? t("basicInfo.meetBorderIn", { slots })
    : t("basicInfo.meetBorder", {
        slots,
        rate: border.toFixed(2),
        diff: (border - mine.rate).toFixed(2),
      });
}

function scoreSourceText(m) {
  const { t, mine } = m;
  // 公式の得点率一覧がある開催では公式の値をそのまま出している。
  // 出典を「当社計算」と書いたままにすると嘘になる（BOA-475）
  // 当社計算に公式の前夜の減点を足したときは、それも出典に書く。
  // 「当社計算」だけだと着順の点と合わず、計算違いに読まれた（BOA-782 ファン評価3周目）
  return mine.fromOfficial
    ? t("meetTab.sourceOfficial")
    : mine.penaltyFromOfficial > 0
      ? t("meetTab.sourceOwnWithPenalty", { points: mine.penaltyFromOfficial })
      : t("meetTab.sourceOwn");
}

function DetailScore({ m }) {
  const { t, mine, prelimOver, showBorder, border } = m;
  return (
    <p className="rmt-detail-score">
      {t(prelimOver ? "basicInfo.meetScorePrelimOver" : "basicInfo.meetScore", {
        rate: meetRateHidden(mine) ? "—" : mine.rate.toFixed(2),
        n: mine.runs,
        source: scoreSourceText(m),
      })}
      {/* 順位の対象外（賞典除外・途中帰郷）の理由は、予選が終わった後も出す。
          目安の行は予選中しか出ないので、そちらに頼ると最終日に消えていた
          （ファン評価2周目） */}
      {mine.withdrawn && !(showBorder && border !== undefined) && (
        <span className="rmt-detail-border">
          {t(
            `meetTab.${EXCLUDED_LABEL_KEY[mine.excludedReason] ?? "withdrawn"}Title`,
          )}
        </span>
      )}
      {showBorder && border !== undefined && (
        <span className="rmt-detail-border">{borderDistanceText(m)}</span>
      )}
    </p>
  );
}

// 早見（6艇分）は予選中しか出さないので、終わっている理由をここに出す。
// 「もう動かない」は勝負駆けの読みを決める情報なので、補足より一段強く出す
// （BOA-636。375pxで10.4pxの灰色だった）
function ForecastSettled({ m }) {
  const { t, language, isAfterPrelim, stage, prelimEndDay, prelimEndDate } = m;
  const { sp, mdList, noRaceDaysBeforePrelimEnd } = m;
  return (
    <p className="rmt-forecast rmt-forecast-settled">
      {isAfterPrelim
        ? t("basicInfo.meetScoreNoForecast", {
            // 公式の日本語の種別名（準優勝戦等）をそのまま入れていた。ja 以外では
            // 見出しのチップと同じ区分の訳にする（BOA-713。ko で「準優勝戦」の漢字が
            // 2位決定戦と読まれ、チップの「준결승전」とも食い違っていた）
            stage: raceStageLabel(stage, t, language)?.text ?? stage,
          })
        : t(
            prelimEndDay
              ? "meetTab.prelimOverNoteDay"
              : "meetTab.prelimOverNote",
            { date: prelimEndDate ?? "", day: prelimEndDay ?? "" },
          )}
      {/* 丸一日中止の日は日目に数えない（公式も翌日に同じ日目を振り直す）。
          書かないと、初日から日付を数えて「1日ずれている」と読まれる
          （BOA-636、PR #1044 ファン評価） */}
      {!isAfterPrelim && noRaceDaysBeforePrelimEnd.length > 0 && (
        <>
          {sp}
          {t("meetTab.prelimNoRaceDays", {
            days: mdList(noRaceDaysBeforePrelimEnd),
          })}
        </>
      )}
    </p>
  );
}

function DetailHeader({ m }) {
  const { t, mine, absentDetailText, isCancelled, prelimOver } = m;
  return (
    <>
      {/* 全走欠場の選手は得点率の見出しが出ない。何も書かないと「取り忘れ」と
          読まれるので、欠場だと書く（BOA-504 ファン評価） */}
      {absentDetailText && (
        <p className="rmt-detail-score">{absentDetailText}</p>
      )}
      {mine && <DetailScore m={m} />}
      {/* 中止のレースでは早見・目安を出さないので、その理由をここに出す（BOA-658。
          丸一日中止の日に、前日までの数字で「今日の着順でこう動く」が出ていた） */}
      {isCancelled && (
        <p className="rmt-forecast rmt-forecast-settled">
          {t("meetTab.cancelledNoForecast")}
        </p>
      )}
      {mine && !isCancelled && prelimOver && <ForecastSettled m={m} />}
    </>
  );
}

function MeetRuns({ m }) {
  const { t, localize, meetRows, stRankByRace } = m;
  return (
    <>
      <RaceMeetTabSparks m={m} />
      {/* 展示は「初日→直近」の2点比較で上向き/下向きと断定していたが、
          間の走を捨てるため実態と逆の結論になっていた（2026-09-27の
          実測: 6.86→6.89→6.77→6.78→6.88→6.81→6.76→6.87 で
          「1つ下向き」と出るが、今節ベスト級は間にある）。
          判定はやめ、走ごとの生の数字を表に並べて読み手に委ねる */}
      <RaceHistoryTable
        rows={meetRows.map((r) => ({
          ...r,
          startTimingRank: stRankByRace[r.raceId] ?? null,
        }))}
        showEntryCourse
        showExhibition
        compactDate
        omitColumns={["venue", "raceTitle", "grade", "stage"]}
        buildRaceHref={(id) => localize(`/race/${id}`)}
      />
      <details className="rmt-how">
        <summary>{t("basicInfo.conditionsHowToRead")}</summary>
        <p className="rmt-caveat">{t("basicInfo.meetScoreNote")}</p>
      </details>
    </>
  );
}

function DetailBody({ m }) {
  const { t, records, meet, isCancelled } = m;
  if (records === undefined)
    return <p className="rmt-loading">{t("basicInfo.loading")}</p>;
  if (meet.length === 0)
    return (
      <p className="rmt-empty">
        {t(isCancelled ? "meetTab.meetEmptyCancelled" : "basicInfo.meetEmpty")}
      </p>
    );
  return <MeetRuns m={m} />;
}

export default function RaceMeetTabDetail({ m }) {
  const { selectedPlayer } = m;
  return (
    <>
      {/* 2. 選んだ1艇の詳細 */}
      <BoatChips m={m} />
      <div className="rmt-card">
        {/* 選手ページへ（BOA-879）。表・チップは艇を選ぶボタンのまま、選んだ艇の詳細の一番上に置く */}
        <RacerPageLink
          racerId={selectedPlayer?.racerId}
          name={selectedPlayer?.name}
        />
        <DetailHeader m={m} />
        <DetailBody m={m} />
      </div>
    </>
  );
}
