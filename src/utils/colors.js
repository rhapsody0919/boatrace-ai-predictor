/**
 * カラーユーティリティ
 * アプリケーション全体で使用する色関連の定数と関数
 */

/**
 * 回収率に基づくCSSクラス名を取得
 * ライト/ダーク両テーマで単一のhex値だと必ず片方が未達になるため、
 * テーマ別に色を出し分けるCSSクラス（.mct-recovery-*）を返す
 * @param {number} rate - 回収率 (1.0 = 100%)
 * @returns {string} クラス名
 */
export const getRecoveryColorClass = (rate) => {
  if (rate >= 1.0) return "mct-recovery-good"; // 100%以上（利益）
  if (rate >= 0.9) return "mct-recovery-ok"; // 90%以上（ほぼ収支均衡）
  return "mct-recovery-bad"; // 90%未満（損失）
};

/**
 * 艇番別カラー（公式カラー）
 */
export const BOAT_COLORS = {
  1: { bg: "#ffffff", text: "#000000", name: "白" },
  2: { bg: "#000000", text: "#ffffff", name: "黒" },
  3: { bg: "#e53935", text: "#ffffff", name: "赤" },
  4: { bg: "#1e88e5", text: "#ffffff", name: "青" },
  5: { bg: "#fdd835", text: "#000000", name: "黄" },
  6: { bg: "#43a047", text: "#ffffff", name: "緑" },
};

/**
 * 小さな艇番印の背景色。白文字を載せる3・4・6号艇だけ濃いトークンを使う。
 * 表の見出し等の公式配色には使わない。
 * @param {number|string} number - 艇番
 * @returns {string} CSSの背景色
 */
export const getBoatChipBackground = (number) => {
  const color = BOAT_COLORS[number] || BOAT_COLORS[1];
  return [3, 4, 6].includes(Number(number))
    ? `var(--boat-${number}-strong, ${color.bg})`
    : color.bg;
};

/**
 * 折れ線・スパークラインに使う艇番別の色。
 *
 * 公式の艇色をそのまま線に使うと、**1号艇の白はライト背景に、2号艇の黒は
 * ダーク背景に溶けて見えなくなる**（2026-09-27、今節タブの6艇比較で実際に
 * 1号艇の線が消えた）。5号艇の黄も細い線では視認性が落ちる。
 * バッジ（面で塗る）は公式色のままで良く、線だけ置き換える。
 *
 * - 1（白）と2（黒）: 意味トークン。どちらもテーマで反転するので、
 *   濃さを変えて（1＝薄い／2＝濃い）実際の白黒の関係に合わせる
 * - 5（黄）: 線として見える濃さまで落とした黄土色
 */
export const BOAT_LINE_COLORS = {
  1: "var(--text-secondary)",
  2: "var(--text-primary)",
  3: "#e53935",
  4: "#1e88e5",
  5: "#c9a227",
  6: "#43a047",
};

/**
 * 共通カラー定数
 */
export const COLORS = {
  primary: "#0ea5e9",
  secondary: "#64748b",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  dark: "#1e293b",
  light: "#f8fafc",
  border: "#e2e8f0",
};
