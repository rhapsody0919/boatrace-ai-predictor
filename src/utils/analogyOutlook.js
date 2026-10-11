/**
 * アナロジー・ファインダー v16 の AIの見立て（spec FR-E）の表記。純粋関数。
 * 向きの値は学習側の scripts/ml/analogy/profiles.py（plan「向きの計算」）。
 */
import { venueLabel } from "./analogyFormat.js";

const k = "aiPredictionTab.analogy.outlook";
const GRADE_ORDER = ["SG", "G1", "G2", "G3", "ippan"];
const ROUND_ORDER = ["yosen", "junyu", "yusho", "other"];

/** 割合を整数にして合計を100にする（承認版モックの to100） */
export function to100(values) {
  const s = values.reduce((a, b) => a + b, 0);
  if (!s) return values.map(() => 0);
  const raw = values.map((x) => (x / s) * 100);
  const fl = raw.map(Math.floor);
  const rest = 100 - fl.reduce((a, b) => a + b, 0);
  raw
    .map((x, i) => [x - fl[i], i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, rest)
    .forEach(([, i]) => {
      fl[i] += 1;
    });
  return fl;
}

/**
 * 向きの文（plan「向きの計算」。direction は higher・lower・middle・none・varies、カテゴリは {up, down}）
 * @returns {string|null} 向きが無い項目（割合だけの項目）は null
 */
export function directionText(group, direction, t) {
  if (direction === undefined || direction === null) return null;
  if (direction === "none") return t(`${k}.dir.none`);
  if (direction === "varies") return t(`${k}.dir.varies`);
  if (direction === "middle")
    return t(`${k}.dir.middle.${group}`, {
      defaultValue: t(`${k}.dir.middle.other`),
    });
  if (direction === "higher" || direction === "lower")
    return t(`${k}.dir.${direction}.${group}`);
  const label = (v) => {
    if (group === "venue") return venueLabel(v, t);
    if (group === "grade")
      return t(`aiPredictionTab.analogy.grades.${v}`, String(v));
    if (group === "round") return t(`${k}.roundNames.${v}`, String(v));
    if (group === "weather") return t(`${k}.weatherNames.${v}`, String(v));
    return String(v);
  };
  const order =
    group === "grade" ? GRADE_ORDER : group === "round" ? ROUND_ORDER : null;
  const sort = (vals) =>
    order
      ? [...vals].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      : vals;
  const join = (vals) =>
    vals.length
      ? sort(vals).map(label).join(t("aiPredictionTab.analogy.listSeparator"))
      : "—";
  return t(`${k}.dir.category`, {
    up: join(direction.up ?? []),
    down: join(direction.down ?? []),
  });
}
