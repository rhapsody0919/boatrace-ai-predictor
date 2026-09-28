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

/**
 * レース詳細の見出しに出す種別チップの分類（BOA-509）。
 * getRaceStageKey（RaceCard のバッジ用。優勝戦・準優勝戦だけを返す）とは別物で、
 * 既存の戻り値を変えないために関数を分けている。
 *
 * race_stage は会場の自由記述がほぼ生で入る（「予選特賞」「ペイペイDR」
 * 「ウインウイン５」等）。直近30日（2026-08-29〜09-28、4,797R）の棚卸しでは、
 * 下の順に部分一致させると約87%が分類でき、残りは会場の企画レース名
 * （「朝からセンプル」「サンライズX戦」等）だった。分類できないものは null を返し、
 * 呼び出し側で公式表記のまま出す（情報を消さない）。
 *
 * 判定順序の理由:
 * - 「準々優勝戦」「準優進出戦」「準優勝戦」はいずれも「優勝戦」を含むので先に見る
 * - 「予選ドリーム戦」はドリーム戦、「予選特賞」「一般特選」は特別戦にする。
 *   得点率の配点（seriesPoints.js の classifyStage）が特別戦の点数表を使う
 *   レースと揃えるため、特選・特賞・選抜・特別を「予選」「一般」より先に見る
 */
const RACE_STAGE_CATEGORY_RULES = [
  {
    key: "semifinalQualifier",
    test: (s) => s.includes("準々") || s.includes("準優進出"),
  },
  { key: "semifinal", test: (s) => s.includes("準優勝戦") },
  { key: "final", test: (s) => s.includes("優勝戦") },
  { key: "dream", test: (s) => s.includes("ドリーム") || s.includes("DR") },
  {
    key: "special",
    test: (s) =>
      s.includes("特選") ||
      s.includes("特賞") ||
      s.includes("選抜") ||
      s.includes("特別"),
  },
  { key: "qualifier", test: (s) => s.includes("予選") },
  { key: "general", test: (s) => s.includes("一般") },
];

/**
 * @param {string|null|undefined} raceStage race_conditions.race_stage（生の公式表記）
 * @returns {{ key: string, i18nKey: string } | null} 分類できなければ null
 */
export function getRaceStageCategory(raceStage) {
  if (!raceStage) return null;
  const s = raceStage.normalize("NFKC");
  const rule = RACE_STAGE_CATEGORY_RULES.find((r) => r.test(s));
  return rule ? { key: rule.key, i18nKey: `raceStage.${rule.key}` } : null;
}
