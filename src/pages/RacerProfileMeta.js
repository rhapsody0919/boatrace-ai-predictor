export const SITE_URL = "https://www.boat-ai.jp";

// 登録番号は数字だけ。数字でない URL（/racer/abc）は DB に問い合わせず「該当する選手なし」にする
// （問い合わせると型のエラーの英文がそのまま画面に出た。ファン評価 GS00 1周目）
export const isRacerIdFormat = (racerId) => /^\d+$/.test(racerId ?? "");
export const NOT_FOUND_PAGE_DATA = Object.freeze({
  profile: null,
  grade: null,
  latestRaceDate: null,
  news: [],
});

// title・description は画面に表示されないメタ情報なので「競艇」を含めてよい（code-style.md 例外1の暫定措置。
// 役所への営業前に外す）。選手名＋成績で検索されるので、成績の語を前に置く（集客レーン、2026-10-02）
// プロフィールが無い・取得中・失敗のときも登録番号を入れ、選手ごとに別のページにする（同じ中身の重複を避ける）
export function buildRacerMeta(data, racerId) {
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

// AI クローラー向けスナップショット（scripts/generate-ai-snapshots.js、BOA-848）が保存してよいかの目印。
// プロフィール・成績に加え、モーターと履歴の正常完了も待つ。
export function isSnapshotReady({ loading, error, data, statsLoading, stats, motorState, historyState }) {
  return (
    !loading && !error && Boolean(data?.profile) && !statsLoading && !!stats &&
    [motorState, historyState].every(
      (state) => state === "done" || state === "empty",
    )
  );
}

// isRacerIndexable への入力。
// profile 未取得時は表示名が「選手」フォールバックになり title の一意性が保てないので、
// ニュースが無い選手は profile があるときだけ index にする（プロフィール未取得選手ページのnoindexテストで担保）
export function buildIndexInput(data, activeSince) {
  const hasNews = (data?.news?.length ?? 0) > 0;
  return {
    hasNews,
    latestGrade: data?.profile ? (data?.grade ?? null) : null,
    latestRaceDate: data?.latestRaceDate ?? null,
    activeSince,
  };
}

export function buildSocialMeta({ loading, error, data, title, description, canonicalUrl }) {
  const ready = !loading && !error && data?.profile;
  return {
    title: ready ? title : null,
    description: ready ? description : null,
    url: canonicalUrl,
  };
}

// 今節のモーター状況（直近出走）の日付が本日なら、その会場を選手ページの
// 会場フィルタで「本日出走」として案内する（会場フィルタが全24会場から
// 選べるようになったことに伴うフィードバック対応）。dateは
// getRacerCurrentMotorStatus側でparseRaceId済みの値をそのまま使う
// （race_idの再パース・文字列sliceを重複させない）
export function pickTodayVenue(motorStatus, isTodayFn) {
  return motorStatus && isTodayFn(motorStatus.date) ? motorStatus.venueCode : null;
}
