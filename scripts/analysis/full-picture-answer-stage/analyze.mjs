import { readFileSync } from "node:fs";
import { answerOf, wilson } from "./lib/answer.mjs";
import { formsOfAvgSt } from "./lib/forms.mjs";
const db = Object.values(JSON.parse(readFileSync("races.json", "utf8")));
const toSc = (r) => ({ cells: { waku: { forms: Object.fromEntries(Object.entries(r.forms ?? {}).map(([f, c]) => [f, { n: c.n, tri: { "1-x": c.k } }])) } } });
const q = (a, ps) => { const s = [...a].sort((x, y) => x - y); return ps.map((p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]); };
function summarize(rows, label) {
  const saved = rows.filter((r) => r.forms);
  const notSaved = rows.filter((r) => !r.forms);
  const res = saved.map((r) => {
    const form = formsOfAvgSt(r.course_st?.course_filled)[0] ?? null;
    const all = formsOfAvgSt(r.course_st?.course_filled);
    const a = answerOf(toSc(r), form);
    // 補集合との比較（2比率の z）
    let zc = null, diff = null, compl = null;
    if (form && r.forms[form]?.n) {
      const c = r.forms[form], o = r.forms.any; const n2 = o.n - c.n, k2 = o.k - c.k;
      const p1 = c.k / c.n, p2 = k2 / n2, pp = o.k / o.n;
      zc = (p1 - p2) / Math.sqrt(pp * (1 - pp) * (1 / c.n + 1 / n2)); diff = (p1 - o.k / o.n) * 100; compl = (p1 - p2) * 100;
    }
    return { ...r, form, nForms: all.length, a, zc, diff, compl, b1chk: form ? r.forms[form].b1_win === r.forms[form].k : null };
  });
  const cnt = (f) => res.filter(f).length;
  const N = res.length;
  const cat = { A: cnt((r) => r.a.stage === "A"), B: cnt((r) => r.a.stage === "B"), C: cnt((r) => r.a.stage === "C"), thin_data: cnt((r) => r.a.kind === "thin_data"), no_form: cnt((r) => r.a.kind === "no_form") };
  console.log(`\n== ${label}: 対象 ${rows.length}（材料あり ${N}、not_saved等 ${notSaved.length}: ${JSON.stringify(notSaved.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}))}）日数 ${new Set(rows.map((r) => r.date)).size}`);
  for (const [k, v] of Object.entries(cat)) console.log(`  ${k}: ${v} (${((v / N) * 100).toFixed(1)}%)`);
  const staged = res.filter((r) => r.a.stage);
  console.log("  段ありの n 分位(10,25,50,75,90):", q(staged.map((r) => r.a.n), [0.1, 0.25, 0.5, 0.75, 0.9]));
  console.log("  段ありの差 p-p0 pt 分位:", q(staged.map((r) => r.diff), [0.1, 0.25, 0.5, 0.75, 0.9]).map((x) => x.toFixed(1)));
  console.log("  形の内訳:", JSON.stringify(res.reduce((m, r) => ((m[r.form ?? "null"] = (m[r.form ?? "null"] || 0) + 1), m), {})));
  console.log("  複数形に当たる:", cnt((r) => r.nForms > 1), " b1_win と tri の一致(形あり):", cnt((r) => r.b1chk === true), "/", cnt((r) => r.b1chk !== null));
  console.log("  scope:", JSON.stringify(res.reduce((m, r) => { const k = (r.scope || "").split(":")[0]; m[k] = (m[k] || 0) + 1; return m; }, {})), " VC→NC へ替え:", cnt((r) => r.vc_fell_back !== null));
  console.log("  欠けた平均ST(course_n<30 がある):", cnt((r) => r.course_st?.course_n?.some((x) => x < 30)), " course_filled に null:", cnt((r) => r.course_st?.course_filled?.some((x) => x == null)));
  const thin = res.filter((r) => r.a.kind === "thin_data"); console.log("  thin_data の n:", thin.map((r) => r.forms?.[r.form]?.n ?? 0).join(","));
  console.log("  no_form の any.n 分位(0,10,25,50,75,90,100):", q(res.filter((r) => r.a.kind === "no_form").map((r) => r.forms.any.n), [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]));
  console.log("  no_form の any.n<30:", cnt((r) => r.a.kind === "no_form" && r.forms.any.n < 30), " <100:", cnt((r) => r.a.kind === "no_form" && r.forms.any.n < 100));
  console.log("  no_form の p(any) 分位:", q(res.filter((r) => r.a.kind === "no_form").map((r) => (r.forms.any.k / r.forms.any.n) * 100), [0.1, 0.5, 0.9]).map((x) => x.toFixed(1)));
  // 線の代替
  const alt = (fn) => { const o = { A: 0, B: 0, C: 0 }; for (const r of staged) o[fn(r)]++; return o; };
  const wil = (z) => (r) => { const [lo, hi] = wilson(r.a.k, r.a.n, z); const p0 = r.a.k0 / r.a.n0; return lo > p0 ? "A" : hi < p0 ? "C" : "B"; };
  console.log("  代替 Wilson z=1.645(90%):", JSON.stringify(alt(wil(1.645))), " z=1.28(80%):", JSON.stringify(alt(wil(1.28))));
  console.log("  代替 補集合との2比率 z>1.96:", JSON.stringify(alt((r) => (r.zc > 1.96 ? "A" : r.zc < -1.96 ? "C" : "B"))));
  console.log("  代替 補集合 z>1.96 かつ |p-p0|>=5pt:", JSON.stringify(alt((r) => (r.zc > 1.96 && r.diff >= 5 ? "A" : r.zc < -1.96 && r.diff <= -5 ? "C" : "B"))));
  console.log("  |p-p0|>=5pt の件数:", cnt((r) => r.a.stage && Math.abs(r.diff) >= 5), " >=10pt:", cnt((r) => r.a.stage && Math.abs(r.diff) >= 10));
  // 実際の結果
  const fin = res.filter((r) => r.rank1);
  const wr = (f) => { const x = fin.filter(f); return `${x.filter((r) => r.rank1 === 1).length}/${x.length}`; };
  console.log("  実際の1号艇1着 全:", wr(() => true), " A:", wr((r) => r.a.stage === "A"), " B:", wr((r) => r.a.stage === "B"), " C:", wr((r) => r.a.stage === "C"), " no_form:", wr((r) => r.a.kind === "no_form"), " thin:", wr((r) => r.a.kind === "thin_data"));
  const pr = fin.filter((r) => r.a.stage); const mp = pr.reduce((s, r) => s + r.a.k / r.a.n, 0) / pr.length; const m0 = pr.reduce((s, r) => s + r.a.k0 / r.a.n0, 0) / pr.length;
  const y = pr.map((r) => (r.rank1 === 1 ? 1 : 0)); const bs = (f) => pr.reduce((s, r, i) => s + (f(r) - y[i]) ** 2, 0) / pr.length;
  console.log(`  段ありの平均 p ${(mp * 100).toFixed(1)} 平均 p0 ${(m0 * 100).toFixed(1)} 実際 ${((y.reduce((a, b) => a + b, 0) / y.length) * 100).toFixed(1)}  Brier p ${bs((r) => r.a.k / r.a.n).toFixed(4)} p0 ${bs((r) => r.a.k0 / r.a.n0).toFixed(4)}`);
  // 日ごと
  if (label.startsWith("選ぶ4")) {
    const byDay = {}; for (const r of rows) { byDay[r.date] ??= { picked: 0, skip: 0, notsaved: 0 }; byDay[r.date].picked++; }
    for (const r of res) if (!r.a.stage) byDay[r.date].skip++;
    for (const r of notSaved) byDay[r.date].notsaved++;
    const dist = {}; for (const [d, v] of Object.entries(byDay)) { const k = v.skip + v.notsaved; dist[k] = (dist[k] || 0) + 1; }
    console.log("  日ごとの作らない本数（not_saved 含む）:", JSON.stringify(dist));
    console.log("  日ごと:", Object.entries(byDay).map(([d, v]) => `${d.slice(5)}:${v.picked}/${v.skip}/${v.notsaved}`).join(" "));
    // 重なり
    const keys = {}; for (const r of res) { keys[r.scope] = (keys[r.scope] || 0) + 1; }
    console.log("  同じ範囲キーの重複: キー数", Object.keys(keys).length, " 2回以上:", Object.values(keys).filter((v) => v > 1).length, " 最大", Math.max(...Object.values(keys)));
    console.log("  明細:"); for (const r of res) console.log("   ", r.raceId, r.raceStage, r.scope, r.form, r.a.stage ?? r.a.kind, r.a.n ?? r.forms?.[r.form]?.n ?? "", r.diff?.toFixed(1) ?? "", r.rank1);
  }
  return res;
}
const sel = db.filter((r) => r.selected);
summarize(sel, "選ぶ4本/日");
summarize(db.filter((r) => r.raceNumber === 12), "全会場の12R（感度）");
