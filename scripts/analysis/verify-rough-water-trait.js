/**
 * 「荒れ水面に強い／弱い」は選手の性質として持続するか（BOA-716）
 *
 * 選手ページの条件別の表（src/utils/racerConditionStats.js、BOA-336）に
 * 「荒れ水面に強い／弱い」の印を付けてよいかを、印の見せ方を決める前に確かめる。
 *
 * 入力は公式K・Bファイルの解析済みファイル（kb-day/v1、~/boatrace-archive-backup/kb-archive）。
 * 本番DB（race_conditions）は風・波が 2025-12 以降しか無く、期間を前後に分ける検証に足りないため、
 * 同じ公式の値を6年分持つアーカイブを使う。本番DBは読まない（書き込みもしない）。
 *
 * 区分は画面と同じ:
 *   風: 風速 5m 以上（STRONG_WIND_MS）／未満
 *   波: 波高 5cm 以上（ROUGH_WAVE_CM）／未満。江戸川（03）は母数から外す（WAVE_EXCLUDED_VENUE_CODES）
 *   荒れ（まとめ）: 風5m以上 または 波5cm以上。静水は 風5m未満 かつ 波5cm未満（江戸川は風だけで判定）
 * 1走の数え方: 欠場（進入コースが無い走）は外す。F・L・失格などは走に数え、1着・3着内には数えない
 *
 * 選手の「荒れ水面の差」の定義（4つ）:
 *   self : 荒れの率 − 本人の全体の率（今の画面と同じ比べ方）
 *   calm : 荒れの率 − 本人の静水の率
 *   pop  : 荒れの率 − 全選手の荒れの率
 *   adj  : (荒れの走の 実績−期待) の平均 − (静水の走の 実績−期待) の平均
 *          期待は同じ期間の全選手の率で、進入コース×全国勝率の帯（0.5刻み）×荒れか×会場ごと
 *          （200走未満の層は会場を外す）。コース・級（力量）・会場の偏りを除いた差
 *   adjv : adj を「同じ会場の中で」荒れと静水を比べ、会場ごとの差を nR·nC/(nR+nC) で重み付けた平均。
 *          本人の地元・得意会場が荒れやすい会場だと adj に「荒れに強い」が混ざるため、それを除く
 *
 * 検証:
 *   1. 期間を前後に分け、前の差が後の差を予測するか（相関・前の五分位ごとの後の差・ブートストラップ区間）
 *      偶然との比較は、選手ごと・期間ごと・会場ごとに「荒れ」の札を同じ走数のまま入れ替えた並べ替え（200回）。
 *      会場の中で入れ替えるので、地元・得意会場の偏りは偶然の側にも残る
 *   2. 印の候補ルール（差の閾値×最低走数）で、印が付く割合と後の期間の差
 *   3. 比べる相手（self/calm/pop/adj）ごとの持続と、力量・コースとの相関
 *   4. 風と波の差の相関（期間をまたいだ交差）
 *
 * 期間の分け方:
 *   long : 前 2020-02-01〜2023-05-31 / 後 2023-06-01〜2026-09-30（上限を見る）
 *   year : 1年ずつ（各年10/1〜翌9/30）の隣り合う5組を合わせる（画面の母数＝荒れの走が20〜40走に近い）
 *
 * 使い方:
 *   node scripts/analysis/verify-rough-water-trait.js
 *   KB_ARCHIVE_DIR=/path/to/kb-archive node scripts/analysis/verify-rough-water-trait.js
 * 出力: data/analysis/rough-water-trait.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { r4, pt, quantile } from "./roughWaterTraitStats.js";
import {
  BOOT_REPS,
  PERM_REPS,
  analysePairs,
  windWaveRelation,
} from "./roughWaterTraitPairs.js";
import {
  STRONG_WIND_MS,
  ROUGH_WAVE_CM,
  FROM,
  TO,
  loadRuns,
  condFlags,
  indicesIn,
  racerRuns,
} from "./roughWaterTraitRuns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUT_PATH = path.join(
  __dirname,
  "../../data/analysis/rough-water-trait.json",
);

const LONG = {
  A: ["2020-02-01", "2023-05-31"],
  B: ["2023-06-01", "2026-09-30"],
};
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025].map((y) => [
  `${y}-10-01`,
  `${y + 1}-09-30`,
]);

const MIN_RUNS_LIST = [10, 20, 30, 50];
const CONDS = ["wind", "wave", "rough"];
const OUTCOMES = ["win", "top3"];

// 全国の基準（荒れでコースごとの1着率がどう変わるか）
function populationContext(R, flags, idx) {
  const out = {};
  for (const cond of CONDS) {
    const t = {};
    for (const i of idx) {
      const f = flags[cond][i];
      if (f < 0) continue;
      const k = `${f}|${R.course[i]}`;
      const s = t[k] ?? { n: 0, w: 0 };
      s.n += 1;
      s.w += R.win[i];
      t[k] = s;
    }
    let nR = 0,
      nAll = 0;
    for (const i of idx) {
      const f = flags[cond][i];
      if (f >= 0) {
        nAll += 1;
        if (f === 1) nR += 1;
      }
    }
    out[cond] = {
      roughShareOfRuns: r4(nR / nAll),
      winRateByCourse_pt: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((c) => [
          c,
          {
            calm: pt(t[`0|${c}`].w / t[`0|${c}`].n),
            rough: pt(t[`1|${c}`].w / t[`1|${c}`].n),
          },
        ]),
      ),
    };
  }
  return out;
}

function buildPeriod(R, flags, range) {
  const idx = indicesIn(R, range);
  const data = {};
  for (const cond of CONDS) {
    data[cond] = {};
    for (const outcome of OUTCOMES)
      data[cond][outcome] = racerRuns(R, idx, flags[cond], R[outcome]);
  }
  return { idx, data };
}

function pairsOf(PA, PB, cond, outcome, tag = null) {
  const a = PA.data[cond][outcome];
  const b = PB.data[cond][outcome];
  const out = [];
  for (const [id, dA] of a.byRacer) {
    const dB = b.byRacer.get(id);
    if (!dB) continue;
    out.push({ A: dA, B: dB, popA: a.popRoughRate, popB: b.popRoughRate, tag });
  }
  return out;
}

// 選手1人・1年の荒れの走数の分布（画面の母数の目安）
function roughRunsPerRacerYear(P) {
  const out = {};
  for (const cond of CONDS) {
    const ns = [];
    for (const d of P.data[cond].win.byRacer.values()) {
      if (d.y.length < 100) continue; // 年100走未満（休みが長い選手）は外す
      ns.push(d.f.filter((f) => f === 1).length);
    }
    ns.sort((a, b) => a - b);
    out[cond] = {
      racers: ns.length,
      p10: quantile(ns, 0.1),
      p25: quantile(ns, 0.25),
      median: quantile(ns, 0.5),
      p75: quantile(ns, 0.75),
      p90: quantile(ns, 0.9),
    };
  }
  return out;
}

const secondsSince = (t0) => ((Date.now() - t0) / 1000).toFixed(0);

function buildMeta(R, nRaces, days, inputHash) {
  return {
    ticket: "BOA-716",
    generatedAt: new Date().toISOString(),
    source:
      "公式K・Bファイルの解析済み（kb-day/v1、~/boatrace-archive-backup/kb-archive/parsed）",
    inputSha256: inputHash,
    period: [FROM, TO],
    days,
    races: nRaces,
    runs: R.racer.length,
    racers: new Set(R.racer).size,
    definitions: {
      wind: `風速 ${STRONG_WIND_MS}m 以上が荒れ`,
      wave: `波高 ${ROUGH_WAVE_CM}cm 以上が荒れ（江戸川を除く）`,
      rough:
        "風5m以上 または 波5cm以上が荒れ。静水は両方とも未満（江戸川は風だけ）",
      self: "荒れの率 − 本人の全体の率（今の画面）",
      calm: "荒れの率 − 本人の静水の率",
      pop: "荒れの率 − 全選手の荒れの率",
      adj: "荒れの(実績−期待)平均 − 静水の(実績−期待)平均。期待は同期間の全選手、進入コース×全国勝率0.5刻み×荒れか×会場",
      adjv: "adj を同じ会場の中で比べ、会場ごとの差を nR·nC/(nR+nC) で重み付けた平均（地元・得意会場の偏りを除く）",
    },
    split: { long: LONG, year: YEARS },
    bootReps: BOOT_REPS,
    permReps: PERM_REPS,
  };
}

// long: 前後2期間。seed は並べ替え・ブートストラップの種（呼ぶたびに1つ進む）
function analyseLong(PA, PB, nextSeed, t0) {
  const out = {};
  for (const cond of CONDS) {
    out[cond] = {};
    for (const outcome of OUTCOMES) {
      out[cond][outcome] = {};
      for (const m of MIN_RUNS_LIST) {
        out[cond][outcome][`min${m}`] = analysePairs(
          pairsOf(PA, PB, cond, outcome),
          null,
          null,
          m,
          nextSeed(),
        );
      }
      console.error(`long ${cond} ${outcome} done ${secondsSince(t0)}s`);
    }
  }
  out.windWave = {
    win: windWaveRelation(PA.data, PB.data, "win", 50),
    top3: windWaveRelation(PA.data, PB.data, "top3", 50),
  };
  return out;
}

// year: 隣り合う1年の5組を合わせる。同じ選手が複数の組に入る
function yearPairs(Ps, cond, outcome) {
  const pairs = [];
  for (let k = 0; k + 1 < Ps.length; k++)
    pairs.push(
      ...pairsOf(
        Ps[k],
        Ps[k + 1],
        cond,
        outcome,
        `${YEARS[k][0]}→${YEARS[k + 1][0]}`,
      ),
    );
  return pairs;
}

function analyseYear(Ps, nextSeed, t0) {
  const out = {};
  for (const cond of CONDS) {
    out[cond] = {};
    for (const outcome of OUTCOMES) {
      out[cond][outcome] = {};
      for (const m of [10, 20, 30]) {
        out[cond][outcome][`min${m}`] = analysePairs(
          yearPairs(Ps, cond, outcome),
          null,
          null,
          m,
          nextSeed(),
        );
      }
      console.error(`year ${cond} ${outcome} done ${secondsSince(t0)}s`);
    }
  }
  const ww = { win: [], top3: [] };
  for (let k = 0; k + 1 < Ps.length; k++) {
    for (const o of OUTCOMES)
      ww[o].push(windWaveRelation(Ps[k].data, Ps[k + 1].data, o, 20));
  }
  out.windWave = ww;
  return out;
}

function main() {
  const t0 = Date.now();
  const { R, nRaces, days, inputHash } = loadRuns();
  console.error(
    `loaded ${R.racer.length} runs / ${nRaces} races / ${days} days in ${secondsSince(t0)}s`,
  );
  const flags = condFlags(R);
  let seed = 716;
  const nextSeed = () => seed++;

  const result = { meta: buildMeta(R, nRaces, days, inputHash) };

  // long
  const PA = buildPeriod(R, flags, [LONG.A[0], LONG.A[1]]);
  const PB = buildPeriod(R, flags, [LONG.B[0], LONG.B[1]]);
  result.populationContext = {
    A: populationContext(R, flags, PA.idx),
    B: populationContext(R, flags, PB.idx),
  };
  result.long = analyseLong(PA, PB, nextSeed, t0);

  // year
  const Ps = YEARS.map((r) => buildPeriod(R, flags, r));
  result.roughRunsPerRacerYear = roughRunsPerRacerYear(Ps[Ps.length - 1]);
  result.year = analyseYear(Ps, nextSeed, t0);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 1) + "\n");
  console.error(`wrote ${OUT_PATH} in ${secondsSince(t0)}s`);
}

main();
