// 選手ニュース自動収集の定型テンプレート生成
// docs/design/racer-news-auto-collect/plan.md 5節 / docs/adr/0024-racer-news-auto-publish-safety-net.md 参照
//
// FR2(公式ニュース由来)は第三者の事実を扱うため要約・言い換えによる転載をせず、
// 必ずこの定型テンプレートで生成する。
// (FR5の選手コメントは原文ママ引用のためテンプレート化しない)
//
// 注: FR1(自社DBのグレードレース優勝自動生成)は、SG/G1/G2/G3の予選ヒート1着まで
// 無差別に拾ってしまい「ニュース」としての価値が薄いと判断し実装後に見送った
// （2026-08-27、議論の末ユーザー判断。実データで1日17件生成されノイズと確認）

/**
 * FR2: 公式ニュースアーカイブ由来の節目記録ニュースのtitle/summaryを生成する
 * @param {{ racerName: string, branch: string, achievement: string }} params
 *   achievement: 見出しから抽出した達成内容の文字列（例:「2,000勝」「24場制覇」）
 * @returns {{ title: string, summary: string }}
 */
export function generateGradeAnnouncementNews({
  racerName,
  branch,
  achievement,
}) {
  return {
    title: `${racerName}選手が${achievement}を達成`,
    summary: `${racerName}選手（${branch}支部）が${achievement}を達成しました。`,
  };
}
