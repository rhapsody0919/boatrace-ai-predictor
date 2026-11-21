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
  SITE_URL,
  isRacerIdFormat,
  isSnapshotReady,
  buildIndexInput,
  buildSocialMeta,
  periodSentence,
  pickTodayVenue,
} from "./RacerProfileMeta.js";
import { buildRacerSummary } from "../pure/racerOfficialPeriodStats.js";
import RacerProfileLoaded, { RacerProfileFailed } from "./RacerProfileLoaded.jsx";
import "./RacerProfile.css";

// title・description は画面に表示されないメタ情報なので「競艇」を含めてよい（code-style.md 例外1の暫定措置。
// 役所への営業前に外す）。選手名＋成績で検索されるので、成績の語を前に置く（集客レーン、2026-10-02）
// プロフィールが無い・取得中・失敗のときも登録番号を入れ、選手ごとに別のページにする（同じ中身の重複を避ける）
function buildRacerMeta(data, racerId) {
  const displayName = data?.profile?.name?.replace(/\s+/g, "") ?? "選手";
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
  return { displayName, title, description, canonicalUrl };
}

// 期別の要約が届いたら title に勝率の数字1つ、description に期の名前つきの勝率等を差し込む（BOA-1688）。
// 例外1の語を含む行は許可リスト（kyotei-wording-allowlist.json）の行と同じ字に保つため、buildRacerMeta は変えない
function withPeriodStats(meta, data, summary) {
  const stats = data?.profile ? periodSentence(summary) : null;
  if (!stats) return meta;
  return {
    ...meta,
    title: meta.title.replace("・勝率・", `・勝率${summary.winRate.toFixed(2)}・`),
    description: meta.description.replace("成績データ。", `成績データ。${stats}`),
  };
}

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

  // 期別の値が届く前は今の文のまま、届いたら勝率等を足した文に差し替える（BOA-1688）
  const summary = buildRacerSummary(period.periodRows);
  const { displayName, title, description, canonicalUrl } = withPeriodStats(
    buildRacerMeta(data, racerId),
    data,
    summary,
  );
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
        <RacerStructuredData
          profile={data.profile}
          racerId={racerId}
          dateModified={summary?.dateModified ?? null}
        />
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
            summary={summary}
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
