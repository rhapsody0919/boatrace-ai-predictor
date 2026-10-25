// 実際の進入・ST（DB）で、p と今日の結果のずれを2つに分ける: 枠なりの後付け・予想の形の当たり
import { readFileSync, existsSync } from "node:fs";
import { answerOf } from "./lib/answer.mjs";
import { formsOfAvgSt } from "./lib/forms.mjs";
import { slitForms, SLIT_FORMS } from "./lib/analogyScenario.js";
const db = {}; for (const f of ["races.json", "even1.json", "even2.json"]) if (existsSync(f)) Object.assign(db, JSON.parse(readFileSync(f, "utf8")));
const act = JSON.parse(readFileSync("actual.json", "utf8"));
const toSc = (r) => ({ cells: { waku: { forms: Object.fromEntries(Object.entries(r.forms ?? {}).map(([f, c]) => [f, { n: c.n, tri: { "1-x": c.k } }])) } } });
const rows = [];
for (const r of Object.values(db)) {
  if (!r.forms || !r.rank1) continue;
  const a = act[r.raceId]; if (!a || a.length !== 6 || a.some((x) => x.entry_course == null)) continue;
  const waku = a.every((x) => x.entry_course === x.boat_number);
  const byC = [1, 2, 3, 4, 5, 6].map((c) => { const x = a.find((y) => y.entry_course === c); return x?.start_timing == null || x.is_late_start ? null : x.is_flying ? -Math.abs(x.start_timing) : x.start_timing; });
  const hit = slitForms(byC); const actualForms = byC.some((v) => v == null) ? null : SLIT_FORMS.filter((f) => hit[f]);
  const form = formsOfAvgSt(r.course_st?.course_filled)[0] ?? null;
  const ans = answerOf(toSc(r), form);
  rows.push({ ...r, waku, actualForms, form, ans, y: r.rank1 === 1 ? 1 : 0, p0: r.forms.any.k / r.forms.any.n, p: ans.stage ? ans.k / ans.n : null });
}
const m = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const ci = (xs) => { const n = xs.length, mu = m(xs), sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1)); return `${(mu * 100).toFixed(1)} [${((mu - 1.96 * sd / Math.sqrt(n)) * 100).toFixed(1)}, ${((mu + 1.96 * sd / Math.sqrt(n)) * 100).toFixed(1)}] n=${n}`; };
console.log("実際の進入がそろう", rows.length);
const W = rows.filter((r) => r.waku), NW = rows.filter((r) => !r.waku);
console.log(`枠なり ${W.length} (${(W.length / rows.length * 100).toFixed(1)}%)  1号艇1着 枠なり ${(m(W.map((r) => r.y)) * 100).toFixed(1)}% / 非枠なり ${(m(NW.map((r) => r.y)) * 100).toFixed(1)}%`);
console.log(`実際−p0 全: ${ci(rows.map((r) => r.y - r.p0))}  枠なりだけ: ${ci(W.map((r) => r.y - r.p0))}`);
for (const s of ["A", "B", "C", "N"]) {
  const f = s === "N" ? (r) => r.ans.kind === "no_form" : (r) => r.ans.stage === s;
  const x = W.filter(f); if (!x.length) continue;
  console.log(`  枠なり・${s}: 実際 ${(m(x.map((r) => r.y)) * 100).toFixed(1)}% 平均p0 ${(m(x.map((r) => r.p0)) * 100).toFixed(1)} 実際−p0 ${ci(x.map((r) => r.y - r.p0))}` + (s !== "N" ? ` 平均p ${(m(x.map((r) => r.p)) * 100).toFixed(1)} 実際−p ${ci(x.map((r) => r.y - r.p))}` : ""));
}
const Ws = W.filter((r) => r.ans.stage);
const br = (xs, f) => m(xs.map((r) => (f(r) - r.y) ** 2));
console.log(`枠なり・段あり Brier p ${br(Ws, (r) => r.p).toFixed(4)} p0 ${br(Ws, (r) => r.p0).toFixed(4)}`);
// A−B（実際−p0 の差）を日でまとめたブートストラップ（全体と枠なり）
function boot(xs) {
  const days = [...new Set(xs.map((r) => r.date))]; const byD = Object.fromEntries(days.map((d) => [d, xs.filter((r) => r.date === d)]));
  const diff = (ys) => { const a = ys.filter((r) => r.ans.stage === "A"), b = ys.filter((r) => r.ans.stage === "B"); return m(a.map((r) => r.y - r.p0)) - m(b.map((r) => r.y - r.p0)); };
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bs = []; for (let i = 0; i < 2000; i++) { const ys = []; for (let j = 0; j < days.length; j++) ys.push(...byD[days[Math.floor(rnd() * days.length)]]); bs.push(diff(ys)); }
  bs.sort((a, b) => a - b); return `${(diff(xs) * 100).toFixed(1)} [${(bs[50] * 100).toFixed(1)}, ${(bs[1949] * 100).toFixed(1)}]`;
}
console.log(`A−B（実際−p0 の差、日のブートストラップ95%）全: ${boot(rows)}  枠なり: ${boot(W)}  （A の過去の p−p0 平均 ${(m(rows.filter((r) => r.ans.stage === "A").map((r) => r.p - r.p0)) * 100).toFixed(1)}、B ${(m(rows.filter((r) => r.ans.stage === "B").map((r) => r.p - r.p0)) * 100).toFixed(1)}）`);
// 予想の形の当たり（枠なり・実際の ST がそろう）
const Wf = W.filter((r) => r.actualForms);
console.log(`予想の形の当たり（枠なり・ST そろう ${Wf.length}R）`);
for (const f of SLIT_FORMS) {
  const pr = Wf.filter((r) => r.form === f), np = Wf.filter((r) => r.form !== f);
  if (!pr.length) continue;
  const h = pr.filter((r) => r.actualForms.includes(f)).length, h2 = np.filter((r) => r.actualForms.includes(f)).length;
  console.log(`  ${f}: 予想 ${pr.length} → 実際も ${h} (${(h / pr.length * 100).toFixed(1)}%)  予想が別 ${np.length} → 実際 ${f} ${(h2 / np.length * 100).toFixed(1)}%`);
}
const fl = Wf.filter((r) => r.actualForms.includes("flat")), nf = Wf.filter((r) => !r.actualForms.includes("flat"));
console.log(`  参考 今日の実際が横一線 ${fl.length}R の1号艇1着 ${(m(fl.map((r) => r.y)) * 100).toFixed(1)}%、それ以外 ${(m(nf.map((r) => r.y)) * 100).toFixed(1)}%（後付け、今日の材料では使えない）`);
const sel = rows.filter((r) => r.selected), selW = sel.filter((r) => r.waku);
console.log(`選ぶ4本: 進入そろう ${sel.length}、枠なり ${selW.length} (${(selW.length / sel.length * 100).toFixed(1)}%)`);
