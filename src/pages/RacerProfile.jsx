import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import Header from "../components/Header";
import RacerStructuredData from "../components/RacerStructuredData";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { useSocialMeta } from "../hooks/useSocialMeta";
import {
  isRacerIndexable,
  RACER_INDEX_ACTIVE_DAYS,
} from "../utils/racerIndexPolicy";
import { getDaysAgoJST, isToday } from "../utils/dateUtils";
import {
  useRacerPageData,
  useRacerStats,
  useRacerMotor,
  useRacerPeriodStats,
  useRacerFrontTaking,
} from "./RacerProfileData.js";
import {
  isRacerIdFormat,
  buildRacerMeta,
  isSnapshotReady,
  buildIndexInput,
  buildSocialMeta,
  pickTodayVenue,
} from "./RacerProfileMeta.js";
import RacerProfileLoaded, { RacerProfileFailed } from "./RacerProfileLoaded.jsx";
import "./RacerProfile.css";

export default function RacerProfile() {
  const { racerId } = useParams();
  const validId = isRacerIdFormat(racerId);
  const { data, loading, error } = useRacerPageData(racerId, validId);
  const { stats, statsLoading } = useRacerStats(racerId, validId);
  const [historyLoad, setHistoryLoad] = useState(null);
  const { motorState, motorStatus } = useRacerMotor(racerId, validId);
  const historyState = historyLoad?.racerId === racerId ? historyLoad.state : "loading";
  const period = useRacerPeriodStats(racerId, validId);
  const front = useRacerFrontTaking(racerId, validId);

  // インデックス判定は sitemap と共通（src/utils/racerIndexPolicy.js）。ニュースがある選手、または
  // 現役の A1 選手（最新の出走が A1 で直近30日以内）を index にする（集客レーン、2026-10-02）。
  // 入力の組み立ては buildIndexInput（RacerProfileMeta.js）
  const indexable = isRacerIndexable(
    buildIndexInput(data, getDaysAgoJST(RACER_INDEX_ACTIVE_DAYS)),
  );
  // 取得に失敗したときは noindex にしない。失敗は「index にしない選手」の証拠ではない。
  // 2026-10-03 の Googlebot の描画で、条件を満たす現役 A1 の85人が取得の失敗の画面（全員同じ中身）で
  // noindex になり、Search Console で同じ1ページを canonical にされたまま残った（inspect 10/25）
  useRobotsMeta(!loading && !error && !indexable);

  // 今節のモーター状況（直近出走）の日付が本日なら、その会場を選手ページの
  // 会場フィルタで「本日出走」として案内する（会場フィルタが全24会場から
  // 選べるようになったことに伴うフィードバック対応）。dateは
  // getRacerCurrentMotorStatus側でparseRaceId済みの値をそのまま使う
  // （race_idの再パース・文字列sliceを重複させない）
  const todayVenueCode = pickTodayVenue(motorStatus, isToday);

  const { displayName, title, description, canonicalUrl } = buildRacerMeta(data, racerId);
  useSocialMeta(buildSocialMeta({ loading, error, data, title, description, canonicalUrl }));
  const snapshotReady = isSnapshotReady({
    loading, error, data, statsLoading, stats, motorState, historyState,
  });

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      {data?.profile && (
        <RacerStructuredData profile={data.profile} racerId={racerId} />
      )}

      <Header />

      <div
        className="racer-profile-page"
        data-snapshot-motor={motorState}
        data-snapshot-ready={snapshotReady ? "true" : undefined}
      >
        <nav className="racer-profile-breadcrumb">
          <Link to="/">← ホームに戻る</Link>
          <Link to="/racers">選手一覧へ →</Link>
        </nav>

        {loading && (
          <p className="racer-profile-loading">
            登録番号{racerId}の選手を読み込み中...
          </p>
        )}
        {error && <RacerProfileFailed racerId={racerId} />}

        {!loading && !error && (
          <RacerProfileLoaded
            racerId={racerId}
            data={data}
            displayName={displayName}
            front={front}
            period={period}
            motorStatus={motorStatus}
            stats={stats}
            statsLoading={statsLoading}
            todayVenueCode={todayVenueCode}
            onHistoryStateChange={setHistoryLoad}
          />
        )}
      </div>
    </>
  );
}
