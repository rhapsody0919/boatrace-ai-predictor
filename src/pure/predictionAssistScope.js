/**
 * 思考アシスト（BOA-430）の画面のモデルのうち、範囲・荒れ・類似レース・級の並び・最良値・決まり手の計算。純粋関数だけ。
 * src/utils/assistModel.js から字のまま移した（呼び出し側は assistModel.js の再 export を読む）。
 */
import {
  aggregateNeighbors,
  trifectaList,
  TECHNIQUES,
} from "./analogyAggregate.js";
import { bestOf } from "./bestOf.js";
import { wilsonInterval } from "./wilson.js";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats.js";

// ---- 優勝戦・準優勝戦（D-36 (4)・D-37）----

export const ROUND_LABEL = { junyu: "準優勝戦", yusho: "優勝戦" };

// ---- 全国・級の並びが同じ（D-37）----

/** 同じラウンドに絞った値がこの件数未満なら、ラウンドを問わない値に戻す（v16 タブ3 の「割合を出さない」と同じ） */
export const FEW_ROUND = 30;

/** scenario の応答 → 全体のセル（cells.all.forms.any）。無ければ null */
export const anyCell = (scenarioBody) =>
  scenarioBody?.scenario?.cells?.all?.forms?.any ?? null;

/** 範囲の呼び名（D-13・D-37）。「全国・級の並びが同じ準優勝戦」等 */
export function sameClassLabel(scope) {
  if (!scope) return null;
  return scope.kind === "NCR"
    ? `全国・級の並びが同じ${ROUND_LABEL[scope.round]}`
    : "全国・級の並びが同じ";
}

// ---- 基準つきバーの3段階（D-21）----

/**
 * 割合を基準（全国の全レース）と比べる。ぶれ幅（Wilson の95%）が基準と重ならないときだけ高め・低め。
 * n＝0 は null（行を出さない。Codex U02）
 * @returns {null | {k: number, n: number, rate: number, lo: number, hi: number, base: number, verdict: "high"|"low"|"unclear", diffPt: number}}
 */
export function baseVerdict(k, n, base) {
  if (!n) return null;
  const [lo, hi] = wilsonInterval(k, n);
  const rate = k / n;
  const verdict = base > hi ? "low" : base < lo ? "high" : "unclear";
  return {
    k,
    n,
    rate,
    lo,
    hi,
    base,
    verdict,
    diffPt: Math.round((rate - base) * 100),
  };
}

/**
 * 堅い？荒れる？の2本（1号艇の1着・万舟）。scope.few なら verdict を null にする（同じラウンドが30件未満で NC に戻したため、D-37）
 * @param {ReturnType<typeof sameClassScope>} scope
 * @param {object|null} nationalCell 全国の全レース（scenario NA の全体のセル）
 */
export function roughCard(scope, nationalCell) {
  if (!scope || !nationalCell) return null;
  const c = scope.cell;
  const b1 = baseVerdict(c.b1_win, c.n, nationalCell.b1_win / nationalCell.n);
  const manshu = baseVerdict(
    c.manshu,
    c.payout_known,
    nationalCell.manshu / nationalCell.payout_known,
  );
  const few = (row) => (row && scope.few ? { ...row, verdict: null } : row);
  return { b1: few(b1), manshu: few(manshu), few: scope.few };
}

/**
 * BOA-822（FR-4、承認 (a)）: 堅い？荒れる？の1着のバーを、イン崩れ注意度の裏返し（100 − pct）にする。
 * AI予想タブの注意度と和が 100% になるよう、割合は pct から作る（nonWin / n を丸め直さない）。
 * 基準の点線は注意度の基準（全国の全レースで1着を逃した basePct）の裏返し。件数少なめ（lowSample）は矢印を出さない。
 * 万舟は今の級の並びのまま。inCaution が無いときは rough をそのまま返す
 * @param {ReturnType<typeof roughCard>} rough
 * @param {{pct: number, n: number, nonWin: number, basePct: number, lowSample: boolean}|null} inCaution
 */
export function roughWithInCaution(rough, inCaution) {
  if (!rough || typeof inCaution?.pct !== "number" || !inCaution.n)
    return rough;
  const { pct, n, nonWin, basePct, lowSample } = inCaution;
  const row = baseVerdict(n - nonWin, n, (100 - basePct) / 100);
  return {
    ...rough,
    b1: {
      ...row,
      rate: (100 - pct) / 100,
      verdict: lowSample ? null : row.verdict,
    },
    inCaution: {
      pct,
      n,
      lowSample: Boolean(lowSample),
      round: ROUND_LABEL[inCaution.round] ?? null,
      level: inCaution.level ?? null,
    },
  };
}

// ---- 類似レース（D-35・D-36 (3)、ADR 0087）----

/** 龍神ソナーと同じ「今日に近い順の上位 400件」 */
export const SIMILAR_LIMIT = 400;
export const MANSHU_PAYOUT = 10000;

/**
 * 類似レースの集計。表示する件数は着順が有効な件（aggregateNeighbors の n）、万舟の分母は払戻のある件
 * @param {{n_layer: number, neighbors: object[]}|null} similar similar の応答の similar
 */
export function similarSummary(similar) {
  if (!similar?.neighbors) return null;
  const top = similar.neighbors.slice(
    0,
    Math.min(SIMILAR_LIMIT, similar.n_layer),
  );
  const agg = aggregateNeighbors(top);
  const priced = top.filter((x) => x.payout_3tan != null);
  return {
    n: agg.n,
    nLayer: similar.n_layer,
    allInLayer: similar.n_layer <= SIMILAR_LIMIT,
    win: agg.win,
    tech: agg.tech,
    tri: agg.tri,
    topTrifecta: trifectaList(agg.tri).slice(0, 3),
    manshu: {
      k: priced.filter((x) => x.payout_3tan >= MANSHU_PAYOUT).length,
      n: priced.length,
    },
  };
}

// ---- 級の並びの絵（D-31）----

/**
 * 選んだ艇を固定、残り5艇は今日の艇番順に級を並べる
 * @param {string[]} classes 1〜6号艇の級別（v16 today.classes）
 * @param {number} fixedBoat
 */
/**
 * 固定する艇以外の5艇の級を艇数で書く（例「A1 が2艇・A2 が2艇・B1 が1艇」）。単位を必ず付ける（2026-10-08 ユーザー決定）
 * @returns {string|null} 級が欠けていれば null
 */
export function restClassCounts(classes, fixedBoat = 1) {
  if (!Array.isArray(classes) || classes.length !== 6) return null;
  const rest = classes.filter((_, i) => i + 1 !== fixedBoat);
  if (rest.some((c) => !c)) return null;
  return ["A1", "A2", "B1", "B2"]
    .map((c) => [c, rest.filter((x) => x === c).length])
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${c} が${n}艇`)
    .join("・");
}

export function classLineup(classes, fixedBoat = 1) {
  if (!Array.isArray(classes)) return null;
  return classes.map((cls, i) => ({
    boat: i + 1,
    cls,
    fixed: i + 1 === fixedBoat,
  }));
}

// ---- 最良の金枠（FR-3a・D-36 (7)）----

/** 項目ごとの向きと桁（既存の raceIndicators・RaceBasicInfoTab と同じ） */
export const BEST_RULES = {
  series_score: { dir: "max", digits: 2 },
  pretest: { dir: "min", digits: 2 },
  recent_win30: { dir: "max", digits: 1 },
  course_win: { dir: "max", digits: 0 },
  nat_win: { dir: "max", digits: 2 },
  loc_win: { dir: "max", digits: 2 },
  st_mean30: { dir: "min", digits: 3 },
  st_course: { dir: "min", digits: 3 },
  motor_2: { dir: "max", digits: 1 },
  exh_time: { dir: "min", digits: 2 },
  exh_st: { dir: "min", digits: 2 },
  ox_lap: { dir: "min", digits: 2 },
  ox_turn: { dir: "min", digits: 2 },
  ox_straight: { dir: "min", digits: 2 },
  ox_half_lap: { dir: "min", digits: 2 },
};

/**
 * 6艇の値から最良の艇番の Set（bestOf をそのまま使う）。
 * - 走数（runs）が SMALL_SAMPLE_THRESHOLD 未満の値は比べるが金枠を付けない（hidden）
 * - 当地勝率の 0.00 は記録なし（#1297）
 * - 展示ST の F（flying: true）は候補から外す
 * - 優勝戦・準優勝戦の今節の平均着順点には付けない（FR-3a・v16 Q7）
 * @param {string} metric BEST_RULES のキー
 * @param {{boat: number, value: number|null, runs?: number, flying?: boolean}[]} values
 * @param {{finalRound?: boolean}} [options]
 * @returns {Set<number>}
 */
export function bestBoats(metric, values, { finalRound = false } = {}) {
  const rule = BEST_RULES[metric];
  if (!rule) throw new Error(`bestBoats: 向きの決まっていない項目 ${metric}`);
  if (metric === "series_score" && finalRound) return new Set();
  const candidates = (values ?? [])
    .filter((v) => !(metric === "exh_st" && v.flying))
    .map((v) => ({
      boat: v.boat,
      value: metric === "loc_win" && v.value === 0 ? null : v.value,
      hidden: v.runs != null && v.runs < SMALL_SAMPLE_THRESHOLD,
    }));
  return bestOf(candidates, rule.dir, { digits: rule.digits });
}

// ---- 会場の決まり手（D-35・D-37 U-18、表 venue_technique_period_stats）----

/**
 * 直近1年を主、直近90日を並べる。「最近↑／↓」は直近90日 対 それより前の275日（365日−90日）の
 * ぶれ幅が重ならない決まり手だけ。想定外の決まり手は「その他」に寄せる
 * @param {{period_days: number, winning_technique: string, race_count: number, total_races: number}[]} rows
 * @returns {null | {total365: number, total90: number, rows: Array<{technique: string, rate365: number, rate90: number|null, ratePrev: number|null, mark: "up"|"down"|null}>}}
 */
export function venueTechniqueTrend(rows) {
  const byPeriod = { 90: new Map(), 365: new Map() };
  const totals = { 90: 0, 365: 0 };
  for (const r of rows ?? []) {
    if (!byPeriod[r.period_days]) continue;
    const t = TECHNIQUES.includes(r.winning_technique)
      ? r.winning_technique
      : "その他";
    const m = byPeriod[r.period_days];
    m.set(t, (m.get(t) ?? 0) + r.race_count);
    totals[r.period_days] = r.total_races;
  }
  if (!totals[365]) return null;
  const order = [...TECHNIQUES, "その他"].filter((t) => byPeriod[365].has(t));
  const prevTotal = totals[365] - totals[90];
  return {
    total365: totals[365],
    total90: totals[90],
    rows: order.map((technique) => {
      const c365 = byPeriod[365].get(technique) ?? 0;
      const c90 = byPeriod[90].get(technique) ?? 0;
      const prev = c365 - c90;
      const i90 = totals[90] ? wilsonInterval(c90, totals[90]) : null;
      const iPrev = prevTotal > 0 ? wilsonInterval(prev, prevTotal) : null;
      let mark = null;
      if (i90 && iPrev) {
        if (i90[0] > iPrev[1]) mark = "up";
        else if (i90[1] < iPrev[0]) mark = "down";
      }
      return {
        technique,
        rate365: c365 / totals[365],
        rate90: totals[90] ? c90 / totals[90] : null,
        ratePrev: prevTotal > 0 ? prev / prevTotal : null,
        mark,
      };
    }),
  };
}

// ---- 時点（D-36 (1)）----

/**
 * DB の展示タイムが出走する艇の全部にそろえば展示後
 * @param {{boat: number, time: number|null}[]} exhibition
 * @param {number[]} boats 出走する艇（欠場を除く）
 */
export function stageFromExhibition(exhibition, boats) {
  if (!boats?.length) return "pre";
  const have = new Set(
    (exhibition ?? [])
      .filter((e) => typeof e.time === "number" && e.time > 0)
      .map((e) => e.boat),
  );
  return boats.every((b) => have.has(b)) ? "post" : "pre";
}
