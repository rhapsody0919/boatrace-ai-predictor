// 実行: node --env-file=.env.local scripts/analysis/series-points-scoring-hypotheses.mjs [--from=2026-06-01]
//
// 得点率の配点ルールの候補を、実データで突き合わせる（BOA-458 の手順2・3）。
//
// ## なぜ比較が必要か
//
// 公式の得点率一覧（`race/pointrank`）が出るのは **SG/G1 の4日目以降だけ**で、
// 「予選特選」「予選特賞」のような一般戦・G3固有の番組は SG/G1 に出てこない。
// つまり一般戦の配点は公式データでは照合できない。そこで2つの物差しを使う。
//
//   物差しA（厳密・SG/G1のみ）… `racer_series_points` の公式の得点・得点率と
//     完全一致するか。ここが崩れる候補は即座に却下できる
//   物差しB（間接・全開催）… 予選終了時点の得点率順の上位N人（N=準優の枠数）が、
//     **実際に準優に乗った選手**とどれだけ一致するか。一般戦の準優は得点率順
//     だけで決まらないことがあるため完全一致は期待できないが、配点が実際の規則に
//     近いほど一致が増える。候補間の**相対比較**に使う
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";
import { buildMeets, fetchAllByRaceId } from "../lib/meetBoundaries.js";
import {
  SCORE_POINTS,
  SPECIAL_SCORE_POINTS,
  TOKUSEN_SCORE_POINTS,
  normalizeStage,
  isExcludedStage,
  countsForSeriesScore,
  semifinalRaceIdsOf,
} from "../../src/components/race/seriesPoints.js";

/** PR #871 時点の「レース単位」の締め判定（候補比較のために残す） */
function pastPrelimRace(raceId, prelimEndRaceId) {
  if (!prelimEndRaceId) return false;
  return String(raceId) > String(prelimEndRaceId);
}

const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM = fromArg ? fromArg.slice("--from=".length) : "2026-06-01";

/**
 * 配点ルールの候補。`table(normalizedStage)` が着順→点数の表を返す。
 * 算入範囲（準優・優勝戦の除外、予選の締め）は全候補で共通
 * ＝PR #871 で公式と一致させた部分は動かさず、配点だけを比べる。
 */
const HYPOTHESES = [
  {
    key: "H0-legacy",
    label: "旧実装: ドリーム|選抜 → 12/10/9/7/6/5",
    table: (s) =>
      s.includes("ドリーム") || s.includes("選抜")
        ? SPECIAL_SCORE_POINTS
        : SCORE_POINTS,
  },
  {
    key: "H1-flat",
    label: "特別配点なし（全部 10/8/6/4/2/1）",
    table: () => SCORE_POINTS,
  },
  {
    key: "H2-dream",
    label: "ドリーム|DR のみ特別配点",
    table: (s) =>
      s.includes("ドリーム") || s.includes("DR")
        ? SPECIAL_SCORE_POINTS
        : SCORE_POINTS,
  },
  {
    key: "H3-dream+tokusen",
    label: "ドリーム|DR → 12/10/9/7/6/5、特選|特賞 → 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞")) return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H4-+senbatsu",
    label: "H3 に加えて 選抜 も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞") || s.includes("選抜"))
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H6-+tokubetsu",
    label: "H4 に加えて 特別（予選特別Ａ戦 等）も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (
        s.includes("特選") ||
        s.includes("特賞") ||
        s.includes("選抜") ||
        s.includes("特別")
      )
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H7-+medama",
    label: "H4 に加えて 目玉（ドラドキ目玉 等）も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (
        s.includes("特選") ||
        s.includes("特賞") ||
        s.includes("選抜") ||
        s.includes("目玉")
      )
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H5-senbatsu=dream",
    label: "H3 に加えて 選抜 は 12/10/9/7/6/5（旧実装の扱い）",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR") || s.includes("選抜"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞")) return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
];

/**
 * 候補の差が出る節だけを取り出すための分類。
 * 全節で平均すると、その表記が出ない節（大多数）に薄められて差が見えない。
 */
const SUBSETS = [
  { key: "all", label: "全節", has: () => true },
  {
    key: "has-dream",
    label: "予選期間内にドリーム/DRがある節",
    has: (s) => s.includes("ドリーム") || s.includes("DR"),
  },
  {
    key: "has-tokusen",
    label: "予選期間内に特選/特賞がある節",
    has: (s) => s.includes("特選") || s.includes("特賞"),
  },
  {
    key: "has-senbatsu",
    label: "予選期間内に選抜がある節",
    has: (s) => s.includes("選抜"),
  },
  {
    key: "has-tokubetsu",
    label: "予選期間内に特別（特選・特賞・特別選抜戦を除く）がある節",
    has: (s) =>
      s.includes("特別") && !s.includes("特選") && !s.includes("特賞") && !s.includes("選抜"),
  },
  {
    key: "has-medama",
    label: "予選期間内に目玉がある節",
    has: (s) => s.includes("目玉"),
  },
];

// ---- データ取得 -------------------------------------------------------------
// 出走表28万行を毎回引くと3分かかる。候補を足して比べ直す使い方をするので、
// `--cache` で一時ディレクトリに置いた取得結果を再利用できるようにしてある
const CACHE = process.argv.includes("--cache")
  ? path.join(os.tmpdir(), "boatai-series-points-hypotheses.json")
  : null;

async function load() {
  if (CACHE && fs.existsSync(CACHE)) {
    console.log(`キャッシュから読み込み: ${CACHE}`);
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  console.log("取得中…（出走表が28万行あるので数分かかる）");
  const conds = await fetchAllByRaceId(
    supabase,
    "race_conditions",
    "race_id, race_stage, series_day, is_final_day",
  );
  const entries = await fetchAllByRaceId(
    supabase,
    "race_entries",
    "race_id, boat_number, racer_id, player_name",
  );
  const results = await fetchAllByRaceId(
    supabase,
    "race_results",
    "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
  );
  const { data: official, error } = await supabase
    .from("racer_series_points")
    .select(
      "venue_code, meet_start_date, racer_id, rank, score_rate, total_points, penalty_points, remarks",
    );
  if (error) throw new Error(`racer_series_points: ${error.message}`);
  const payload = { conds, entries, results, official: official ?? [] };
  if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(payload));
  return payload;
}

const { conds, entries, results, official } = await load();

const resultById = new Map(results.map((r) => [r.race_id, r]));
const entriesByRace = new Map();
for (const e of entries) {
  if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
  entriesByRace.get(e.race_id).push(e);
}

const allMeets = buildMeets(conds);
const meets = allMeets.filter(
  (m) => m.dates.at(-1) >= FROM && m.prelimEndRaceId !== null,
);
console.log(
  `節: ${meets.length}（${FROM} 以降に終わり、予選の締めが特定できたもの）  出走表: ${entries.length}行`,
);

/** その結果行で、その艇番が何着だったか（`finishPositionOf` と同じ規則） */
function rankOf(result, boatNumber) {
  for (const p of [1, 2, 3, 4, 5, 6]) {
    if (result[`rank${p}`] === boatNumber) return p;
  }
  return null;
}

/**
 * 算入範囲（予選の締め）の候補。
 *
 * PR #871 は「種別が『予選』の最後のレース」で切ったが、**すべての予選レースに
 * 「予選」と付ける会場だけ**でしか正しくない。丸亀の一般戦は 1R〜5R が「予選」で
 * 6R以降が「かけうどん６」「蒼月まるる特賞」のような会場固有名なので、最後の
 * 「予選」より後ろが丸ごと落ちる。逆に蒲郡は最終予選日の 10R〜12R が
 * 「一般特賞」「一般特選」＝予選終了後なので、日単位で切ると入れてはいけない。
 * どちらが実データに合うかを準優進出者との一致で比べる。
 */
/** 現行の実装（`countsForSeriesScore`）。配点候補の比較はこれを使う */
const SHIPPED_CUT = {
  key: "現行",
  label: "現行の `countsForSeriesScore`",
  keep: (meet, row) =>
    countsForSeriesScore(row.race_stage ?? "", row.race_id, meet.prelimEndRaceId),
};

const CUTS = [
  SHIPPED_CUT,
  {
    key: "C0-last-prelim-race",
    label: "PR #871: 種別に「予選」を含む最後のレースまで",
    keep: (meet, row) => !pastPrelimRace(row.race_id, meet.prelimEndRaceId),
  },
  {
    key: "C1-end-of-day",
    label: "「予選」を含む最後のレースが**ある日の最終レース**まで",
    keep: (meet, row) =>
      meet.prelimEndRaceId === null ||
      row.race_id.slice(0, 10) <= meet.prelimEndRaceId.slice(0, 10),
  },
  {
    key: "C2-end-of-day-minus-ippan",
    label: "C1 だが、その日の「一般」と付くレースは除く",
    keep: (meet, row) => {
      if (meet.prelimEndRaceId === null) return true;
      const sameDayOrBefore =
        row.race_id.slice(0, 10) <= meet.prelimEndRaceId.slice(0, 10);
      if (!sameDayOrBefore) return false;
      if (!pastPrelimRace(row.race_id, meet.prelimEndRaceId)) return true;
      return !(row.race_stage ?? "").includes("一般");
    },
  },
  {
    key: "C4-day-range-minus-ippan",
    label: "予選最終日までの全日で「一般」と付くレースを除く（C2の単純化）",
    keep: (meet, row) => {
      if (meet.prelimEndRaceId === null) return true;
      if (row.race_id.slice(0, 10) > meet.prelimEndRaceId.slice(0, 10))
        return false;
      return !(row.race_stage ?? "").includes("一般");
    },
  },
  {
    key: "C3-before-first-semifinal",
    label: "PR #871 以前: 最初の準優より前まで",
    keep: (meet, row) => {
      const firstSemifinal = meet.rows
        .filter((r) => (r.race_stage ?? "").includes("準優"))
        .map((r) => r.race_id)
        .sort()[0];
      return !firstSemifinal || row.race_id < firstSemifinal;
    },
  },
];

/** 候補ごとに節内の選手別の得点・走数を出す */
function scoreMeet(meet, hypothesis, cut = SHIPPED_CUT) {
  const byRacer = new Map();
  for (const row of meet.rows) {
    const stage = row.race_stage ?? "";
    if (isExcludedStage(stage)) continue;
    if (!cut.keep(meet, row)) continue;

    const result = resultById.get(row.race_id);
    // 結果がまだ無いレースは分母に入れない（`computeSeriesScore` と同じ）
    if (!result || result.rank1 === null || result.rank1 === undefined) continue;
    const table = hypothesis.table(normalizeStage(stage));
    for (const e of entriesByRace.get(row.race_id) ?? []) {
      const cur = byRacer.get(e.racer_id) ?? {
        racerId: e.racer_id,
        playerName: e.player_name,
        points: 0,
        runs: 0,
      };
      cur.runs += 1;
      // 失格・落水・転覆は0点だが分母には入れる
      const rank = rankOf(result, e.boat_number);
      if (rank !== null) cur.points += table[rank] ?? 0;
      byRacer.set(e.racer_id, cur);
    }
  }
  return [...byRacer.values()]
    .filter((r) => r.runs > 0)
    .map((r) => ({ ...r, rate: r.points / r.runs }))
    .sort((a, b) => b.rate - a.rate);
}

/** 節で実際に準優に乗った選手と、枠数 */
function semifinalOf(meet) {
  // 出荷コードと同じ判定を使う（「準優進出戦」を準優に数えない）
  const ids = semifinalRaceIdsOf(meet.rows);
  const racers = new Set();
  for (const id of ids) {
    for (const e of entriesByRace.get(id) ?? []) racers.add(e.racer_id);
  }
  return { slots: ids.length * 6, racers, raceCount: ids.length };
}

/**
 * 節の最終日に出走が無い選手（途中帰郷の推定）。
 *
 * **この推定は外れることがある**。実測では離脱と判定した629名のうち39名
 * （31節）が実際には準優に乗っており、その分は構造的に当てられない
 * （候補から外れるのに正解集合には入る）。物差しBの絶対値は0.8pt程度
 * これで目減りするが、全候補に同じ条件がかかるので相対比較には使える。
 */
function withdrawnOf(meet) {
  const lastDay = meet.dates.at(-1);
  const ran = new Set();
  const all = new Set();
  for (const row of meet.rows) {
    for (const e of entriesByRace.get(row.race_id) ?? []) {
      all.add(e.racer_id);
      if (row.race_id.startsWith(lastDay)) ran.add(e.racer_id);
    }
  }
  return new Set([...all].filter((id) => !ran.has(id)));
}

// ---- 物差しA: 公式データとの完全一致（SG/G1のみ） ---------------------------
const officialByMeet = new Map();
for (const row of official ?? []) {
  const key = `${row.venue_code}|${row.meet_start_date}`;
  if (!officialByMeet.has(key)) officialByMeet.set(key, []);
  officialByMeet.get(key).push(row);
}

console.log("\n=== 物差しA: 公式の得点率一覧との一致（SG/G1のみ） ===");
for (const hypothesis of HYPOTHESES) {
  const lines = [];
  for (const [key, rows] of officialByMeet) {
    const [venueCode, meetStart] = key.split("|");
    const meet = allMeets.find(
      (m) =>
        m.venueCode === Number(venueCode) && m.dates[0] === meetStart,
    );
    if (!meet) continue;
    const scored = new Map(scoreMeet(meet, hypothesis).map((r) => [r.racerId, r]));
    let match = 0;
    let checked = 0;
    let skippedPenalty = 0;
    for (const o of rows) {
      // 公式が得点率を出していない選手（賞典除外・途中帰郷）は比較対象外
      if (o.score_rate === null || o.total_points === null) continue;
      // **減点がある選手は対象外**。公式は `(着順点 − 減点) / 走数` を出しており
      // （多摩川G1の実測: 岩瀬 38点・減点10・6走 → 4.67）、当社は減点を持って
      // いないため配点の比較にならない。減点そのものは別課題として切り出す
      if (o.penalty_points) {
        skippedPenalty += 1;
        continue;
      }
      const mine = scored.get(o.racer_id);
      if (!mine) continue;
      checked += 1;
      if (
        mine.points === o.total_points &&
        Math.abs(mine.rate - Number(o.score_rate)) < 0.005
      ) {
        match += 1;
      }
    }
    lines.push(
      `${VENUE_NAMES[Number(venueCode)] ?? venueCode}${meetStart} ${match}/${checked}` +
        (skippedPenalty ? `（減点あり${skippedPenalty}名を除外）` : ""),
    );
  }
  console.log(`  ${hypothesis.key.padEnd(18)} ${lines.join("  ")}`);
}

// ---- 物差しB: 準優進出者との一致（全開催） ----------------------------------
console.log(
  "\n=== 物差しB: 予選終了時点の得点率上位N人 vs 実際の準優進出者 ===",
);
console.log(
  "  （N=準優の枠数。一般戦の準優は得点率順だけで決まらないため完全一致は期待できない。候補間の相対比較に使う）",
);

const summary = new Map();
for (const hypothesis of HYPOTHESES) summary.set(hypothesis.key, new Map());

let usableMeets = 0;
for (const meet of meets) {
  const sf = semifinalOf(meet);
  if (sf.raceCount === 0 || sf.racers.size === 0) continue;
  // 枠数と実際の進出者数が食い違う節（欠場の繰り上がり等）は除く
  if (sf.racers.size !== sf.slots) continue;
  const withdrawn = withdrawnOf(meet);
  usableMeets += 1;

  // この節の予選期間内に出た種別（部分集合の判定に使う）
  const prelimStages = meet.rows
    .filter((r) =>
      countsForSeriesScore(r.race_stage ?? "", r.race_id, meet.prelimEndRaceId),
    )
    .map((r) => normalizeStage(r.race_stage ?? ""));
  const subsetKeys = SUBSETS.filter((s) =>
    prelimStages.some((st) => s.has(st)),
  ).map((s) => s.key);

  for (const hypothesis of HYPOTHESES) {
    const ranked = scoreMeet(meet, hypothesis).filter(
      (r) => !withdrawn.has(r.racerId),
    );
    const topN = new Set(ranked.slice(0, sf.slots).map((r) => r.racerId));
    let hit = 0;
    for (const id of topN) if (sf.racers.has(id)) hit += 1;
    const bucket = summary.get(hypothesis.key);
    for (const key of subsetKeys) {
      const cur = bucket.get(key) ?? { meets: 0, hit: 0, total: 0, exact: 0 };
      cur.meets += 1;
      cur.hit += hit;
      cur.total += sf.slots;
      if (hit === sf.slots) cur.exact += 1;
      bucket.set(key, cur);
    }
  }
}
console.log(`  対象の節: ${usableMeets}\n`);
for (const s of SUBSETS) {
  const any = HYPOTHESES.some((h) => summary.get(h.key).get(s.key));
  if (!any) continue;
  console.log(`  ▼ ${s.label}`);
  console.log(
    ["    候補", "節", "一致/枠", "一致率", "全枠一致の節"].join("\t"),
  );
  for (const hypothesis of HYPOTHESES) {
    const v = summary.get(hypothesis.key).get(s.key);
    if (!v) continue;
    console.log(
      "    " +
        [
          hypothesis.key,
          v.meets,
          `${v.hit}/${v.total}`,
          `${((v.hit / v.total) * 100).toFixed(2)}%`,
          `${v.exact} (${((v.exact / v.meets) * 100).toFixed(1)}%)`,
        ].join("\t"),
    );
  }
  console.log("");
}

console.log("\n=== 候補の説明 ===");
for (const h of HYPOTHESES) console.log(`  ${h.key.padEnd(18)} ${h.label}`);

// ---- 算入範囲（予選の締め）の比較 -------------------------------------------
// 配点は上で選んだ候補に固定し、切り方だけを変えて比べる
const BEST = HYPOTHESES.find((h) => h.key === "H4-+senbatsu");

console.log("\n\n=== 算入範囲の候補: 公式の得点率一覧との一致（SG/G1のみ） ===");
for (const cut of CUTS) {
  const lines = [];
  for (const [key, rows] of officialByMeet) {
    const [venueCode, meetStart] = key.split("|");
    const meet = allMeets.find(
      (m) => m.venueCode === Number(venueCode) && m.dates[0] === meetStart,
    );
    if (!meet) continue;
    const scored = new Map(
      scoreMeet(meet, BEST, cut).map((r) => [r.racerId, r]),
    );
    let match = 0;
    let checked = 0;
    for (const o of rows) {
      if (o.score_rate === null || o.total_points === null) continue;
      if (o.penalty_points) continue;
      const mine = scored.get(o.racer_id);
      if (!mine) continue;
      checked += 1;
      if (
        mine.points === o.total_points &&
        Math.abs(mine.rate - Number(o.score_rate)) < 0.005
      )
        match += 1;
    }
    lines.push(
      `${VENUE_NAMES[Number(venueCode)] ?? venueCode}${meetStart} ${match}/${checked}`,
    );
  }
  console.log(`  ${cut.key.padEnd(30)} ${lines.join("  ")}`);
}

console.log("\n=== 算入範囲の候補: 準優進出者との一致 ===");
const cutSummary = new Map(CUTS.map((c) => [c.key, new Map()]));
for (const meet of meets) {
  const sf = semifinalOf(meet);
  if (sf.raceCount === 0 || sf.racers.size !== sf.slots) continue;
  const withdrawn = withdrawnOf(meet);
  // 「予選」ラベルの最終レースより後に、その日のうちに残っているレースが
  // あるか（＝C0とC1で差が出る節か）
  const hasTailRaces =
    meet.prelimEndRaceId !== null &&
    meet.rows.some(
      (r) =>
        !isExcludedStage(r.race_stage ?? "") &&
        pastPrelimRace(r.race_id, meet.prelimEndRaceId) &&
        r.race_id.slice(0, 10) === meet.prelimEndRaceId.slice(0, 10),
    );
  for (const cut of CUTS) {
    const ranked = scoreMeet(meet, BEST, cut).filter(
      (r) => !withdrawn.has(r.racerId),
    );
    const topN = new Set(ranked.slice(0, sf.slots).map((r) => r.racerId));
    let hit = 0;
    for (const id of topN) if (sf.racers.has(id)) hit += 1;
    for (const key of hasTailRaces ? ["all", "tail"] : ["all"]) {
      const b = cutSummary.get(cut.key);
      const cur = b.get(key) ?? { meets: 0, hit: 0, total: 0, exact: 0 };
      cur.meets += 1;
      cur.hit += hit;
      cur.total += sf.slots;
      if (hit === sf.slots) cur.exact += 1;
      b.set(key, cur);
    }
  }
}
for (const [key, label] of [
  ["all", "全節"],
  ["tail", "最終予選日に「予選」ラベル外のレースが残る節（C0とC1で差が出る節）"],
]) {
  console.log(`  ▼ ${label}`);
  console.log(
    ["    候補", "節", "一致/枠", "一致率", "全枠一致の節"].join("\t"),
  );
  for (const cut of CUTS) {
    const v = cutSummary.get(cut.key).get(key);
    if (!v) continue;
    console.log(
      "    " +
        [
          cut.key,
          v.meets,
          `${v.hit}/${v.total}`,
          `${((v.hit / v.total) * 100).toFixed(2)}%`,
          `${v.exact} (${((v.exact / v.meets) * 100).toFixed(1)}%)`,
        ].join("\t"),
    );
  }
  console.log("");
}
for (const c of CUTS) console.log(`  ${c.key.padEnd(30)} ${c.label}`);
