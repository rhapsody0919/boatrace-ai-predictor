// モリアーティ推奨の品質監査
//
// 「回収率が低いのはモデルのせいか」を切り分けるため、推奨（bet_recommendations）を
// 実データと突き合わせて次の3点を測る。
//   1. 生成タイミング: 推奨が作られた時刻（created_at）と発走時刻の関係。発走後に作られた
//      「後出し」の割合と、区分ごとの的中率・回収率
//   2. オッズの乖離: 取得時オッズ（race_odds の各窓）と締切時オッズ（race_odds_final.win_all、
//      払戻と一致する確定値）の比。全艇と勝ち艇の両方で、窓×オッズ帯ごとに出す
//   3. 回収率の内訳: ベースモデル別・取得時オッズ帯別・校正後確率帯別。校正の妥当性
//      （校正後確率の平均 vs 実測的中率）
//
// 読み取りのみ（DB へ書き込まない）。結果は data/analysis/moriarty-recommendation-quality/report.json
// に、行数・最大日・入力の内容ハッシュ付きで保存する（.claude/rules/analysis.md「モデル・統計分析の検証」4）。
//
// 使い方:
//   node --env-file=.env.local scripts/analysis/analyze-moriarty-recommendation-quality.js \
//     --from=2026-09-01 --to=2026-10-13 [--out=path/to/report.json]
//
// 投資額の定義は scripts/daily/update-moriarty-outcomes.js の betAmountFor と同じ
// （仮想バンクロール10,000円 × bet_fraction、100円単位、最低100円）。model_performance_daily の
// investment と同じ値になる。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchAll, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { raceStartInstant } from "../lib/scrapeJobs/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_ID = "moriarty";
// update-moriarty-outcomes.js の VIRTUAL_BANKROLL と同じ値
const VIRTUAL_BANKROLL = 10000;
const MINUTE_MS = 60 * 1000;

// 取得時オッズの帯（下限以上・上限未満）
const ODDS_BANDS = [
  { key: "lt3", label: "3倍未満", min: 0, max: 3 },
  { key: "3to5", label: "3〜5倍", min: 3, max: 5 },
  { key: "5to10", label: "5〜10倍", min: 5, max: 10 },
  { key: "10to20", label: "10〜20倍", min: 10, max: 20 },
  { key: "20to50", label: "20〜50倍", min: 20, max: 50 },
  { key: "ge50", label: "50倍以上", min: 50, max: Infinity },
];

const PROB_BANDS = [
  { key: "lt10", label: "10%未満", min: 0, max: 0.1 },
  { key: "10to20", label: "10〜20%", min: 0.1, max: 0.2 },
  { key: "20to30", label: "20〜30%", min: 0.2, max: 0.3 },
  { key: "30to50", label: "30〜50%", min: 0.3, max: 0.5 },
  { key: "ge50", label: "50%以上", min: 0.5, max: Infinity },
];

// 生成時刻と発走時刻の差（発走 − 生成、分）の区分
const LEAD_BUCKETS = [
  { key: "after_start", label: "発走後に生成（後出し）", test: (m) => m <= 0 },
  { key: "within_15", label: "発走15分以内", test: (m) => m > 0 && m <= 15 },
  { key: "15_to_60", label: "発走15〜60分前", test: (m) => m > 15 && m <= 60 },
  { key: "over_60", label: "発走60分以上前", test: (m) => m > 60 },
];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function bandOf(bands, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return bands.find((b) => value >= b.min && value < b.max) ?? null;
}

function betAmountFor(rec) {
  const fraction = rec.bet_fraction ?? 0;
  return Math.max(100, Math.floor((fraction * VIRTUAL_BANKROLL) / 100) * 100);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function round(x, digits = 3) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function summarizeRatios(ratios) {
  const sorted = [...ratios].sort((a, b) => a - b);
  const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    median: round(percentile(sorted, 0.5)),
    p25: round(percentile(sorted, 0.25)),
    p75: round(percentile(sorted, 0.75)),
    mean: round(mean),
  };
}

// 的中率・回収率の集計箱。kelly は bet_fraction に比例した投資額、flat は均等100円
function newBucket(label) {
  return { label, n: 0, hits: 0, investment: 0, payout: 0, flatPayout: 0 };
}

function addBet(bucket, rec) {
  const amount = betAmountFor(rec);
  bucket.n += 1;
  bucket.investment += amount;
  if (rec.actual_hit) {
    bucket.hits += 1;
    bucket.payout += rec.actual_payout ?? 0;
    bucket.flatPayout += ((rec.actual_payout ?? 0) / amount) * 100;
  }
}

function finalizeBucket(b) {
  return {
    label: b.label,
    n: b.n,
    hits: b.hits,
    hit_rate: b.n > 0 ? round(b.hits / b.n, 4) : null,
    investment: b.investment,
    payout: b.payout,
    roi_kelly: b.investment > 0 ? round(b.payout / b.investment, 4) : null,
    roi_flat: b.n > 0 ? round(b.flatPayout / (b.n * 100), 4) : null,
  };
}

function finalizeGroups(groups) {
  return Object.fromEntries(
    Object.entries(groups).map(([k, b]) => [k, finalizeBucket(b)]),
  );
}

async function loadData(from, to) {
  const inRange = (q) => q.gte("race_id", from).lte("race_id", `${to}~`);
  const [recs, races, results, odds, finals] = await Promise.all([
    fetchAll(
      "bet_recommendations",
      "race_id, recommendation, reasons, expected_value, bet_fraction, actual_hit, actual_payout, created_at",
      (q) => inRange(q).eq("model_id", MODEL_ID).order("race_id"),
    ),
    fetchAll("races", "race_id, race_date, start_time", (q) =>
      inRange(q).order("race_id"),
    ),
    fetchAll(
      "race_results",
      "race_id, rank1, payout_win, is_cancelled, is_no_race",
      (q) => inRange(q).order("race_id"),
    ),
    fetchAll(
      "race_odds",
      "race_id, captured_at, window_min, source, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      (q) => inRange(q).order("race_id").order("captured_at"),
    ),
    fetchAll("race_odds_final", "race_id, win_all", (q) =>
      inRange(q).order("race_id"),
    ),
  ]);
  return { recs, races, results, odds, finals };
}

function buildProvenance(data, from, to) {
  const hash = createHash("sha256");
  let maxDate = null;
  const note = (raceId) => {
    const d = raceId.slice(0, 10);
    if (!maxDate || d > maxDate) maxDate = d;
  };
  for (const r of data.recs) {
    hash.update(
      `rec|${r.race_id}|${r.created_at}|${r.recommendation}|${r.actual_hit}|${r.actual_payout}\n`,
    );
    note(r.race_id);
  }
  for (const r of data.results) {
    hash.update(`res|${r.race_id}|${r.rank1}|${r.payout_win}\n`);
    note(r.race_id);
  }
  for (const r of data.odds) {
    hash.update(`odds|${r.race_id}|${r.captured_at}|${r.window_min}\n`);
  }
  for (const r of data.finals) {
    hash.update(`final|${r.race_id}|${JSON.stringify(r.win_all)}\n`);
  }
  return {
    period: { from, to, max_race_date: maxDate },
    rows: {
      bet_recommendations: data.recs.length,
      races: data.races.length,
      race_results: data.results.length,
      race_odds: data.odds.length,
      race_odds_final: data.finals.length,
    },
    input_sha256: hash.digest("hex"),
  };
}

function analyzeTiming(data) {
  const startByRace = new Map();
  for (const r of data.races) {
    if (!r.race_date || !r.start_time) continue;
    startByRace.set(r.race_id, raceStartInstant(r.race_date, r.start_time));
  }
  const resultByRace = new Map(data.results.map((r) => [r.race_id, r]));
  const isSettled = (rec) => {
    const res = resultByRace.get(rec.race_id);
    return (
      rec.recommendation !== "skip" &&
      rec.actual_hit !== null &&
      res &&
      !res.is_cancelled &&
      !res.is_no_race
    );
  };

  const leadBuckets = Object.fromEntries(
    LEAD_BUCKETS.map((b) => [b.key, newBucket(b.label)]),
  );
  let betsWithoutStart = 0;
  for (const rec of data.recs) {
    if (!isSettled(rec)) continue;
    const start = startByRace.get(rec.race_id);
    if (!start) {
      betsWithoutStart += 1;
      continue;
    }
    const leadMin =
      (start.getTime() - new Date(rec.created_at).getTime()) / MINUTE_MS;
    const bucket = LEAD_BUCKETS.find((b) => b.test(leadMin));
    addBet(leadBuckets[bucket.key], rec);
  }

  // 見送り（skip）のうち、生成時点で発走60分以上先だったもの＝取得済みオッズが無く判断できなかったレース
  let skips = 0;
  let skipsWithoutOdds = 0;
  for (const rec of data.recs) {
    if (rec.recommendation !== "skip") continue;
    const start = startByRace.get(rec.race_id);
    if (!start) continue;
    skips += 1;
    const leadMin =
      (start.getTime() - new Date(rec.created_at).getTime()) / MINUTE_MS;
    if (leadMin > 60) skipsWithoutOdds += 1;
  }

  // 生成時刻（JST の時）の分布。1日1回の生成なので、日ごとの生成時刻が分かる
  const generationHoursJst = {};
  const generationByDate = new Map();
  for (const rec of data.recs) {
    const created = new Date(rec.created_at);
    const hourJst = (created.getUTCHours() + 9) % 24;
    generationHoursJst[hourJst] = (generationHoursJst[hourJst] ?? 0) + 1;
    const date = rec.race_id.slice(0, 10);
    const prev = generationByDate.get(date);
    if (!prev || rec.created_at < prev)
      generationByDate.set(date, rec.created_at);
  }

  return {
    settled_bets_by_lead: finalizeGroups(leadBuckets),
    settled_bets_without_start_time: betsWithoutStart,
    skips: {
      n: skips,
      generated_over_60min_before_start: skipsWithoutOdds,
      share: skips > 0 ? round(skipsWithoutOdds / skips, 4) : null,
    },
    generation_hour_jst_distribution: generationHoursJst,
    first_generation_per_date: Object.fromEntries(
      [...generationByDate.entries()].sort(),
    ),
  };
}

function analyzeRoi(data) {
  const resultByRace = new Map(data.results.map((r) => [r.race_id, r]));
  const settled = data.recs.filter((rec) => {
    const res = resultByRace.get(rec.race_id);
    return (
      rec.recommendation !== "skip" &&
      rec.actual_hit !== null &&
      res &&
      !res.is_cancelled &&
      !res.is_no_race
    );
  });

  const all = newBucket("全体");
  const byBetType = {};
  const byBaseModel = {};
  const byOddsBand = {};
  const byProbBand = {};
  const calib = {};
  for (const rec of settled) {
    const reasons = rec.reasons ?? {};
    addBet(all, rec);
    const betType = reasons.bet_type ?? "unknown";
    addBet((byBetType[betType] ??= newBucket(betType)), rec);
    const base = reasons.based_on_model ?? "unknown";
    addBet((byBaseModel[base] ??= newBucket(base)), rec);
    if (betType === "win") {
      const ob = bandOf(ODDS_BANDS, reasons.odds);
      if (ob) addBet((byOddsBand[ob.key] ??= newBucket(ob.label)), rec);
      const pb = bandOf(PROB_BANDS, reasons.calibrated_probability);
      if (pb) addBet((byProbBand[pb.key] ??= newBucket(pb.label)), rec);
      const c = (calib[base] ??= { n: 0, sumProb: 0, hits: 0 });
      if (typeof reasons.calibrated_probability === "number") {
        c.n += 1;
        c.sumProb += reasons.calibrated_probability;
        if (rec.actual_hit) c.hits += 1;
      }
    }
  }

  return {
    settled_bets: settled.length,
    overall: finalizeBucket(all),
    by_bet_type: finalizeGroups(byBetType),
    by_base_model: finalizeGroups(byBaseModel),
    win_by_captured_odds_band: finalizeGroups(byOddsBand),
    win_by_calibrated_probability_band: finalizeGroups(byProbBand),
    win_calibration_by_base_model: Object.fromEntries(
      Object.entries(calib).map(([k, c]) => [
        k,
        {
          n: c.n,
          mean_calibrated_probability:
            c.n > 0 ? round(c.sumProb / c.n, 4) : null,
          actual_hit_rate: c.n > 0 ? round(c.hits / c.n, 4) : null,
        },
      ]),
    ),
  };
}

// 取得時オッズ → 締切時オッズの比。全艇（race_odds_final が真値）と勝ち艇（払戻が真値）
function analyzeDrift(data) {
  const finalByRace = new Map(data.finals.map((r) => [r.race_id, r.win_all]));
  const resultByRace = new Map(
    data.results
      .filter(
        (r) => !r.is_cancelled && !r.is_no_race && r.rank1 && r.payout_win > 0,
      )
      .map((r) => [r.race_id, r]),
  );

  const allBoats = {}; // window -> band -> ratios
  const winner = {};
  const windowLabel = (row) =>
    row.window_min == null ? "legacy_gha" : String(row.window_min);

  for (const row of data.odds) {
    const w = windowLabel(row);
    const finalAll = finalByRace.get(row.race_id);
    const res = resultByRace.get(row.race_id);
    for (let b = 1; b <= 6; b += 1) {
      const seen = row[`odds_win_${b}`];
      if (!(seen > 0)) continue;
      const band = bandOf(ODDS_BANDS, seen);
      if (!band) continue;
      const fin = finalAll?.[String(b)];
      if (fin > 0) {
        ((allBoats[w] ??= {})[band.key] ??= []).push(fin / seen);
      }
      if (res && res.rank1 === b) {
        ((winner[w] ??= {})[band.key] ??= []).push(res.payout_win / 100 / seen);
      }
    }
  }

  const finalize = (groups) =>
    Object.fromEntries(
      Object.entries(groups).map(([w, bands]) => [
        w,
        Object.fromEntries(
          ODDS_BANDS.filter((b) => bands[b.key]).map((b) => [
            b.key,
            { label: b.label, ...summarizeRatios(bands[b.key]) },
          ]),
        ),
      ]),
    );

  // race_odds_final 自体の検証: 勝ち艇の締切時オッズと払戻（payout_win/100）の一致率
  let n = 0;
  let within1pct = 0;
  for (const [raceId, winAll] of finalByRace) {
    const res = resultByRace.get(raceId);
    const fin = winAll?.[String(res?.rank1)];
    if (!res || !(fin > 0)) continue;
    n += 1;
    if (Math.abs(res.payout_win / 100 / fin - 1) < 0.01) within1pct += 1;
  }

  return {
    final_vs_payout_check: {
      races: n,
      within_1pct: within1pct,
      share: n > 0 ? round(within1pct / n, 4) : null,
    },
    ratio_final_over_captured_all_boats: finalize(allBoats),
    ratio_payout_over_captured_winner: finalize(winner),
  };
}

function printSummary(report) {
  const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
  console.log(
    `期間 ${report.provenance.period.from}〜${report.provenance.period.to}（最大日 ${report.provenance.period.max_race_date}）`,
  );
  console.log(`行数 ${JSON.stringify(report.provenance.rows)}`);
  console.log("\n[生成タイミング] 発走時刻と生成時刻の関係（確定済みベット）");
  for (const b of Object.values(report.timing.settled_bets_by_lead)) {
    console.log(
      `  ${b.label.padEnd(14)} n=${String(b.n).padEnd(5)} 的中 ${pct(b.hit_rate).padEnd(7)} 回収(Kelly) ${pct(b.roi_kelly).padEnd(7)} 回収(均等) ${pct(b.roi_flat)}`,
    );
  }
  const s = report.timing.skips;
  console.log(
    `  見送り ${s.n} 件のうち生成時点で発走60分以上先: ${s.generated_over_60min_before_start} 件（${pct(s.share)}）`,
  );
  console.log(
    `  生成時刻（JST時）の分布: ${JSON.stringify(report.timing.generation_hour_jst_distribution)}`,
  );
  console.log("\n[回収率] 全体:", JSON.stringify(report.roi.overall));
  console.log("  ベースモデル別:");
  for (const b of Object.values(report.roi.by_base_model)) {
    console.log(
      `    ${b.label.padEnd(11)} n=${String(b.n).padEnd(5)} 的中 ${pct(b.hit_rate).padEnd(7)} 回収(Kelly) ${pct(b.roi_kelly).padEnd(7)} 回収(均等) ${pct(b.roi_flat)}`,
    );
  }
  console.log("  取得時オッズ帯別（単勝）:");
  for (const b of Object.values(report.roi.win_by_captured_odds_band)) {
    console.log(
      `    ${b.label.padEnd(8)} n=${String(b.n).padEnd(5)} 的中 ${pct(b.hit_rate).padEnd(7)} 回収(Kelly) ${pct(b.roi_kelly).padEnd(7)} 回収(均等) ${pct(b.roi_flat)}`,
    );
  }
  console.log(
    "  校正の妥当性（単勝、校正後確率の平均 vs 実測的中率）:",
    JSON.stringify(report.roi.win_calibration_by_base_model),
  );
  const chk = report.drift.final_vs_payout_check;
  console.log(
    `\n[オッズ乖離] race_odds_final の勝ち艇オッズと払戻の一致（±1%）: ${chk.within_1pct}/${chk.races}（${pct(chk.share)}）`,
  );
  console.log("  締切時オッズ ÷ 取得時オッズ（全艇、中央値）");
  for (const [w, bands] of Object.entries(
    report.drift.ratio_final_over_captured_all_boats,
  )) {
    console.log(
      `    窓 ${String(w).padEnd(10)} ` +
        Object.values(bands)
          .map((b) => `${b.label}:${b.median}(n=${b.n})`)
          .join("  "),
    );
  }
  console.log("  払戻 ÷ 取得時オッズ（勝ち艇、中央値）");
  for (const [w, bands] of Object.entries(
    report.drift.ratio_payout_over_captured_winner,
  )) {
    console.log(
      `    窓 ${String(w).padEnd(10)} ` +
        Object.values(bands)
          .map((b) => `${b.label}:${b.median}(n=${b.n})`)
          .join("  "),
    );
  }
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.",
    );
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const from = args.from;
  const to = args.to;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")
  ) {
    console.error("使い方: --from=YYYY-MM-DD --to=YYYY-MM-DD [--out=path]");
    process.exit(1);
  }
  const outPath =
    args.out ??
    path.join(
      __dirname,
      "../../data/analysis/moriarty-recommendation-quality/report.json",
    );

  console.log(`読み込み中 ${from}〜${to} ...`);
  const data = await loadData(from, to);

  const report = {
    generated_at: new Date().toISOString(),
    script: "scripts/analysis/analyze-moriarty-recommendation-quality.js",
    provenance: buildProvenance(data, from, to),
    definitions: {
      investment:
        "仮想バンクロール10,000円 × bet_fraction（100円単位、最低100円）。update-moriarty-outcomes.js と同じ",
      roi_kelly: "payout ÷ investment（実際の配分に基づく回収率）",
      roi_flat: "全ベットを100円均等買いしたときの回収率",
      lead_minutes:
        "発走時刻（races.race_date + start_time、JST）− bet_recommendations.created_at",
      ratio_final_over_captured:
        "race_odds_final.win_all ÷ race_odds の各窓の単勝オッズ（全艇）",
      ratio_payout_over_captured:
        "race_results.payout_win ÷ 100 ÷ race_odds の各窓の単勝オッズ（勝ち艇のみ）",
    },
    timing: analyzeTiming(data),
    roi: analyzeRoi(data),
    drift: analyzeDrift(data),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  console.log(`\n書き出し: ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
