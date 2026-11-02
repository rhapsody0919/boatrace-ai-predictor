/**
 * 決まり手の色（グラフの棒・帯・凡例の点）。色そのものは design-tokens.css の
 * `--technique-color-1`〜`7` に置く（race-detail-ui-unify R6。以前は同じ hex の表が
 * 4つのコンポーネントに直書きで複製されていた）。
 *
 * 決まり手はカテゴリで、良し悪しの向きは無い（R3）。緑・赤の「良い／悪い」とは別の色の系統。
 */
const TECHNIQUE_ORDER = {
  逃げ: 1,
  差し: 2,
  まくり: 3,
  まくり差し: 4,
  抜き: 5,
  恵まれ: 6,
};

// 色の番号の順と公式の表示の順は別。
export const OFFICIAL_TECHNIQUE_ORDER = [
  "逃げ",
  "まくり",
  "差し",
  "まくり差し",
  "抜き",
  "恵まれ",
];

/** 入力を変更せず公式順に並べる。一覧に無い名前は末尾で入力順を保つ。 */
export function sortTechniquesOfficial(names) {
  const rank = (name) => {
    const index = OFFICIAL_TECHNIQUE_ORDER.indexOf(name);
    return index === -1 ? OFFICIAL_TECHNIQUE_ORDER.length : index;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}

const PALETTE_SIZE = 7;
const OTHER = 6;

/**
 * @param {string} technique 決まり手の日本語名
 * @param {number} [index] 名前に色が無い決まり手（想定外の表記）の並び順。省略すると「恵まれ」と同じ灰色
 * @returns {string} CSS の色（var(--technique-color-N)）
 */
export function techniqueColor(technique, index) {
  const n =
    TECHNIQUE_ORDER[technique] ??
    (index === undefined ? OTHER : (index % PALETTE_SIZE) + 1);
  return `var(--technique-color-${n})`;
}
