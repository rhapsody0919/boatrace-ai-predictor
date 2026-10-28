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
import DataFetchError from "../components/DataFetchError";
import {
  isRacerIndexable,
  RACER_INDEX_ACTIVE_DAYS,
} from "../utils/racerIndexPolicy";
import { getDaysAgoJST, isToday } from "../utils/dateUtils";
import "./RacerProfile.css";
import { errorMessageOf } from "../utils/errorMessage.js";

const SITE_URL = "https://www.boat-ai.jp";

// 登録番号は数字だけ。数字でない URL（/racer/abc）は DB に問い合わせず「該当する選手なし」にする
// （問い合わせると型のエラーの英文がそのまま画面に出た。ファン評価 GS00 1周目）
const isRacerIdFormat = (racerId) => /^\d+$/.test(racerId ?? "");
const NOT_FOUND_PAGE_DATA = Object.freeze({
  profile: null,
  grade: null,
  latestRaceDate: null,
  news: [],
});

export default function RacerProfile() {
  const { racerId } = useParams();
  const validId = isRacerIdFormat(racerId);
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
    // 失敗したら1回だけ取り直す。Googlebot の描画で取得が落ちると、全選手が同じ「失敗の画面」になり
    // 1ページの重複として扱われた（Search Console の URL 検査 10/25、/racer/4760 に76件）
    const load = validId
      ? getRacerPageData(racerId).catch(() => getRacerPageData(racerId))
      : Promise.resolve(NOT_FOUND_PAGE_DATA);
    load
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("選手ページの取得エラー:", errorMessageOf(err));
        setError(errorMessageOf(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId]);

  useEffect(() => {
    let cancelled = false;
    (validId ? getRacerStats(racerId) : Promise.resolve(null))
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
  }, [racerId, validId]);

  useEffect(() => {
    // racerId変更時に前選手のmotorStatusを残さずリセットする。
    // RacerProfileはルートパラメータ変更時に再マウントされないため、リセットを
    // 怠ると新しい選手のページに前選手の会場（todayVenueCode由来のバッジ・
    // マーク表示）が一瞬でも出てしまう（現状は選手→選手の直接遷移導線は無いが、
    // 防御的に対応。RacerPerformanceStats.jsxのフィルタリセットと同じ考え方）
    setMotorStatus(null);
    let cancelled = false;
    (validId ? getRacerCurrentMotorStatus(racerId) : Promise.resolve(null))
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
  }, [racerId, validId]);

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
  // 取得に失敗したときは noindex にしない。失敗は「index にしない選手」の証拠ではない。
  // 2026-10-03 の Googlebot の描画で、条件を満たす現役 A1 の85人が取得の失敗の画面（全員同じ中身）で
  // noindex になり、Search Console で同じ1ページを canonical にされたまま残った（inspect 10/25）
  useRobotsMeta(!loading && !error && !indexable);

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
  // プロフィールが無い・取得中・失敗のときも登録番号を入れ、選手ごとに別のページにする（同じ中身の重複を避ける）
  const title = data?.profile
    ? `${displayName}（競艇）選手の成績・勝率・決まり手 | 龍神レーダー`
    : `選手 登録番号${racerId} | 龍神レーダー`;
  // description は登録番号・支部・級を入れて選手ごとに変える（全選手が同じ文だった。seo-marketer GS00）
  const who = [
    `登録番号${racerId}`,
    data?.profile?.branch ? `${data.profile.branch}支部` : null,
    data?.grade ?? null,
  ]
    .filter(Boolean)
    .join("・");
  const description = data?.profile
    ? `${displayName}選手（${who}）の競艇（ボートレース）成績データ。全国勝率・当地勝率の推移、平均ST、会場別・枠番別成績、決まり手、直近のレース一覧とプロフィール。`
    : `登録番号${racerId}の選手のページ | 龍神レーダー`;
  const canonicalUrl = `${SITE_URL}/racer/${racerId}`;
  // AI クローラー向けスナップショット（scripts/generate-ai-snapshots.js、BOA-848）が保存してよいかの目印。
  // プロフィールと成績の両方が揃ったときだけ付ける。成績の取得に失敗したページは保存しない（SPA の外枠に戻る）
  const snapshotReady =
    !loading && !error && Boolean(data?.profile) && !statsLoading && !!stats;

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
        {error && (
          <div className="racer-profile-error">
            {/* 内部のエラー文（Failed to fetch 等）は出さない。通信の失敗か選手がいないのか読めないため（ファン評価 GS00 2周目） */}
            <DataFetchError
              detail={`登録番号${racerId}の選手を読み込めませんでした。`}
            />
            <p>
              <Link to="/racers">選手一覧から探す →</Link>
            </p>
          </div>
        )}

        {!loading && !error && (
          <>
            <RacerProfileHeader
              profile={data.profile}
              grade={data.grade}
              racerId={racerId}
            />
            <RacerProfileCard profile={data.profile} racerId={racerId} />
            <RacerMotorStatusCard status={motorStatus} />
            <RacerPerformanceStats
              racerId={racerId}
              racerName={data.profile ? displayName : null}
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
