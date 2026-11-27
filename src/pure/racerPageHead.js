/**
 * 選手ページ（/racer/:id）の head の値（title・description・canonical）。人の画面（src/pages/RacerProfile.jsx）と、
 * 生の HTML の head の関数が同じ関数を使う。副作用なし（src/pure なので src/pure の外と ES の組み込みの外を使わない）
 */
const SITE_URL = "https://www.boat-ai.jp";

// 期別の要約（buildRacerSummary）から description に入れる1文。期の名前を必ず付ける
// （出走表の全国勝率とは集計期間が違う。BOA-1688）。勝率が無ければ null
export function periodSentence(summary) {
  if (summary?.winRate == null) return null;
  const parts = [`${summary.label}の勝率 ${summary.winRate.toFixed(2)}`];
  if (summary.top2Rate != null) parts.push(`2連率 ${summary.top2Rate.toFixed(1)}%`);
  parts.push(`優出 ${summary.periodFinals}`, `優勝 ${summary.periodWins}`);
  return `${parts.join("・")}。`;
}

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

/**
 * 選手ページの title・description・canonical（期別の要約が届いたら勝率等を差し込む）と表示名
 * @param {{profile?: {name?: string, branch?: string|null}|null, grade?: string|null}|null} data - getRacerPageData の値（取得中は null）
 * @param {string} racerId - 登録番号
 * @param {ReturnType<typeof import("./racerOfficialPeriodStats.js").buildRacerSummary>} summary - 期別の要約（無ければ null）
 */
export function racerPageMeta(data, racerId, summary) {
  return withPeriodStats(buildRacerMeta(data, racerId), data, summary);
}
