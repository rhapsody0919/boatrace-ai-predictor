import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Header from "../components/Header";
import RacerStructuredData from "../components/RacerStructuredData";
import {
  RacerProfileHeader,
  RacerProfileCard,
  RacerMotorStatusCard,
  RacerPerformanceStats,
  RacerNewsList,
} from "../components/racer";
import {
  getRacerPageData,
  getRacerStats,
  getRacerCurrentMotorStatus,
} from "../services/racerService";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { isToday } from "../utils/dateUtils";
import "./RacerProfile.css";

const SITE_URL = "https://www.boat-ai.jp";

export default function RacerProfile() {
  const { racerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 成績・調子セクションはprofile/grade/newsとは別経路で取得し、
  // タイトル・メタ情報の表示（SEO・E2E双方に影響）をブロックしないようにする
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [motorStatus, setMotorStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getRacerPageData(racerId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);

  useEffect(() => {
    let cancelled = false;
    getRacerStats(racerId)
      .then((result) => {
        if (cancelled) return;
        setStats(result);
        setStatsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("選手成績データ取得エラー:", err.message);
        setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);

  useEffect(() => {
    // racerId変更時に前選手のmotorStatusを残さずリセットする。
    // RacerProfileはルートパラメータ変更時に再マウントされないため、リセットを
    // 怠ると新しい選手のページに前選手の会場（todayVenueCode由来のバッジ・
    // マーク表示）が一瞬でも出てしまう（現状は選手→選手の直接遷移導線は無いが、
    // 防御的に対応。RacerPerformanceStats.jsxのフィルタリセットと同じ考え方）
    setMotorStatus(null);
    let cancelled = false;
    getRacerCurrentMotorStatus(racerId)
      .then((result) => {
        if (cancelled) return;
        setMotorStatus(result);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("今節のモーター状況取得エラー:", err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);

  const hasNews = (data?.news?.length ?? 0) > 0;
  // 成績データ（stats）単体はnoindex解除の条件にしない。profile未取得時は
  // 表示名が「選手」フォールバックになりタイトルの一意性が保てないため
  // （プロフィール未取得選手ページのnoindexテストで担保）
  useRobotsMeta(!loading && !hasNews);

  // 今節のモーター状況（直近出走）の日付が本日なら、その会場を選手ページの
  // 会場フィルタで「本日出走」として案内する（会場フィルタが全24会場から
  // 選べるようになったことに伴うフィードバック対応）。dateは
  // getRacerCurrentMotorStatus側でparseRaceId済みの値をそのまま使う
  // （race_idの再パース・文字列sliceを重複させない）
  const todayVenueCode =
    motorStatus && isToday(motorStatus.date) ? motorStatus.venueCode : null;

  const displayName = data?.profile?.name?.replace(/\s+/g, "") ?? "選手";
  const title = `${displayName} 選手プロフィール | 龍神レーダー`;
  const description = data?.profile
    ? `${displayName}選手のプロフィール（生年月日・支部・出身地等）、全国勝率推移・平均ST・決まり手傾向などの成績データ、ニュースをまとめて紹介。`
    : "選手プロフィール | 龍神レーダー";
  const canonicalUrl = `${SITE_URL}/racer/${racerId}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      {data?.profile && (
        <RacerStructuredData profile={data.profile} racerId={racerId} />
      )}

      <Header />

      <div className="racer-profile-page">
        <nav className="racer-profile-breadcrumb">
          <Link to="/">← ホームに戻る</Link>
          <Link to="/racers">選手一覧へ →</Link>
        </nav>

        {loading && <p className="racer-profile-loading">読み込み中...</p>}
        {error && <p className="racer-profile-error">{error}</p>}

        {!loading && !error && (
          <>
            <RacerProfileHeader profile={data.profile} grade={data.grade} />
            <RacerProfileCard profile={data.profile} />
            <RacerMotorStatusCard status={motorStatus} />
            <RacerPerformanceStats
              racerId={racerId}
              stats={stats}
              loading={statsLoading}
              todayVenueCode={todayVenueCode}
            />
            <RacerNewsList news={data.news} />
          </>
        )}
      </div>
    </>
  );
}
