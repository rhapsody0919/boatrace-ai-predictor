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

// 期別の要約（buildRacerSummary）から description に入れる1文。期の名前を必ず付ける
// （出走表の全国勝率とは集計期間が違う。BOA-1688）。勝率が無ければ null
export function periodSentence(summary) {
  if (summary?.winRate == null) return null;
  const parts = [`${summary.label}の勝率 ${summary.winRate.toFixed(2)}`];
  if (summary.top2Rate != null) parts.push(`2連率 ${summary.top2Rate.toFixed(1)}%`);
  parts.push(`優出 ${summary.periodFinals}`, `優勝 ${summary.periodWins}`);
  return `${parts.join("・")}。`;
}
