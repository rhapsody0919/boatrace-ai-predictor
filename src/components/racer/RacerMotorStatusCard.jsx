import { Link } from "react-router-dom";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import TrendLineChart from "../analysis/TrendLineChart";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import { SMALL_SAMPLE_THRESHOLD } from "../race/basicInfoStats";
import { formatPowerIndex, powerIndexTone } from "../../utils/smallSampleRate";
import { exhibitionTimeAxis } from "../../utils/chartDomain";
import "./RacerMotorStatusCard.css";

const isPresent = (value) => value !== null && value !== undefined;

// 同じ日に2回走ると横軸に同じ日付が並び、何の違いか読めない。レース番号を
// 添える（BOA-513）。その日だけに付けると、付く点と付かない点が混ざって
// 読みにくいので、1日でも2回走った日があれば全部の点に付ける（BOA-557）
function buildChartData(trendRows) {
  const runsOnDate = trendRows.reduce(
    (count, row) => count.set(row.date, (count.get(row.date) ?? 0) + 1),
    new Map(),
  );
  const hasDoubleRunDay = [...runsOnDate.values()].some((n) => n > 1);
  return trendRows.map((row) => ({
    date:
      hasDoubleRunDay && row.raceNo
        ? `${row.date.slice(5)} ${row.raceNo}R`
        : row.date.slice(5),
    day: row.date.slice(5),
    exhibition_time: row.exhibition_time,
  }));
}

// 走数が少ないときは評価の言葉を出さず、参考値の色にする（BOA-549）
function resolveTone(powerIndex) {
  const hasPowerIndex =
    powerIndex?.power_index !== null && powerIndex?.power_index !== undefined;
  const tone = hasPowerIndex
    ? powerIndexTone(
        powerIndex.power_index,
        powerIndex.sample_count,
        SMALL_SAMPLE_THRESHOLD,
      )
    : null;
  return { hasPowerIndex, tone };
}

function toneIndexClass(tone) {
  return (
    {
      good: "power-index-good",
      bad: "power-index-bad",
      small: "is-small-sample",
    }[tone] ?? ""
  );
}

function toneVerdict(tone) {
  if (tone === "small") return " — 走数が少ないため参考値";
  return ` — ${
    tone === "good"
      ? "実力以上に走っている"
      : tone === "bad"
        ? "選手の実力より低調"
        : "実力相応"
  }`;
}

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

function PowerIndexSection({ powerIndex, tone, indexClass }) {
  return (
    <>
      <p className={`racer-motor-status-index ${indexClass}`}>
        機力指数 {formatPowerIndex(powerIndex.power_index)}（
        {powerIndex.clipped_by_generation
          ? "現行モーターの使用開始以降"
          : "過去90日"}
        ・{powerIndex.sample_count}走の平均）
        {toneVerdict(tone)}
      </p>
      <p className="racer-motor-status-note">
        💡
        機力指数は「このモーターに乗った過去のレースで実際に2着以内だったか」−「その時乗っていた選手自身の全国2連率」の差を全レース分平均した値です。プラスが大きいほど、乗った選手の実力を超えて走っているモーターと言えます（このモーターを過去に使った他の選手の実績も含みます）。
      </p>
    </>
  );
}

function TrendSection({ chartData, captionHead, isPrevMeet, venueName }) {
  const exhibitionAxis = exhibitionTimeAxis(
    chartData.map((row) => row.exhibition_time),
  );
  if (chartData.length > 1) {
    return (
      <>
        <p className="racer-motor-status-chart-caption">
          {`${captionHead}（${
            isPrevMeet ? `${venueName} ` : ""
          }${chartData[0].day}〜${
            chartData[chartData.length - 1].day
          }）、この選手がこのモーターで出走してからの展示タイム`}
        </p>
        <TrendLineChart
          data={chartData}
          yAxisLabel="展示タイム (秒)"
          yAxisDomain={exhibitionAxis?.domain}
          yTicks={exhibitionAxis?.ticks}
          // 375pxでもレース番号付きのラベルを間引かない（BOA-557）
          slantXLabels
          yTickDecimals={2}
          tooltipFormatter={(value) => value.toFixed(2)}
          series={[
            {
              dataKey: "exhibition_time",
              name: "展示タイム",
              stroke: "var(--brand-accent-primary)",
              type: "linear",
            },
          ]}
        />
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
  const chartData = buildChartData(meetTrend ?? []);
  const { hasPowerIndex, tone } = resolveTone(powerIndex);

  return (
    <div className="racer-motor-status-card">
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
        <PowerIndexSection
          powerIndex={powerIndex}
          tone={tone}
          indexClass={toneIndexClass(tone)}
        />
      )}

      <TrendSection
        chartData={chartData}
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
