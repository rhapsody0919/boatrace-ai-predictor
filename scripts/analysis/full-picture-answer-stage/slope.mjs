// p−p0 が今日の y−p0 をどれだけ説明するか（傾き。1 なら p のとおり、0 なら情報なし）。範囲の種類（VC/NC）の水準を外して見る
import { readFileSync, existsSync } from "node:fs";
import { answerOf } from "./lib/answer.mjs";
import { formsOfAvgSt } from "./lib/forms.mjs";
const db = {}; for (const f of ["races.json", "even1.json", "even2.json"]) if (existsSync(f)) Object.assign(db, JSON.parse(readFileSync(f, "utf8")));
const toSc = (r) => ({ cells: { waku: { forms: Object.fromEntries(Object.entries(r.forms ?? {}).map(([f, c]) => [f, { n: c.n, tri: { "1-x": c.k } }])) } } });
const rows = Object.values(db).filter((r) => r.forms && r.rank1).map((r) => { const form = formsOfAvgSt(r.course_st?.course_filled)[0] ?? null; const a = answerOf(toSc(r), form); return { ...r, kind: (r.scope || "").slice(0, 2), a, y: r.rank1 === 1 ? 1 : 0, p0: r.forms.any.k / r.forms.any.n, p: a.stage ? a.k / a.n : null }; });
const m = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const k of ["VC", "NC"]) { const x = rows.filter((r) => r.kind === k); console.log(`${k}: 全 ${x.length} 実際−p0 ${((m(x.map((r) => r.y)) - m(x.map((r) => r.p0))) * 100).toFixed(1)}pt`); for (const s of ["A", "B", "C"]) { const z = x.filter((r) => r.a.stage === s); if (z.length) console.log(`   ${s} ${z.length}: 実際−p0 ${((m(z.map((r) => r.y - r.p0))) * 100).toFixed(1)}  過去 p−p0 ${(m(z.map((r) => r.p - r.p0)) * 100).toFixed(1)}`); } const nf = x.filter((r) => r.a.kind === "no_form"); console.log(`   no_form ${nf.length}: 実際−p0 ${(m(nf.map((r) => r.y - r.p0)) * 100).toFixed(1)}`); }
// OLS: (y−p0) = a_VC + a_NC + b*(p−p0)
const st = rows.filter((r) => r.a.stage);
const X = st.map((r) => [r.kind === "VC" ? 1 : 0, r.kind === "NC" ? 1 : 0, r.p - r.p0]), Y = st.map((r) => r.y - r.p0);
const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], XtY = [0, 0, 0];
X.forEach((x, i) => { for (let a = 0; a < 3; a++) { XtY[a] += x[a] * Y[i]; for (let b = 0; b < 3; b++) XtX[a][b] += x[a] * x[b]; } });
const inv = (M) => { const n = 3, A = M.map((r, i) => [...r, ...[0, 1, 2].map((j) => (i === j ? 1 : 0))]); for (let i = 0; i < n; i++) { let p = A[i][i]; for (let j = 0; j < 2 * n; j++) A[i][j] /= p; for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i]; for (let j = 0; j < 2 * n; j++) A[k][j] -= f * A[i][j]; } } return A.map((r) => r.slice(n)); };
const I = inv(XtX); const beta = I.map((r) => r.reduce((s, v, j) => s + v * XtY[j], 0));
// HC0 頑健 SE
const meat = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; X.forEach((x, i) => { const e = Y[i] - x.reduce((s, v, j) => s + v * beta[j], 0); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) meat[a][b] += x[a] * x[b] * e * e; });
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const V = mul(mul(I, meat), I);
console.log(`段あり ${st.length}R: 傾き b = ${beta[2].toFixed(3)} (95% ${(beta[2] - 1.96 * Math.sqrt(V[2][2])).toFixed(3)}〜${(beta[2] + 1.96 * Math.sqrt(V[2][2])).toFixed(3)})、水準 VC ${(beta[0] * 100).toFixed(1)}pt NC ${(beta[1] * 100).toFixed(1)}pt`);
const sel = st.filter((r) => r.selected); console.log("選ぶ4本の段あり", sel.length);
