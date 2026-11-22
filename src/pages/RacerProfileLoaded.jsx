import {
  RacerProfileHeader,
  RacerProfileCard,
  RacerMotorStatusCard,
  RacerPerformanceStats,
  RacerNewsList,
  RacerOfficialStats,
} from "../components/racer";
import RacerFrontTaking from "../components/racer/RacerFrontTaking";
import RacerSummaryBlock from "../components/racer/RacerSummaryBlock";
import RacerTodayRuns from "../components/racer/RacerTodayRuns";
import { Link } from "react-router-dom";
import DataFetchError from "../components/DataFetchError";
import InlineFetchError from "../components/InlineFetchError";

function PeriodSection({ periodFailed, periodRows, onRetry, racerName }) {
  if (periodFailed) return <InlineFetchError onRetry={onRetry} />;
  return periodRows && <RacerOfficialStats rows={periodRows} racerName={racerName} />;
}

// 取得が終わって失敗しなかったときの本体（元の RacerProfile の `!loading && !error` の中身）
export default function RacerProfileLoaded({
  racerId,
  data,
  displayName,
  front,
  period,
  summary,
  motorStatus,
  stats,
  statsLoading,
  todayVenueCode,
  onHistoryStateChange,
}) {
  return (
    <>
      <RacerProfileHeader
        profile={data.profile}
        grade={data.grade}
        racerId={racerId}
        isInya={front.frontTaking?.isInya === true}
      />
      {data.profile && <RacerTodayRuns racerId={racerId} />}
      {data.profile && !period.periodFailed && (
        <RacerSummaryBlock
          grade={data.grade}
          // 期別の行が届く前は undefined（取得中）、届いて出走が無ければ null
          summary={period.periodRows ? summary : undefined}
          front={front.frontTaking}
        />
      )}
      <RacerProfileCard profile={data.profile} racerId={racerId} />
      {data.profile && (
        <RacerFrontTaking
          summary={front.frontTaking}
          failed={front.frontTakingFailed}
          onRetry={front.retryFrontTaking}
        />
      )}
      <PeriodSection
        periodFailed={period.periodFailed}
        periodRows={period.periodRows}
        onRetry={period.retryPeriod}
        racerName={data.profile ? displayName : null}
      />
      <RacerMotorStatusCard status={motorStatus} />
      <RacerPerformanceStats
        racerId={racerId}
        racerName={data.profile ? displayName : null}
        stats={stats}
        loading={statsLoading}
        todayVenueCode={todayVenueCode}
        onHistoryStateChange={onHistoryStateChange}
      />
      <RacerNewsList news={data.news} />
    </>
  );
}

export function RacerProfileFailed({ racerId }) {
  return (
    <div className="racer-profile-error">
      {/* 内部のエラー文（Failed to fetch 等）は出さない。通信の失敗か選手がいないのか読めないため（ファン評価 GS00 2周目） */}
      <DataFetchError
        detail={`登録番号${racerId}の選手を読み込めませんでした。`}
      />
      <p>
        <Link to="/racers">選手一覧から探す →</Link>
      </p>
    </div>
  );
}
