/**
 * 比べた差と、その向きを言い切ってよいか（BOA-1157）。依存の無い純関数だけを置く
 */
/** 差の向きを言い切る線（|z|>=1.96、docs/knowledge/number-wording.md・stat-findings.md） */
export const Z_LINE = 1.96;
/** z を出す件数の下限（どちらかの群が30件未満なら差を言い切らない。number-wording.md「30件未満の範囲は割合を出さず件数だけ」、hq data-scientist 2026-10-27） */
export const MIN_N = 30;
/**
 * 2つの率の z（2標本の比率の検定、合算した率で標準誤差を出す）。hq の照合（fp_facts.py の pair_z）と同じ形にそろえる
 * （作り手と照合の判定が割れないように。BOA-1157）。比べる先が部分集合を含む（会場⊂全国 等）ときも独立として扱う。
 * 含む分だけ比べる先が部分集合に寄り z は小さく出るので、言い切りは控えめな側に倒れる。出せなければ null
 * @param {{a: number, na: number, b: number, nb: number}|null|undefined} s a・b は率（%、丸める前）、na・nb は件数
 */
export function zOf(s) {
  if (!s || [s.a, s.na, s.b, s.nb].some((x) => typeof x !== "number" || !Number.isFinite(x)) || s.na <= 0 || s.nb <= 0) return null;
  const pa = s.a / 100;
  const pb = s.b / 100;
  // 小標本は z を出さない: どちらかの群が30件未満、または期待度数が5未満（hq data-scientist 2026-10-27。6/6 対 348/599 は z=2.07 でも止める）
  if (s.na < MIN_N || s.nb < MIN_N || [s.na * pa, s.na * (1 - pa), s.nb * pb, s.nb * (1 - pb)].some((x) => x < 5)) return null;
  const p = (pa * s.na + pb * s.nb) / (s.na + s.nb);
  const se = Math.sqrt(p * (1 - p) * (1 / s.na + 1 / s.nb));
  return se > 0 ? Math.round(((pa - pb) / se) * 100) / 100 : null;
}
/**
 * 比べた差（ポイント、小数1桁）と向き。a・b は見せる率（%）、sample は z を出す材料（zOf）。|z|>=1.96 のときだけ向き（高い・低い）を持たせる（BOA-1157。
 * 10/26 大村10R で 599件 z≈1.67・6R・33件 z≈1.67 の差を「高い」と言い切っていた）。件数が無ければ向きは言わない
 */
export function diffOf(a, b, sample) {
  if (a === null || b === null || a === undefined || b === undefined) return { diffPt: null, direction: null, z: null, sig: false, few: false };
  const d = Math.round((a - b) * 10) / 10;
  const z = zOf(sample);
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

/**
 * 順位の言い切り（最多・最高）。同じ母数の中の1位と2位の件数 c1・c2 の z（多項の2つのセルの差、(c1−c2)/√(c1+c2)）。
 * |z|>=1.96 かつ c1+c2>=10 のときだけ「最多」と言う（hq 2026-10-27。7 対 6 は z≈0.28）。2位が無ければ言い切ってよい
 * @param {number} c1 @param {number|null|undefined} c2
 */
export function rankOf(c1, c2) {
  if (typeof c2 !== "number" || c2 <= 0) return { rankZ: null, rankSig: true };
  if (c1 + c2 < 10) return { rankZ: null, rankSig: false };
  const z = Math.round(((c1 - c2) / Math.sqrt(c1 + c2)) * 100) / 100;
  return { rankZ: z, rankSig: z >= Z_LINE };
}
