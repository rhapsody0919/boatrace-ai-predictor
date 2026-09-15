/**
 * レースステージ（予選/準優勝戦/優勝戦等）のバッジ表示設定
 * BOA-226: 「予選」「カタメン１予選」等はノイズになるためバッジ化せず、
 * 節の山場である優勝戦・準優勝戦のみを対象にする
 */
const RACE_STAGE_BADGE_CONFIG = {
  final: { emoji: "🏆", i18nKey: "raceStage.final", color: "#b91c1c" },
  semifinal: { emoji: "🥈", i18nKey: "raceStage.semifinal", color: "#c2410c" },
};

// scrapeRaceStage()（scripts/daily/update-race-info.js）は将来「5日目 準優勝戦」
// のような複数語の値を返す可能性を想定して作られている（verify-race-stage-parsing.js
// 参照）ため、完全一致ではなく部分一致で判定する。「準優勝戦」は文字列として
// 「優勝戦」を含むため、判定順序（準優勝戦を先に見る）を変えると誤判定する
export function getRaceStageKey(raceStage) {
  if (!raceStage) return null;
  if (raceStage.includes("準優勝戦")) return "semifinal";
  if (raceStage.includes("優勝戦")) return "final";
  return null;
}

export function getRaceStageBadge(raceStage) {
  const key = getRaceStageKey(raceStage);
  return key ? RACE_STAGE_BADGE_CONFIG[key] : undefined;
}
