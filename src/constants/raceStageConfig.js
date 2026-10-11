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
//
// 男女Ｗ優勝戦の節は準優勝戦を「Ｗ準優戦前半」「Ｗ準優戦後半」と書く（「勝」が無い。
// 実データ8件）。「準優勝戦」だけを見ると準優勝戦に当たらず、得点率の計算
// （seriesPoints.js の classifyStage。「準優」を含めば勝ち上がり戦）と食い違った（BOA-728）
//
// 優勝戦・準優勝戦の判定 v2（BOA-271 T1-1。spec「優勝戦・準優勝戦の判定」、正は
// docs/design/analogy-finder/analysis/t1/t1-1-stage-rule.json）。「優勝戦」を含まない名前の
// 優勝戦（決勝戦・王将位決定戦・賞金女王決定・〜優 等）と準優勝戦（準決勝戦・セミファイナル）も拾う。
// 名前は NFKC で正規化してから当てる。features.py の round_from_stage も同じ規則にそろえる（学習側）
// （固定の82件 scripts/ml/analogy/testdata/stage-rule-v2-cases.json で一致を検査する）
const isSemifinalQualifierText = (s) =>
  s.includes("準々") || s.includes("準優進出");
const isSemifinalText = (s) =>
  /準優勝?戦/.test(s) || s.includes("準決") || s.includes("セミファイナル");
const FINAL_WORDS = [
  "優勝戦",
  "決勝戦",
  "王座決定戦",
  "賞金女王決定",
  "王将位決定戦",
];
const isFinalText = (s) => {
  if (FINAL_WORDS.some((w) => s.includes(w))) return true;
  // 「ファイナル選（抜）」は初日の選抜戦、「ファイナル進出戦」は勝ち上がり戦
  if (
    s.includes("ファイナル") &&
    !s.includes("進出") &&
    !s.includes("ファイナル選")
  )
    return true;
  // 長い名前は6文字で切れ、「〜優勝戦」の「戦」や「勝戦」が落ちる（「県内選手権優」「ゴールド優勝」）
  const t = s.replace(/\s/g, "");
  return (t.endsWith("優") || t.endsWith("優勝")) && !s.includes("準優");
};

export function getRaceStageKey(raceStage) {
  if (!raceStage) return null;
  const s = raceStage.normalize("NFKC");
  if (isSemifinalQualifierText(s)) return null;
  if (isSemifinalText(s)) return "semifinal";
  if (isFinalText(s)) return "final";
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
 * - 特選・特賞・特別は「予選の中の特別戦」と「予選落ち組の上位戦」で意味が逆になる。
 *   直近30日の日目分布で、「予選特賞」「予選特選」は1〜4日目（予選期間）、
 *   「一般特選」「一般特賞」「一般」「一般戦」は3日目以降・最終日（予選終了後）に
 *   組まれている。1つの「特別戦」にまとめると、得点率に入るレースか予選落ちの
 *   消化戦かを見分けられない（BOA-509 のファン評価で P1）ため、予選/一般の軸を残す
 *   「予選選抜」（1〜3日目）・「一般選抜」も同じ軸で分ける
 * - それ以外の「選抜」は「選抜戦」。完全一致の「選抜戦」は111件すべて最終日だが、
 *   「記者選抜戦」「福岡選抜」等は1〜4日目にも組まれる（ファン評価3周目）。
 *   文字列だけでは区別できないので、隣の日目バッジで読ませる
 * - 「特別選抜戦」は「特別」を含むが選抜戦（最終日のみ）なので、特別戦より先に見る
 * - 「予選ドリーム戦」はドリーム戦
 */
const hasSpecial = (s) =>
  s.includes("特選") ||
  s.includes("特賞") ||
  s.includes("特別") ||
  s.includes("選抜");

const RACE_STAGE_CATEGORY_RULES = [
  { key: "semifinalQualifier", test: isSemifinalQualifierText },
  { key: "semifinal", test: isSemifinalText },
  { key: "final", test: isFinalText },
  { key: "dream", test: (s) => s.includes("ドリーム") || s.includes("DR") },
  {
    key: "qualifierSpecial",
    test: (s) => s.includes("予選") && hasSpecial(s),
  },
  { key: "generalSpecial", test: (s) => s.includes("一般") && hasSpecial(s) },
  { key: "selection", test: (s) => s.includes("選抜") },
  { key: "special", test: hasSpecial },
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

/**
 * 出走履歴の表・直近10走の表のレース種別の表示（BOA-621）。
 * ja は公式表記のまま（表示を変えない）。ja 以外は getRaceStageCategory で分類できれば
 * 区分の訳を出し、分類できない会場独自の名前（企画レース名等）は公式表記のまま出す。
 *
 * @param {string|null|undefined} raceStage race_conditions.race_stage（生の公式表記）
 * @param {(key: string) => string} t i18next の t
 * @param {string} lang i18n の言語コード
 * @returns {{ text: string, isOfficial: boolean } | null} isOfficial は公式表記のまま出すか
 *   （translate="no" を付ける目印）
 */
export function raceStageLabel(raceStage, t, lang) {
  if (!raceStage) return null;
  const category = lang === "ja" ? null : getRaceStageCategory(raceStage);
  return category
    ? { text: t(category.i18nKey), isOfficial: false }
    : { text: raceStage, isOfficial: true };
}
