/**
 * courseRate（コース別勝率）の入力を切り替えた場合の予測力・複勝回収率の前後比較
 * （BOA-284 / docs/design/course-entry-tendency-rework/ Task 2）。
 *
 * 既存のanalyze-indicator-predictive-power.js・backtest-course-rate-only.jsは
 * 「現在のracer_aggregated_stats」で過去レースを評価するため、評価対象のレース自身が
 * 集計に含まれる（リーク）。前後比較を公平にするため、本スクリプトは日ごとに
 * 「その日より前のレースだけ」で選手別の集計を更新しながら評価する（ウォークフォワード）。
 * DBへの書き込みは行わない。
 *
 * 比較する4つの方式（いずれもcourseRate = そのコースでの勝率）:
 *   old      : 切り替え前。キー=枠番（旧列course_1〜6は常に艇番と一致していたため
 *              「枠番別の勝率」と等価）、枠番で引く
 *   newWaku  : `course_race_counts`を実進入コースに切り替えた場合。キー=実際に進入した
 *              コース、参照側は従来どおり今日の枠番で引く
 *   newExp   : キー=実際に進入したコース、参照側は「その選手がその枠番から最も
 *              入りやすいコース」（過去の実績の最頻コース、無ければ枠番）で引く
 *   oracle   : キー=実際に進入したコース、参照側は「そのレースで実際に入ったコース」
 *              で引く。本番では使えない（レース前に分からない）上限値の参考
 *
 * 使い方:
 *   node scripts/analysis/compare-course-rate-sources.js [--from-test=2026-03-01]
 *     [--cache=/tmp/course-rate-cache.json] [--out=data/analysis/course-entry-tendency/xxx.json]
 */
import fs from "node:fs";
import path from "node:path";
import { supabase, fetchAll } from "../lib/supabaseClient.js";

const VARIANTS = ["old", "newWaku", "newExp", "oracle"];
const MIN_SAMPLES_LIST = [1, 5]; // 1=analyze-indicator-predictive-power.js相当、5=本番の複勝予想(MIN_COURSE_SAMPLES)

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
  };
  return {
    fromTest: get("from-test") ?? "2026-03-01",
    cache: get("cache"),
    out: get("out"),
  };
}

// ===== データ取得 =====

async function loadData(cachePath) {
  if (cachePath && fs.existsSync(cachePath)) {
    console.log(`キャッシュ読み込み: ${cachePath}`);
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }
  console.log("race_results取得中...");
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, is_cancelled, is_no_race, payout_place_1, payout_place_2, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
    // ページネーションの取りこぼし・重複を避けるため、順序を固定する
    (q) => q.not("rank1", "is", null).not("rank2", "is", null).order("race_id"),
  );
  console.log(`  ${results.length}件\nrace_entries取得中...`);
  const entries = await fetchAll(
    "race_entries",
    "race_id, boat_number, racer_id",
    (q) => q.order("race_id").order("boat_number"),
  );
  console.log(`  ${entries.length}件`);
  const data = { results, entries };
  if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(data));
  return data;
}

// ===== 選手別の集計（その日より前のレースのみ） =====

function makeStore() {
  return new Map(); // racerId -> { byWaku, byCourse, wakuCourse }
}

function statsOf(store, racerId) {
  let s = store.get(racerId);
  if (!s) {
    s = { byWaku: {}, byCourse: {}, wakuCourse: {} };
    store.set(racerId, s);
  }
  return s;
}

function bump(map, key, isWin) {
  const cell = (map[key] ??= { total: 0, wins: 0 });
  cell.total += 1;
  if (isWin) cell.wins += 1;
}

function actualCourseOf(result, boat) {
  const c = result[`actual_course_${boat}`];
  return Number.isInteger(c) && c >= 1 && c <= 6 ? c : null;
}

function update(store, race) {
  for (const boat of race.boats) {
    if (boat.racerId == null) continue;
    const s = statsOf(store, boat.racerId);
    const isWin = race.rank1 === boat.number;
    bump(s.byWaku, boat.number, isWin);
    if (boat.course !== null) {
      bump(s.byCourse, boat.course, isWin);
      const wc = (s.wakuCourse[boat.number] ??= {});
      wc[boat.course] = (wc[boat.course] ?? 0) + 1;
    }
  }
}

/** その選手がその枠番から最も入りやすいコース。実績が無ければ枠番 */
function expectedCourse(stats, waku) {
  const wc = stats?.wakuCourse[waku];
  if (!wc) return waku;
  let best = waku;
  let bestCount = wc[waku] ?? 0;
  for (const [course, count] of Object.entries(wc)) {
    if (count > bestCount) {
      best = Number(course);
      bestCount = count;
    }
  }
  return best;
}

function snapshot(store, race) {
  return race.boats.map((boat) => {
    const s = boat.racerId == null ? null : store.get(boat.racerId);
    const exp = s ? expectedCourse(s, boat.number) : boat.number;
    return {
      number: boat.number,
      old: s?.byWaku[boat.number] ?? null,
      newWaku: s?.byCourse[boat.number] ?? null,
      newExp: s?.byCourse[exp] ?? null,
      oracle: boat.course === null ? null : (s?.byCourse[boat.course] ?? null),
    };
  });
}

// ===== 評価 =====

const rateOf = (cell, min) =>
  cell && cell.total >= min ? (cell.wins / cell.total) * 100 : null;

/** 同値は順位の枠を按分して上位2位に入る確率を返す（同値のタイブレーク由来の偏りを避ける） */
function top2Credit(value, others) {
  const greater = others.filter((v) => v > value).length;
  const equal = others.filter((v) => v === value).length + 1;
  const low = greater + 1;
  const high = low + equal - 1;
  return Math.max(0, Math.min(high, 2) - low + 1) / equal;
}

/** 1着艇を除く5艇のうち、実際の2着艇が上位2位に入る割合（ランダムなら2/有効艇数） */
function predictive(races, variant, min) {
  let n = 0;
  let credit = 0;
  let chance = 0;
  for (const race of races) {
    const cands = race.snap.filter((b) => b.number !== race.rank1);
    const vals = cands.map((b) => ({
      number: b.number,
      v: rateOf(b[variant], min),
    }));
    const valid = vals.filter((x) => x.v !== null);
    const second = valid.find((x) => x.number === race.rank2);
    if (valid.length < 2 || !second) continue;
    n += 1;
    credit += top2Credit(
      second.v,
      valid.filter((x) => x !== second).map((x) => x.v),
    );
    chance += 2 / valid.length;
  }
  return {
    n,
    top2: n ? (credit / n) * 100 : null,
    chance: n ? (chance / n) * 100 : null,
  };
}

/** 複勝予想（コース別勝率の上位2艇、各100円）。有効な艇が2未満のレースは対象外 */
function placePick(races, variant, min) {
  const perRace = new Map(); // raceId -> { hit, payout }
  for (const race of races) {
    const valid = race.snap
      .map((b) => ({ number: b.number, v: rateOf(b[variant], min) }))
      .filter((x) => x.v !== null);
    if (valid.length < 2) continue;
    const picks = [...valid]
      .sort((a, b) => b.v - a.v)
      .slice(0, 2)
      .map((x) => x.number);
    let hit = false;
    let payout = 0;
    for (const boat of picks) {
      if (boat === race.rank1 || boat === race.rank2) {
        hit = true;
        payout += (boat === race.rank1 ? race.payout1 : race.payout2) || 0;
      }
    }
    perRace.set(race.raceId, {
      hit: hit ? 1 : 0,
      payout,
      invest: picks.length * 100,
    });
  }
  return perRace;
}

function summarizePick(perRace) {
  let hits = 0;
  let payout = 0;
  let invest = 0;
  for (const r of perRace.values()) {
    hits += r.hit;
    payout += r.payout;
    invest += r.invest;
  }
  const n = perRace.size;
  return {
    n,
    hitRate: n ? (hits / n) * 100 : null,
    recovery: invest ? (payout / invest) * 100 : null,
  };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stderr(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length,
  );
}

/** 共通レース上での差（variant - old）と標準誤差。同じレースの対応のある差 */
function pairedDiff(pickA, pickB) {
  const hitDiffs = [];
  const recDiffs = [];
  for (const [id, a] of pickA) {
    const b = pickB.get(id);
    if (!b) continue;
    hitDiffs.push((a.hit - b.hit) * 100);
    recDiffs.push(((a.payout - b.payout) / a.invest) * 100);
  }
  return {
    n: hitDiffs.length,
    hitDiff: mean(hitDiffs),
    hitSe: stderr(hitDiffs),
    recDiff: mean(recDiffs),
    recSe: stderr(recDiffs),
  };
}

const f = (x, d = 1) => (x === null || x === undefined ? "-" : x.toFixed(d));

async function main() {
  const { fromTest, cache, out } = parseArgs();
  if (!supabase) {
    console.error("Supabase未設定");
    process.exit(1);
  }
  const { results, entries } = await loadData(cache);

  const entriesByRace = new Map();
  for (const e of entries) {
    if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
    entriesByRace.get(e.race_id).push(e);
  }

  const races = [];
  for (const r of results) {
    if (r.is_cancelled || r.is_no_race) continue;
    const es = entriesByRace.get(r.race_id);
    if (!es || es.length < 6) continue;
    races.push({
      raceId: r.race_id,
      date: r.race_id.slice(0, 10),
      rank1: r.rank1,
      rank2: r.rank2,
      payout1: r.payout_place_1,
      payout2: r.payout_place_2,
      boats: es.map((e) => ({
        number: e.boat_number,
        racerId: e.racer_id,
        course: actualCourseOf(r, e.boat_number),
      })),
    });
  }
  races.sort((a, b) => (a.raceId < b.raceId ? -1 : 1));
  console.log(`対象レース: ${races.length}件（評価開始 ${fromTest}）\n`);

  // 日ごとに、その日より前の集計で評価してから、その日のレースで集計を更新する
  const store = makeStore();
  const evaluated = [];
  let i = 0;
  while (i < races.length) {
    const date = races[i].date;
    let j = i;
    while (j < races.length && races[j].date === date) j++;
    const day = races.slice(i, j);
    if (date >= fromTest) {
      for (const race of day)
        evaluated.push({ ...race, snap: snapshot(store, race) });
    }
    for (const race of day) update(store, race);
    i = j;
  }
  console.log(`評価対象: ${evaluated.length}レース\n`);

  const report = { fromTest, races: evaluated.length, byMin: {} };

  for (const min of MIN_SAMPLES_LIST) {
    console.log(
      `==================== 走数の下限 ${min}走以上 ====================`,
    );

    // カバー率
    console.log(
      "\n[カバー率] courseRateが算出できた艇の割合 / 複勝予想の対象レース(有効艇2以上)",
    );
    const coverage = {};
    for (const v of VARIANTS) {
      let boatsValid = 0;
      let boatsAll = 0;
      let racesOk = 0;
      for (const race of evaluated) {
        const valid = race.snap.filter(
          (b) => rateOf(b[v], min) !== null,
        ).length;
        boatsValid += valid;
        boatsAll += race.snap.length;
        if (valid >= 2) racesOk += 1;
      }
      coverage[v] = {
        boatPct: (boatsValid / boatsAll) * 100,
        racePct: (racesOk / evaluated.length) * 100,
      };
      console.log(
        `  ${v.padEnd(8)} 艇 ${f(coverage[v].boatPct)}% / レース ${f(coverage[v].racePct)}%`,
      );
    }

    // 予測力（各方式の有効データ）
    console.log(
      "\n[予測力] 1着艇を除く5艇のうち、2着艇が上位2位に入る割合（ランダムは有効艇数から算出）",
    );
    const pred = {};
    for (const v of VARIANTS) {
      pred[v] = predictive(evaluated, v, min);
      console.log(
        `  ${v.padEnd(8)} n=${String(pred[v].n).padStart(6)}  上位2位計 ${f(pred[v].top2)}%  (ランダム ${f(pred[v].chance)}%、差 ${f(pred[v].top2 - pred[v].chance)}pt)`,
      );
    }

    // 複勝予想（各方式の有効データ）
    console.log("\n[複勝予想] 上位2艇、各100円（各方式で有効なレースのみ）");
    const picks = {};
    const pickSummary = {};
    for (const v of VARIANTS) {
      picks[v] = placePick(evaluated, v, min);
      pickSummary[v] = summarizePick(picks[v]);
      console.log(
        `  ${v.padEnd(8)} ${String(pickSummary[v].n).padStart(6)}件 | 的中 ${f(pickSummary[v].hitRate)}% | 回収 ${f(pickSummary[v].recovery)}%`,
      );
    }

    // 共通レース上の対応のある差（old, newWaku, newExpの全てで有効なレース）
    const common = new Set(
      [...picks.old.keys()].filter(
        (id) => picks.newWaku.has(id) && picks.newExp.has(id),
      ),
    );
    const restrict = (m) => new Map([...m].filter(([id]) => common.has(id)));
    console.log(
      `\n[共通レース ${common.size}件での比較] 3方式すべてで有効なレースに絞った複勝予想と、oldとの差（±は標準誤差）`,
    );
    const commonRes = {};
    for (const v of ["old", "newWaku", "newExp"]) {
      const s = summarizePick(restrict(picks[v]));
      commonRes[v] = s;
      const d =
        v === "old"
          ? null
          : pairedDiff(restrict(picks[v]), restrict(picks.old));
      commonRes[v].diff = d;
      console.log(
        `  ${v.padEnd(8)} 的中 ${f(s.hitRate)}% | 回収 ${f(s.recovery)}%` +
          (d
            ? ` | 対old 的中 ${f(d.hitDiff, 2)}±${f(d.hitSe, 2)}pt 回収 ${f(d.recDiff, 2)}±${f(d.recSe, 2)}pt`
            : ""),
      );
    }
    report.byMin[min] = {
      coverage,
      pred,
      pickSummary,
      common: { n: common.size, ...commonRes },
    };
    console.log("");
  }

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`結果を保存: ${out}`);
  }
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
