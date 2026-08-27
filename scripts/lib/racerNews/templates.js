// 選手ニュース自動収集の定型テンプレート生成
// docs/design/racer-news-auto-collect/plan.md 5節 / docs/adr/0024-racer-news-auto-publish-safety-net.md 参照
//
// FR1(自社DB由来)・FR2(公式ニュース由来)はいずれも第三者の事実を扱うため
// 要約・言い換えによる転載をせず、必ずこの定型テンプレートで生成する。
// (FR5の選手コメントは原文ママ引用のためテンプレート化しない)

/**
 * FR1: グレードレース優勝ニュースのtitle/summaryを生成する
 * @param {{ racerName: string, raceGrade: "SG"|"G1"|"G2"|"G3",
 *   venueName: string, raceNumber: number, raceDate: string }} params
 * @returns {{ title: string, summary: string }}
 */
export function generateGradeRaceWinNews({
  racerName,
  raceGrade,
  venueName,
  raceNumber,
  raceDate,
}) {
  return {
    title: `${racerName}選手が${raceGrade}で1着`,
    summary: `${raceDate}、${venueName}で行われた${raceGrade}第${raceNumber}Rで${racerName}選手が1着となりました。`,
  };
}

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
