import { Link } from "react-router-dom";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import RacerMotorMeetChart from "./RacerMotorMeetChart";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import { formatPowerIndex } from "../../utils/smallSampleRate";
import TermHintButton from "../race/TermHintButton";
import "./RacerMotorStatusCard.css";

const isPresent = (value) => value !== null && value !== undefined;

function freshnessBadges(venueMotorStats) {
  return [
    isPresent(venueMotorStats?.raceCount) && {
      key: "raceCount",
      text: `${venueMotorStats.raceCount}走目`,
    },
    isPresent(venueMotorStats?.meetCount) && {
      key: "meetCount",
      text: `${venueMotorStats.meetCount}節目`,
    },
    // 会場公式のモーター成績が取れなかった（BOA-740）。値が無い会場と同じく黙って消さない
    venueMotorStats?.fetchFailed && {
      key: "fetchFailed",
      text: "取得失敗（再読み込みで取り直します）",
    },
  ].filter(Boolean);
}

// 機力指数は値・期間・走数だけ。良し悪しの言葉と色は付けない（偶然の幅を見ていないため）。
// 読み方は「?」の中（plan.md §14、オーナー 2026-11-28）
function PowerIndexSection({ powerIndex }) {
  return (
    <p className="racer-motor-status-index">
      機力指数 {formatPowerIndex(powerIndex.power_index)}（
      {powerIndex.clipped_by_generation
        ? "現行モーターの使用開始以降"
        : "過去90日"}
      ・{powerIndex.sample_count}走の平均）
      <TermHintButton termKey="motorPowerIndex" />
    </p>
  );
}

function TrendSection({ runs, captionHead, isPrevMeet, venueName }) {
  if (runs.length > 1) {
    return (
      <>
        <div className="racer-motor-status-chart-head">
          <p className="racer-motor-status-chart-caption">
            {`${captionHead}（${isPrevMeet ? `${venueName} ` : ""}${runs[0].date.slice(5)}〜${runs[runs.length - 1].date.slice(5)}）、この選手がこのモーターで出走してからの展示タイム`}
          </p>
          <TermHintButton termKey="racerMotorMeetChart" />
        </div>
        <RacerMotorMeetChart runs={runs} />
      </>
    );
  }
  return (
    <p className="racer-motor-status-empty">
      {isPrevMeet
        ? "前節はこのモーターでの出走数が少なく、推移は表示できません。"
        : "今節はまだこのモーターでの出走数が少なく、推移は表示できません。"}
    </p>
  );
}

function PartsEventLine({ latestPartsEvent }) {
  return (
    <p className="racer-motor-status-parts">
      🔧 {latestPartsEvent.date}
      {latestPartsEvent.parts && latestPartsEvent.parts.length > 0
        ? `：${latestPartsEvent.parts.join("・")}交換`
        : ""}
      {latestPartsEvent.propellerChanged ? "：プロペラ交換" : ""}
    </p>
  );
}

// 直近出走が入れ替え前なら、リンク先は「入れ替え前のため表示していません」の
// 行き止まりになる。理由を書き、リンクは出さない（BOA-329、2026-09-29 ファン評価）
function MotorFooter({ preGeneration, venueCode, raceId, motorNumber }) {
  return (
    <>
      {preGeneration ? (
        <p className="racer-motor-status-note">
          💡
          この出走のあと会場のモーターが入れ替わったため、このモーターは現在の同じ番号のモーターとは別です。機力指数・通算成績は表示していません。
        </p>
      ) : (
        <Link
          to={`/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=motor&motor=${motorNumber}`}
          className="racer-motor-status-link"
        >
          → モーター調子で詳しく見る（このモーターの通算成績）
        </Link>
      )}
    </>
  );
}

/**
 * 選手個別ページの「今節のモーター状況」カード（BOA-265）
 * 直近の出走から今節のモーター番号を特定し、機力指数（このモーターの通算
 * 実績と選手自身の実力の差、他選手の実績も含む）と、この選手が今節この
 * モーターに乗ってからの展示タイム推移（この選手自身のデータのみ）を表示する。
 * モーターの2連率/3連率そのものは複数選手の実績が混ざるため選手ページには
 * 載せない（モーター単体の通算成績を見たい場合は分析ツール「モーター調子」
 * タブへ誘導する）。今日の判断に直結する情報のため、過去90日〜2年の集計系
 * セクション群より上（プロフィール直下）に固定表示する。
 * データが無い選手（デビュー直後等）ではカード自体を表示しない
 */
export default function RacerMotorStatusCard({ status }) {
  if (!status) return null;

  const {
    raceId,
    venueCode,
    motorNumber,
    powerIndex,
    meetTrend,
    latestPartsEvent,
    venueMotorStats,
    preGeneration,
    meetEnded,
  } = status;
  const venueName = VENUE_NAMES[venueCode] ?? `${venueCode}`;
  // 直近出走の節が終わっていたら「今節」とは呼ばない（BOA-1182。race_series.end_date で判定済み）
  const isPrevMeet = !preGeneration && meetEnded === true;
  const meetLabel = isPrevMeet ? "前節" : "今節";
  const captionHead = preGeneration ? "直近の節" : meetLabel;
  const runs = (meetTrend ?? []).map((r) => ({
    ...r,
    exhibitionTime: r.exhibition_time,
  }));
  const hasPowerIndex = isPresent(powerIndex?.power_index);

  return (
    <div
      className={`racer-motor-status-card${runs.length > 1 ? " racer-motor-status-card--chart" : ""}`}
    >
      {/* 直近出走が入れ替え前（数ヶ月前）なら「今節」とは呼ばない */}
      <h2 className="racer-motor-status-title">
        🔧{" "}
        {preGeneration
          ? "直近出走のモーター状況"
          : `${meetLabel}のモーター状況`}
      </h2>
      <p className="racer-motor-status-subtitle">
        {venueName}・{motorNumber}号機
      </p>

      <MotorStatBadgeRow
        icon="🔧"
        label="モーター鮮度"
        badges={freshnessBadges(venueMotorStats)}
      />

      {hasPowerIndex && (
        <PowerIndexSection powerIndex={powerIndex} />
      )}

      <TrendSection
        runs={runs}
        captionHead={captionHead}
        isPrevMeet={isPrevMeet}
        venueName={venueName}
      />

      {latestPartsEvent && (
        <PartsEventLine latestPartsEvent={latestPartsEvent} />
      )}

      <MotorFooter
        preGeneration={preGeneration}
        venueCode={venueCode}
        raceId={raceId}
        motorNumber={motorNumber}
      />
    </div>
  );
}
