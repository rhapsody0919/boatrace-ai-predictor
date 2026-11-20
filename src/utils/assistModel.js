/**
 * 思考アシスト（BOA-430）の画面のモデル。純粋関数だけ（取得・描画はしない）。
 * 検査は scripts/maintenance/verify-thinking-assist-model.js（徳山10R 2026-10-06 の本番 v16 の値で固定）。
 * 仕様: docs/design/thinking-assist/spec.md（FR-3a・D-21・D-31・D-35〜D-37）・plan.md
 */
import { ROUNDS_FINAL } from "./analogyFacts.js";
import { getRaceStageKey } from "../constants/raceStageConfig.js";
import { ASSIST_COPY } from "../data/thinkingAssistCopy.js";
import {
  FEW_ROUND,
  anyCell,
  BEST_RULES,
  bestBoats,
} from "../pure/predictionAssistScope.js";
import {
  METRICS,
  numOf,
  bestOfMetric,
  abs,
  ST_METRICS,
  span,
  stText,
  exhRanks,
  missingFirstBoats,
  firstPlaceComposite,
  axisBoard,
  powerBoardPost,
  powerBoardPre,
  withBoardDefaults,
} from "../pure/predictionAssistBoardParts.js";

/**
 * このレースのラウンド（"junyu" | "yusho" | null）。v16 の today.round、無ければ出走表の raceStage
 * @param {{round?: string}|null} today v16 facts の today
 * @param {string|null} raceStage getPredictions の raceStage
 */
export function raceRound(today, raceStage) {
  // v16 がラウンドを持つ（yosen・other 等も含む）ときはそれだけで決める。出走表に戻すのは v16 に無いときだけ（Codex 依頼25 F01）
  if (today?.round)
    return ROUNDS_FINAL.includes(today.round) ? today.round : null;
  const key = getRaceStageKey(raceStage);
  if (key === "semifinal") return "junyu";
  if (key === "final") return "yusho";
  return null;
}

/**
 * 「全国・級の並びが同じ」に使う範囲を選ぶ（D-37）。
 * 優勝戦・準優勝戦の日は同じラウンド（NCR）。NCR が FEW_ROUND 件未満かキーが無ければ NC に戻し few=true（矢印・言葉を出さない）
 * @param {{today: object|null, raceStage?: string|null, scenarios: Record<string, object>, boat?: number}} args
 *   scenarios は範囲キー → scenario の応答
 * @returns {null | {kind: "NC"|"NCR", round: string|null, cell: object, few: boolean, withoutRound: object|null}}
 *   withoutRound は NCR を使うときの NC のセル（開いた中の「予選も含めると」の1行）
 */
export function sameClassScope({
  today,
  raceStage = null,
  scenarios,
  boat = 1,
}) {
  const keys = today?.scope_keys?.[String(boat)];
  if (!keys) return null;
  const nc = anyCell(scenarios?.[keys.NC]);
  const round = raceRound(today, raceStage);
  if (round) {
    const ncr = keys.NCR ? anyCell(scenarios?.[keys.NCR]) : null;
    if (ncr && ncr.n >= FEW_ROUND)
      return { kind: "NCR", round, cell: ncr, few: false, withoutRound: nc };
    return nc
      ? { kind: "NC", round, cell: nc, few: true, withoutRound: null }
      : null;
  }
  return nc
    ? { kind: "NC", round: null, cell: nc, few: false, withoutRound: null }
    : null;
}

/** 買い目レンズの「過去の{着順}」の数字（件数は割合の括弧。BOA-831 承認モック v2） */
function pastNumOf(target, past) {
  return {
    metric: null,
    label: ASSIST_COPY.pastLabel(target),
    short: ASSIST_COPY.pastLabel(target),
    text: ASSIST_COPY.pastText(past.k, past.n),
    aria: null,
    best: false,
  };
}

/** 6艇比較の項目の図（metric が指定されたとき） */
function metricBoard({ lens, metric, racers, finalRound, stBasis }) {
  const def = METRICS[metric];
  const plotOf = (r) => (def.plot ? def.plot(r) : abs(def.value(r)));
  const b = bestOfMetric(metric, racers, finalRound);
  const dir = BEST_RULES[metric].dir;
  // 目盛りを出し、縮尺は元の図とそろえる（BOA-804）。ST は展開レンズと同じ .00〜.25、
  // ほかは値の幅（軸・機力のレンズと同じ span）で、両端の値を目盛りに書く
  const st = ST_METRICS.has(metric);
  const s = st ? { lo: 0, hi: 0.25 } : span(racers.map(plotOf));
  return {
    kind: "metric",
    title: `${def.label}を6艇で比べる`,
    // 展開レンズの点から開いた展示ST は、戻る先（図の平均ST）を名前で書く（承認モック v2 ⑤）
    back:
      metric === "exh_st" && lens === "flow"
        ? ASSIST_COPY.backTo(
            METRICS[stBasis === "overall" ? "st_mean30" : "st_course"].label,
          )
        : null,
    left: st ? ".00" : (def.tick ?? def.text)(s.lo),
    right: st ? ".25" : (def.tick ?? def.text)(s.hi),
    good: dir === "min" ? "left" : "right",
    ...s,
    slit: st,
    rows: racers.map((r) => ({
      boat: r.boat,
      x: plotOf(r),
      nums: [numOf(metric, r, b)],
      // 展示ST の F は良いスタートと読まれないよう、点を赤い枠で出す（BOA-801 2。展示ST は展開の図からここへ移った、spec D-47 (1)）
      flying: metric === "exh_st" && Boolean(r.exhFlying),
    })),
  };
}

/** 展開レンズの点の読み上げ（見えている値＝平均ST から始め、押すと何が出るかを続ける） */
function flowDotLabel({ key, v, r, post, dotMetric }) {
  if (v == null || !dotMetric) return null;
  return post
    ? ASSIST_COPY.compareExhStAria(
        METRICS[key].aria(v, r),
        METRICS.exh_st.label,
      )
    : ASSIST_COPY.compareAria(METRICS[key].label, METRICS[key].aria(v, r));
}

/** 展開レンズの1艇の行 */
function flowRow({ r, key, value, post, hasToday, best2, ranks }) {
  const v = value(r);
  // 展示後の点の値は押すと展示ST の6艇比較。展示ST が無い艇は押せない
  const dotMetric = post
    ? r.exhSt == null
      ? null
      : "exh_st"
    : v == null
      ? null
      : key;
  return {
    boat: r.boat,
    x: v == null ? null : Math.abs(v),
    nums: [],
    // このコースの平均ST は v16 から。届いていなければ「記録なし」とも書かない
    pending: !hasToday,
    dotText: v == null ? null : stText(v, 3),
    dotBest: best2.has(r.boat),
    dotMetric: v == null ? null : dotMetric,
    // 読み上げは見えている値（平均ST）から始め、押すと何が出るかを続ける（見えている文字を名前に含める）
    dotLabel: flowDotLabel({ key, v, r, post, dotMetric }),
    exhRank: ranks?.[r.boat - 1] ?? null,
    // このコースの走が5走未満で直近30走で補った艇（BOA-815 方針4）
    filled: key === "st_course" && v != null && r.stCourseFilled,
  };
}

/** 展開レンズの図 */
function flowBoard({ racers, post, hasToday, stBasis, stMissing }) {
  // 横軸は展示前も展示後も平均ST（左ほど早い）。「このコース｜直近30走」を切り替える（BOA-815 案A。龍神ソナーと同じ操作）。
  // 展示ST は本番のスタートとは別なので図にせず、展示後は点の値を押した6艇比較で出す（spec D-47 (1)）
  const overall = stBasis === "overall";
  const key = overall ? "st_mean30" : "st_course";
  const value = (r) => (overall ? r.stMean : r.stCourse);
  const best2 = bestBoats(
    key,
    racers.map((r) => ({
      boat: r.boat,
      value: value(r),
      // このコースの走が少ない艇（補った値を含む）は金枠を付けない（龍神ソナーの平均STの表と同じ）
      runs: key === "st_course" ? r.stCourseN : null,
    })),
  );
  const ranks = post ? exhRanks(racers) : null;
  return {
    kind: "flow",
    title: `${METRICS[key].label} 左ほど早い`,
    basis: overall ? "overall" : "course",
    // v16 の保存が無いレースは平均ST の点が出ない。黙って空の図にせず理由を書く（ファン評価 1周目 指摘3）
    noSt: stMissing,
    // 展示後は展示ST の6艇比較への入口を図の上に置く（点の値が無い艇・レースでも入れる。同 指摘3・4）
    exhCompare: post && racers.some((r) => r.exhSt != null),
    left: ".00",
    right: ".25",
    good: "left",
    lo: 0,
    hi: 0.25,
    slit: true,
    rows: racers.map((r) =>
      flowRow({ r, key, value, post, hasToday, best2, ranks }),
    ),
  };
}

/** 相手レンズの割合（30件未満は出さない） */
const placeRate = (pair) => (pair && pair.n >= 30 ? pair.k / pair.n : null);

/** 相手レンズの割合の文字（30件未満は件数だけ） */
const placeText = (pair) =>
  !pair
    ? "—"
    : pair.n < 30
      ? ASSIST_COPY.placeFew(pair.n)
      : `${Math.round((pair.k / pair.n) * 100)}%`;

/** 相手レンズの1艇の数字2個（2着以内・3着以内） */
function placeNums(p) {
  if (!p) return [];
  return [
    {
      metric: null,
      label: ASSIST_COPY.placeTop2,
      short: ASSIST_COPY.placeTop2,
      text: placeText(p.t2),
      aria: null,
      best: false,
    },
    {
      metric: null,
      label: ASSIST_COPY.placeTop3,
      short: ASSIST_COPY.placeTop3,
      text: placeText(p.t3),
      aria: null,
      best: false,
    },
  ];
}

/** 相手レンズの図 */
function placeBoard({ racers, placeRates }) {
  // 相手（spec D-46）: 横軸は割合 0〜100%。●2着以内（x）と○3着以内（x2）を同じ行に置く。
  // 値は艇ごとの範囲（深掘り・買い目と同じ）。艇ごとに範囲が違うので6艇で比べる金枠は付けない。
  // 30件未満は割合を出さず件数だけ（2026-10-12 統計検証: 艇の範囲の30件未満は0.2%）
  return {
    kind: "place",
    title: ASSIST_COPY.placeTitle,
    left: "0%",
    right: "100%",
    good: null,
    lo: 0,
    hi: 1,
    rows: racers.map((r) => {
      const p = placeRates?.get(r.boat) ?? null;
      return {
        boat: r.boat,
        x: placeRate(p?.t2),
        x2: placeRate(p?.t3),
        nums: placeNums(p),
      };
    }),
  };
}

/** 買い目レンズの図（オッズが無いとき。艇番順に並べるだけ） */
function betBoardNoOdds({ title, racers, pastWin, target }) {
  return {
    kind: "bet",
    title,
    left: "",
    right: "",
    good: null,
    lo: 0,
    hi: 1,
    noOdds: true,
    rows: racers.map((r) => {
      const past = pastWin?.get(r.boat) ?? null;
      return {
        boat: r.boat,
        x: null,
        nums: past ? [pastNumOf(target, past)] : [],
      };
    }),
  };
}

/** 買い目レンズの図（オッズがあるとき） */
function betBoardWithOdds({
  title,
  popLabel,
  useWin,
  comp,
  racers,
  trifecta,
  pastWin,
  target,
}) {
  const sorted = [...comp.values()].sort((a, b) => a - b);
  const hiOdds = Math.max(300, sorted[sorted.length - 1]);
  return {
    kind: "bet",
    title,
    missingFirst: useWin
      ? []
      : missingFirstBoats(
          trifecta,
          racers.filter((r) => !r.absent).map((r) => r.boat),
        ),
    left: "人気",
    right: "人気薄",
    // オッズは良し悪しでなく市場の見立て。「良い」の札は付けない（BOA-808 5、2026-10-10 ユーザー決定）
    good: null,
    lo: 0,
    hi: Math.log(hiOdds),
    log: true,
    rows: racers.map((r) => {
      const c = comp.get(r.boat);
      const past = pastWin?.get(r.boat) ?? null;
      return {
        boat: r.boat,
        x: c == null ? null : Math.log(c),
        nums: [
          c != null && {
            metric: null,
            label: popLabel,
            short: popLabel,
            text: `${1 + sorted.filter((o) => o < c).length}番（${c.toFixed(1)}倍）`,
            aria: null,
            best: false,
            muted: target !== 1,
          },
          // 艇ごとに集めた範囲が違うので6艇で比べない（金枠を付けない。FR-3a「付けない所」）
          past && pastNumOf(target, past),
        ].filter(Boolean),
      };
    }),
  };
}

/** 買い目レンズの図 */
function betBoard({ racers, trifecta, pastWin, target, finalWin }) {
  // 買い目: 1着人気（左ほど人気）。締切前は1着になる組（3連単）の合成オッズ、締切後は公式の単勝の締切時オッズ
  // （race_odds_final.win_all。票0は 0 なので値を出さない。2026-10-28 オーナー決定。BOA-1174 で2026-10-26 桐生1R の6艇が公式の締切時オッズと一致）。
  // オッズが無ければ艇番順に並べるだけ
  const absentBoats = racers.filter((r) => r.absent).map((r) => r.boat);
  const winMap = new Map(
    Object.entries(finalWin ?? {})
      .map(([b, v]) => [Number(b), Number(v)])
      .filter(([b, v]) => v > 0 && !absentBoats.includes(b)),
  );
  const useWin = winMap.size > 0;
  const comp = useWin ? winMap : firstPlaceComposite(trifecta, absentBoats);
  const title = useWin
    ? ASSIST_COPY.boardBetTitleWin
    : ASSIST_COPY.boardBetTitle;
  const popLabel = useWin ? ASSIST_COPY.popLabelWin : ASSIST_COPY.popLabel;
  if (!comp.size) return betBoardNoOdds({ title, racers, pastWin, target });
  return betBoardWithOdds({
    title,
    popLabel,
    useWin,
    comp,
    racers,
    trifecta,
    pastWin,
    target,
  });
}

/**
 * レンズ（または6艇比較の項目）の図のモデル。純粋関数
 * @param {{lens: string, stage: "pre"|"post", metric?: string|null, racers: object[], trifecta?: object|null, finalRound?: boolean, hasToday?: boolean, pastWin?: Map<number, {k: number, n: number}>|null}} args
 *   pastWin: 買い目レンズの「過去の{着順}」（艇ごとの差がつく材料の範囲での target の着順。assistSummary.b1Usual）
 *   placeRates: 相手レンズの各艇の2着以内・3着以内（Map<艇, {t2: {k, n}, t3: {k, n}}>。艇ごとの範囲、spec D-46）
 *   target: 買い目の着順（1＝1着・2＝2着以内・3＝3着以内。spec D-44・D-46 で買い目だけ）。1以外では人気の札を「人気（1着）」にして薄くする
 *   stBasis: 展開レンズの平均ST（展示前も展示後も。spec D-47 (1)。"course"＝このコース・直近30走、"overall"＝直近30走。BOA-815 案A）
 *   stMissing: v16 の保存が無いと分かった（"not_saved"）。軸レンズに平均ST を出せない理由を書く
 *   hasToday: v16 の today が届いているか。届いていない（読み込み中・保存が無い）ときは v16 の値（平均ST）を
 *   「記録なし」と書かず出さない（記録が無いのではなく、データが無いだけ。ファン評価 1周目 指摘3）
 *   racers は1〜6号艇（欠場を含む）: {boat, natWin, locWin, stMean, stCourse, motor2, seriesScore, exhTime, exhSt, exhFlying, absent}
 * @returns {{kind: string, title: string, left: string, right: string, good: "left"|"right"|null, lo: number, hi: number, log?: boolean, rows: Array<{boat: number, x: number|null, nums: object[], dotText?: string|null}>}}
 */
export function boardModel(args) {
  const a = withBoardDefaults(args);
  const { lens, stage, metric, racers, finalRound } = a;
  const post = stage === "post";
  if (metric)
    return metricBoard({
      lens,
      metric,
      racers,
      finalRound,
      stBasis: a.stBasis,
    });
  if (lens === "axis")
    return axisBoard({
      racers,
      finalRound,
      hasToday: a.hasToday,
      stMissing: a.stMissing,
    });
  if (lens === "flow")
    return flowBoard({
      racers,
      post,
      hasToday: a.hasToday,
      stBasis: a.stBasis,
      stMissing: a.stMissing,
    });
  if (lens === "place") return placeBoard({ racers, placeRates: a.placeRates });
  if (lens === "power")
    return post
      ? powerBoardPost({ racers, finalRound })
      : powerBoardPre({ racers, finalRound });
  return betBoard({
    racers,
    trifecta: a.trifecta,
    pastWin: a.pastWin,
    target: a.target,
    finalWin: a.finalWin,
  });
}

export * from "../pure/predictionAssistScope.js";
export * from "../pure/predictionAssistBoardParts.js";
export * from "../pure/predictionAssistBets.js";
