/**
 * アナロジー・ファインダー v16 の図の色（承認版モック Version 16 と同じ）。
 * 六角形・ソナー・サンキーは常に暗い固定背景（af-scope）の上に描くので、テーマで反転しない固定色を使う。
 * 面で塗るバッジは公式の艇色（src/utils/colors.js の BOAT_COLORS）。
 */
/** 暗い背景の上の線（1号艇の白は金に、2号艇の黒は灰に置き換える） */
export const SCOPE_LINE = {
  1: "#e8d089",
  2: "#94a3b8",
  3: "#ef5350",
  4: "#42a5f5",
  5: "#f0c419",
  6: "#4caf50",
};
/** サンキー・ソナーの面（1号艇は白に近い色） */
export const SCOPE_FLOW = {
  1: "#e5e1d6",
  2: "#8b95a5",
  3: "#ef5350",
  4: "#42a5f5",
  5: "#f0c419",
  6: "#4caf50",
};
/** 暗い背景の上の文字・目盛り */
export const SCOPE_TEXT = "#f3ead0";
export const SCOPE_SUBTEXT = "#e8d089";
export const SCOPE_GRID = "rgba(201,162,39,";
export const SCOPE_DASH = "#cbd5e1";
