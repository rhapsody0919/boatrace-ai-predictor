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
/** 七角形の6艇の線（承認モック mock-compare-v3）。枠の色のまま（1号艇は白、2号艇は黒に白の縁取り） */
export const RADAR_LINE = {
  1: "#f8fafc",
  2: "#111111",
  3: "#ef5350",
  4: "#42a5f5",
  5: "#f0c419",
  6: "#4caf50",
};
/** 七角形の頂点の艇番の文字色（枠の色の上） */
export const RADAR_TEXT = {
  1: "#0d1b2e",
  2: "#ffffff",
  3: "#ffffff",
  4: "#ffffff",
  5: "#0d1b2e",
  6: "#ffffff",
};
