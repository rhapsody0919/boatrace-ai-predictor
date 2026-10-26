/**
 * 比べた差と、その向きを言い切ってよいか（BOA-1157）。依存の無い純関数だけを置く
 */
/** 差の向きを言い切る線（|z|>=1.96、docs/knowledge/number-wording.md・stat-findings.md） */
export const Z_LINE = 1.96;
/**
 * 率 a（%）の件数 n で、基準の率 b（%）と比べた z（基準を固定した1標本の比率の検定）。出せなければ null
 * @param {number|null|undefined} a @param {number|null|undefined} b @param {number|null|undefined} n
 */
export function zOf(a, b, n) {
  if ([a, b, n].some((x) => typeof x !== "number" || !Number.isFinite(x)) || n <= 0 || b <= 0 || b >= 100) return null;
  const p0 = b / 100;
  // 正規近似が使える件数のときだけ（n·p0 と n·(1−p0) がどちらも5以上。教科書の目安）。6R の当日の数などは z を出さない
  if (n * p0 < 5 || n * (1 - p0) < 5) return null;
  return Math.round(((a / 100 - p0) / Math.sqrt((p0 * (1 - p0)) / n)) * 100) / 100;
}
/**
 * 比べた差（ポイント、小数1桁）と向き。n は a の件数。|z|>=1.96 のときだけ向き（高い・低い）を持たせる（BOA-1157。
 * 10/26 大村10R で 599件 z≈1.72・6R・33件 z≈1.67 の差を「高い」と言い切っていた）。件数が無ければ向きは言わない
 */
export function diffOf(a, b, n) {
  if (a === null || b === null || a === undefined || b === undefined) return { diffPt: null, direction: null, z: null, sig: false, few: false };
  const d = Math.round((a - b) * 10) / 10;
  const z = zOf(a, b, n);
  const sig = z !== null && Math.abs(z) >= Z_LINE && d !== 0;
  // few: 件数が足りず z を出さなかった（検定して通らなかったのとは別。言い方を「比べられない」にする。wording-editor 2026-10-27 P2）
  return { diffPt: Math.abs(d), direction: sig ? (d > 0 ? "高い" : "低い") : null, z, sig, few: z === null };
}
/**
 * 差の言い方（文型）。1ポイント未満は「ほぼ」と言わず「差は1ポイント未満」。差は小数1桁（19.0ポイント。BOA-913）。
 * 線（|z|>=1.96）を通らない差は向きを言わず「差は確認できない」（number-wording.md「差を確認できない」）。
 * 件数が足りず z を出さない差は「とは比べられない」（件数は前の行に出ている。22字の幅に収める）（検定した文に読ませない。wording-editor 2026-10-27 P2）
 */
export const diffWords = (f) =>
  f.diffPt === null || f.diffPt === undefined ? null : f.diffPt < 1 ? "との差は1ポイント未満" : f.direction ? `より${f.diffPt.toFixed(1)}ポイント${f.direction}` : f.few ? "とは比べられない" : "との差は確認できない";
export const diffText = (base, f) => {
  const w = diffWords(f);
  return w === null ? null : `${base}${w}`;
};
