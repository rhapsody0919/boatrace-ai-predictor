// 実行: node --env-file=.env.local scripts/analysis/race-stage-inventory.mjs [--json]
//
// `race_conditions.race_stage` の実データ棚卸し（BOA-458 の手順1）。
//
// なぜ要るか: `race_stage` は racelist ページの表示文字列をほぼ生で保存している
// （`scripts/lib/raceStageParser.js`）ため、会場の自由記述がそのまま入る。
// 得点率の配点判定（`src/components/race/seriesPoints.js`）は部分一致なので、
// 表記ゆれで当たり外れが出る。まず **どんな表記が何件あり、そのうち何件が
// 予選期間内（＝得点率に算入される）か** を出さないと配点ルールを決められない。
//
// 出力の見方:
//   予選内 … 得点率に算入される件数（`countsForSeriesScore` が true）。配点が効く
//   節後   … 算入されないもの（勝ち上がり戦・予選最終日より後・「一般」付き）
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";
import {
  classifyStage,
  countsForSeriesScore,
} from "../../src/components/race/seriesPoints.js";
import { buildMeets, fetchAllByRaceId } from "../lib/meetBoundaries.js";

/** 旧実装（PR #871 時点）の判定。差分を出すために残す */
function legacyKind(stage) {
  const s = stage ?? "";
  if (s.includes("準優") || s.includes("優勝戦")) return "excluded";
  if (s.includes("ドリーム") || s.includes("選抜")) return "dream";
  return "normal";
}

const asJson = process.argv.includes("--json");

const conds = await fetchAllByRaceId(
  supabase,
  "race_conditions",
  "race_id, race_stage, series_day, is_final_day",
);
const races = await fetchAllByRaceId(supabase, "races", "race_id, race_grade");
const gradeById = new Map(races.map((r) => [r.race_id, r.race_grade ?? "?"]));

const meets = buildMeets(conds);

const stats = new Map();
for (const meet of meets) {
  for (const row of meet.rows) {
    const stage = row.race_stage ?? "";
    if (!stage) continue;
    if (!stats.has(stage)) {
      stats.set(stage, {
        stage,
        n: 0,
        inPrelim: 0,
        after: 0,
        grades: new Map(),
        venues: new Set(),
      });
    }
    const s = stats.get(stage);
    s.n += 1;
    // 「予選期間内」の判定は得点率の集計と同じ共通関数を通す
    if (countsForSeriesScore(stage, row.race_id, meet.prelimEndRaceId)) {
      s.inPrelim += 1;
    } else {
      s.after += 1;
    }
    const g = gradeById.get(row.race_id) ?? "?";
    s.grades.set(g, (s.grades.get(g) ?? 0) + 1);
    s.venues.add(Number(row.race_id.slice(11, 13)));
  }
}

const rows = [...stats.values()]
  .map((s) => ({
    stage: s.stage,
    n: s.n,
    inPrelim: s.inPrelim,
    after: s.after,
    grades: [...s.grades.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g}:${n}`)
      .join(" "),
    venueNames: [...s.venues]
      .sort((a, b) => a - b)
      .map((v) => VENUE_NAMES[v] ?? v)
      .join(","),
    legacy: legacyKind(s.stage),
    current: classifyStage(s.stage),
  }))
  .sort((a, b) => b.inPrelim - a.inPrelim || b.n - a.n);

if (asJson) {
  console.log(JSON.stringify({ meets: meets.length, stages: rows }, null, 2));
  process.exit(0);
}

const total = rows.reduce((a, r) => a + r.n, 0);
const totalIn = rows.reduce((a, r) => a + r.inPrelim, 0);
console.log(`節: ${meets.length}  レース: ${total}  表記の種類: ${rows.length}`);
console.log(`うち予選期間内（得点率に算入される）: ${totalIn}`);
console.log(
  `予選ラベルのレースが1本も無い節: ${meets.filter((m) => m.prelimEndRaceId === null).length}`,
);

const changed = rows.filter(
  (r) => r.legacy !== r.current && r.inPrelim > 0,
);
console.log(
  `\n■ 旧実装と配点が変わる表記（予選期間内に出るものだけ）: ${changed.length} 種 / ${changed.reduce((a, r) => a + r.inPrelim, 0)} レース`,
);
console.log(["  表記", "予選内", "節後", "旧", "新", "グレード"].join("\t"));
for (const r of changed.slice(0, 80)) {
  console.log(
    "  " +
      [r.stage, r.inPrelim, r.after, r.legacy, r.current, r.grades].join("\t"),
  );
}
if (changed.length > 80) console.log(`  … 他 ${changed.length - 80} 件`);

console.log("\n■ 配点区分ごとの内訳");
const byKind = new Map();
for (const r of rows) {
  const cur = byKind.get(r.current) ?? { kinds: 0, n: 0, inPrelim: 0 };
  cur.kinds += 1;
  cur.n += r.n;
  cur.inPrelim += r.inPrelim;
  byKind.set(r.current, cur);
}
console.log("  区分\t表記の種類\tレース数\t予選期間内");
for (const [k, v] of [...byKind.entries()].sort(
  (a, b) => b[1].inPrelim - a[1].inPrelim,
)) {
  console.log(`  ${k}\t${v.kinds}\t${v.n}\t${v.inPrelim}`);
}

// 特別配点になる表記の一覧（レビューで目視確認できる粒度で出す）
for (const kind of ["dream", "tokusen"]) {
  const list = rows.filter((r) => r.current === kind && r.inPrelim > 0);
  console.log(
    `\n■ ${kind} 判定で予選期間内に出る表記: ${list.length} 種 / ${list.reduce((a, r) => a + r.inPrelim, 0)} レース`,
  );
  for (const r of list) {
    console.log(`  ${r.stage}\t${r.inPrelim}\t${r.grades}\t${r.venueNames}`);
  }
}

// 予選期間内に出る「normal」判定のうち、会場固有名（予選/一般を含まない）のもの。
// 本当は特別配点かもしれない未検証の残り＝取りこぼしの候補
const suspicious = rows.filter(
  (r) =>
    r.current === "normal" &&
    r.inPrelim > 0 &&
    !r.stage.includes("予選") &&
    !r.stage.includes("一般"),
);
console.log(
  `\n■ 予選期間内の「通常配点」のうち会場固有名（＝配点が未検証で残るもの）: ${suspicious.length} 種 / ${suspicious.reduce((a, r) => a + r.inPrelim, 0)} レース`,
);
for (const r of suspicious.slice(0, 50)) {
  console.log(`  ${r.stage}\t${r.inPrelim}\t${r.grades}\t${r.venueNames}`);
}
if (suspicious.length > 50) console.log(`  … 他 ${suspicious.length - 50} 件`);
