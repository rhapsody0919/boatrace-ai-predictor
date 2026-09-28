/**
 * レースステージ（予選/準優勝戦/優勝戦等）のバッジ表示設定
 * BOA-226: 「予選」「カタメン１予選」等はノイズになるためバッジ化せず、
 * 節の山場である優勝戦・準優勝戦のみを対象にする
 */
const RACE_STAGE_BADGE_CONFIG = {
  final: { emoji: "🏆", i18nKey: "raceStage.final", color: "#b91c1c" },
  semifinal: { emoji: "🥈", i18nKey: "raceStage.semifinal", color: "#c2410c" },
};

// scrapeRaceStage()（scripts/daily/update-race-info.js）は会場の表示文字列を
// ほぼ生で保存するため、「ツッキー優勝戦」「ＭＤ優勝戦」「団体・優勝戦」のように
// 会場固有の接頭が付く（2026-09-28の実データ棚卸しで確認。
// scripts/analysis/race-stage-inventory.mjs）。そのため完全一致では絞れず
// 部分一致で判定する。
//
// 「準優勝戦」「準々優勝戦」はどちらも文字列として「優勝戦」を含むので、
// 判定順序と除外を誤ると優勝戦バッジ（🏆）が付く。実データに「準々優勝戦」が
// 4件あり、旧実装ではこれが優勝戦扱いになっていた（BOA-457）。
// 「準優進出戦」（準優の1つ前の勝ち上がり戦、実データ39件）は準優勝戦ではない
export function getRaceStageKey(raceStage) {
  if (!raceStage) return null;
  if (raceStage.includes("準々") || raceStage.includes("準優進出")) return null;
  if (raceStage.includes("準優勝戦")) return "semifinal";
  if (raceStage.includes("優勝戦")) return "final";
  return null;
}

/**
 * その種別が「優勝戦」か（準優勝戦・準々優勝戦・準優進出戦は含まない）。
 * モーターの優勝回数の内訳のように、優勝戦だけを抜き出す集計で使う
 */
export function isFinalStage(raceStage) {
  return getRaceStageKey(raceStage) === "final";
}

export function getRaceStageBadge(raceStage) {
  const key = getRaceStageKey(raceStage);
  return key ? RACE_STAGE_BADGE_CONFIG[key] : undefined;
}
