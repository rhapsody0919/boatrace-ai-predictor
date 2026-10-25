// 予想の形→今日の1号艇の1着（前向き: 朝の材料、結果は後）。段の言葉が今日について言えるか
import { readFileSync, existsSync } from "node:fs";
import { answerOf } from "./lib/answer.mjs";
import { formsOfAvgSt } from "./lib/forms.mjs";
const db = {};
for (const f of ["races.json", "even1.json", "even2.json"]) if (existsSync(f)) Object.assign(db, JSON.parse(readFileSync(f, "utf8")));
const toSc = (r) => ({ cells: { waku: { forms: Object.fromEntries(Object.entries(r.forms ?? {}).map(([f, c]) => [f, { n: c.n, tri: { "1-x": c.k } }])) } } });
const rows = Object.values(db).filter((r) => r.forms && r.rank1).map((r) => {
  const form = formsOfAvgSt(r.course_st?.course_filled)[0] ?? null;
  const a = answerOf(toSc(r), form);
  return { ...r, form, a, y: r.rank1 === 1 ? 1 : 0, p0: r.forms.any.k / r.forms.any.n, p: a.stage ? a.k / a.n : null };
});
const all = Object.values(db);
console.log("全件", all.length, "材料あり", all.filter((r) => r.forms).length, "結果あり", rows.length, "status:", JSON.stringify(all.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})));
const stat = (xs) => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { n, m, se: sd / Math.sqrt(n) }; };
const fmt = (s) => `${(s.m * 100).toFixed(1)}pt [${((s.m - 1.96 * s.se) * 100).toFixed(1)}, ${((s.m + 1.96 * s.se) * 100).toFixed(1)}] n=${s.n}`;
for (const [lab, f] of [["A", (r) => r.a.stage === "A"], ["B", (r) => r.a.stage === "B"], ["C", (r) => r.a.stage === "C"], ["no_form", (r) => r.a.kind === "no_form"], ["thin", (r) => r.a.kind === "thin_data"], ["段あり計", (r) => r.a.stage]]) {
  const x = rows.filter(f); if (!x.length) continue;
  const y = stat(x.map((r) => r.y));
  const mp0 = stat(x.map((r) => r.p0));
  const line = [`${lab}: 実際 ${(y.m * 100).toFixed(1)}% (${x.filter((r) => r.y).length}/${x.length})`, `平均p0 ${(mp0.m * 100).toFixed(1)}`, `実際−p0 ${fmt(stat(x.map((r) => r.y - r.p0)))}`];
  if (x[0].p !== null) line.push(`平均p ${(stat(x.map((r) => r.p)).m * 100).toFixed(1)}`, `実際−p ${fmt(stat(x.map((r) => r.y - r.p)))}`, `(p−p0)の平均 ${(stat(x.map((r) => r.p - r.p0)).m * 100).toFixed(1)}`);
  console.log("  " + line.join(" / "));
}
const st = rows.filter((r) => r.a.stage);
const brier = (f) => st.reduce((s, r) => s + (f(r) - r.y) ** 2, 0) / st.length;
console.log(`段ありの Brier: p ${brier((r) => r.p).toFixed(4)} p0 ${brier((r) => r.p0).toFixed(4)} skill ${(1 - brier((r) => r.p) / brier((r) => r.p0)).toFixed(4)}`);
// 予想の形ごと（scope に依らず）
const byForm = {}; for (const r of rows) (byForm[r.form ?? "null"] ??= []).push(r);
for (const [f, x] of Object.entries(byForm)) console.log(`  予想の形 ${f}: n=${x.length} 実際−p0 ${fmt(stat(x.map((r) => r.y - r.p0)))}` + (f !== "null" ? ` / 過去の(p−p0)平均 ${(stat(x.filter((r) => r.p !== null).map((r) => r.p - r.p0)).m * 100 || 0).toFixed(1)}` : ""));
// scope 別の段
for (const k of ["VC", "NC"]) { const x = rows.filter((r) => (r.scope || "").startsWith(k)); const c = (s) => x.filter((r) => r.a.stage === s || r.a.kind === s).length; console.log(`  ${k}: ${x.length} A ${c("A")} B ${c("B")} C ${c("C")} no_form ${c("no_form")} thin ${c("thin_data")}`); }
// A のうち 予想と過去の差の大きさ別
const big = rows.filter((r) => r.a.stage && r.p - r.p0 >= 0.05), small = rows.filter((r) => r.a.stage && r.p - r.p0 < 0.05 && r.p - r.p0 > -0.05);
console.log(`  p−p0≥5pt: ${fmt(stat(big.map((r) => r.y - r.p0)))}  |p−p0|<5pt: ${fmt(stat(small.map((r) => r.y - r.p0)))}`);
// 日の分布
console.log("日付", [...new Set(rows.map((r) => r.date))].length, rows.map((r) => r.date).sort()[0], rows.map((r) => r.date).sort().at(-1));
