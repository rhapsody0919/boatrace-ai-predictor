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
import {
  isRacerIndexable,
  RACER_INDEX_ACTIVE_DAYS,
} from "../utils/racerIndexPolicy";
import { getDaysAgoJST, isToday } from "../utils/dateUtils";
import "./RacerProfile.css";
import { errorMessageOf } from "../utils/errorMessage.js";

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
        setError(errorMessageOf(err));
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
  // インデックス判定は sitemap と共通（src/utils/racerIndexPolicy.js）。ニュースがある選手、または
  // 現役の A1 選手（最新の出走が A1 で直近30日以内）を index にする（集客レーン、2026-10-02）。
  // profile 未取得時は表示名が「選手」フォールバックになり title の一意性が保てないので、
  // ニュースが無い選手は profile があるときだけ index にする（プロフィール未取得選手ページのnoindexテストで担保）
  const indexable = isRacerIndexable({
    hasNews,
    latestGrade: data?.profile ? (data?.grade ?? null) : null,
    latestRaceDate: data?.latestRaceDate ?? null,
    activeSince: getDaysAgoJST(RACER_INDEX_ACTIVE_DAYS),
  });
  useRobotsMeta(!loading && !indexable);

  // 今節のモーター状況（直近出走）の日付が本日なら、その会場を選手ページの
  // 会場フィルタで「本日出走」として案内する（会場フィルタが全24会場から
  // 選べるようになったことに伴うフィードバック対応）。dateは
  // getRacerCurrentMotorStatus側でparseRaceId済みの値をそのまま使う
  // （race_idの再パース・文字列sliceを重複させない）
  const todayVenueCode =
    motorStatus && isToday(motorStatus.date) ? motorStatus.venueCode : null;

  const displayName = data?.profile?.name?.replace(/\s+/g, "") ?? "選手";
  // title・description は画面に表示されないメタ情報なので「競艇」を含めてよい（code-style.md 例外1の暫定措置。
  // 役所への営業前に外す）。選手名＋成績で検索されるので、成績の語を前に置く（集客レーン、2026-10-02）
  const title = data?.profile
    ? `${displayName}（競艇）選手の成績・勝率・決まり手 | 龍神レーダー`
    : `${displayName} 選手プロフィール | 龍神レーダー`;
  const description = data?.profile
    ? `${displayName}選手の競艇（ボートレース）成績データ。全国勝率・当地勝率の推移、平均ST、会場別成績、枠番別成績、決まり手傾向とプロフィール（支部・出身地等）をまとめて紹介。`
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
