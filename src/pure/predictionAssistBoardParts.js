/**
 * 思考アシスト（BOA-430）のボードの部品のうち、文言（src/data）を読まない計算。純粋関数だけ。
 * src/utils/assistModel.js から字のまま移した（文言を読む組み立ては assistModel.js に残す）。
 */
import { bestBoats } from "./predictionAssistScope.js";

// ---- レースの図（screens「レンズごとの図 C」、N-2: 最初に見える数字は1艇2個まで）----

// 相手（place）は機力と買い目の間（2026-10-12 ユーザー決定「買い目の隣」、spec D-46）
export const LENSES = ["axis", "flow", "power", "place", "bet"];

/** 平均ST・展示ST を「.132」の形に（画面の文字）。読み上げ・比べるときは小数のまま */
export const stText = (v, digits = 3) =>
  v == null
    ? "—"
    : `.${String(Math.round(v * 10 ** digits)).padStart(digits, "0")}`;

/**
 * 6艇比較・図の数字に使う項目。label は読み上げと比べる図の見出し、short は図の札、
 * text は画面の文字、aria は読み上げの値（平均ST は 0.132 の形）
 */
export const METRICS = {
  nat_win: {
    tick: (v) => v.toFixed(1), // 6艇比較の目盛り（BOA-804）
    label: "全国勝率",
    short: "勝率",
    value: (r) => r.natWin,
    text: (v) => v.toFixed(2),
    aria: (v) => v.toFixed(2),
  },
  loc_win: {
    tick: (v) => v.toFixed(1), // 6艇比較の目盛り（BOA-804）
    label: "当地勝率",
    short: "当地",
    value: (r) => (r.locWin === 0 ? null : r.locWin),
    text: (v) => v.toFixed(2),
    aria: (v) => v.toFixed(2),
  },
  st_mean30: {
    // 公式の出走表の平均ST（期別）とは期間が違うので、読み上げ・6艇比較の見出しに期間を書く（ファン評価 1周目 指摘1）
    label: "平均ST（直近30走）",
    short: "ST(30走)", // 札にも期間を出す（2026-10-08 ユーザー決定、ファン評価 3周目 P1）
    value: (r) => r.stMean,
    text: (v) => stText(v),
    aria: (v) => v.toFixed(3),
  },
  motor_2: {
    tick: (v) => `${Math.round(v)}%`, // 6艇比較の目盛り（BOA-804）
    label: "モーター2連率",
    short: "モーター2連率", // 「モーター」だけだと何の値か分からない（BOA-801 9）
    value: (r) => r.motor2,
    text: (v) => `${v.toFixed(1)}%`,
    aria: (v) => v.toFixed(1),
  },
  exh_time: {
    label: "展示タイム",
    short: "展示",
    value: (r) => r.exhTime,
    text: (v) => v.toFixed(2),
    aria: (v) => v.toFixed(2),
  },
  series_score: {
    tick: (v) => v.toFixed(1), // 6艇比較の目盛り（BOA-804）
    label: "今節の平均着順点",
    short: "今節",
    value: (r) => r.seriesScore,
    text: (v) => v.toFixed(2),
    aria: (v) => v.toFixed(2),
  },
  // 展開レンズの点の値（押すと6艇比較。ファン評価で PR4 に回した「スタートの値の数字ボタン」）
  st_course: {
    // 名前に期間を付ける（BOA-815 方針1）。値は v16 の course_filled（5走未満は直近30走で補った値。判定と同じ）
    label: "平均ST（このコース・直近30走）",
    short: "ST",
    value: (r) => r.stCourse,
    text: (v) => stText(v),
    aria: (v) => v.toFixed(3),
  },
  exh_st: {
    // 図は平均ST。展示ST は押して比べる所で、本番のスタートとは別と名前に書く（spec D-47 (1)）
    label: "展示ST（本番のスタートとは別）",
    short: "展示ST",
    value: (r) => r.exhSt,
    text: (v, r) => `${r?.exhFlying ? "F" : ""}${stText(Math.abs(v), 2)}`,
    // 図の位置: F はスタートラインより前なので .00 より左（負）に置く（ファン評価 PR4 1周目 指摘7）
    plot: (r) =>
      r.exhSt == null
        ? null
        : r.exhFlying
          ? -Math.abs(r.exhSt)
          : Math.abs(r.exhSt),
    aria: (v, r) => `${r?.exhFlying ? "F" : ""}${Math.abs(v).toFixed(2)}`,
  },
};

/** 数字1個（図の札・6艇比較の値）。best は最良の金枠（FR-3a） */
function numOf(metric, racer, best) {
  const def = METRICS[metric];
  const v = def.value(racer);
  return {
    metric,
    label: def.label,
    short: def.short,
    text: v == null ? "記録なし" : def.text(v, racer),
    aria: v == null ? "記録なし" : def.aria(v, racer),
    best: best.has(racer.boat),
  };
}

/** 6艇の値の最良（項目ごと）。優勝戦・準優勝戦の日の今節の点には付けない */
function bestOfMetric(metric, racers, finalRound) {
  return bestBoats(
    metric,
    racers.map((r) => ({
      boat: r.boat,
      value: METRICS[metric].value(r),
      flying: r.exhFlying,
    })),
    { finalRound },
  );
}

const abs = (v) => (typeof v === "number" ? Math.abs(v) : v);

/** 平均ST・展示ST の項目。6艇比較でも展開レンズと同じ .00〜.25 の縮尺にする（BOA-804） */
const ST_METRICS = new Set(["st_mean30", "st_course", "exh_st"]);

/** 値の幅から図の端を決める（両端に幅の15%の余白。全艇同じ値なら ±1） */
function span(values) {
  const vs = values.filter((v) => typeof v === "number");
  if (!vs.length) return { lo: 0, hi: 1 };
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const pad = max > min ? (max - min) * 0.15 : 1;
  return { lo: min - pad, hi: max + pad };
}

/**
 * 展示タイムの6艇の順位（艇番順）。同タイムは同じ順位、値の無い艇は null（龍神ソナーの区分と同じ min 順位。spec D-47 (2)）
 * @param {{exhTime: number|null}[]} racers
 * @returns {(number|null)[]}
 */
export const exhRanks = (racers) =>
  racers.map((r) =>
    r.exhTime == null
      ? null
      : 1 +
        racers.filter((o) => o.exhTime != null && o.exhTime < r.exhTime).length,
  );

/**
 * 1着になる組（20通り）の合成オッズ。欠場の艇を含む組・オッズの無い組は数えない（D-38）
 * @returns {Map<number, number>} 艇番 → 合成オッズ
 */
export function firstPlaceComposite(trifecta, absentBoats = []) {
  const absent = new Set(absentBoats);
  const inv = new Map();
  for (const [key, odds] of Object.entries(trifecta ?? {})) {
    if (odds == null || !(odds > 0)) continue;
    const boats = key.split("-").map(Number);
    if (boats.some((b) => absent.has(b))) continue;
    inv.set(boats[0], (inv.get(boats[0]) ?? 0) + 1 / odds);
  }
  return new Map([...inv].map(([b, s]) => [b, 1 / s]));
}

/**
 * 1着になる組のうちオッズの無い組がある艇（図の1着人気が欠けた組を除いた合成になる艇）。組の長さ（2連単は2艇、
 * 3連単は3艇）はオッズの表のキーから読む。欠場の艇は出走する艇に入れない（D-38）
 * @param {Record<string, number|null>|null} odds
 * @param {number[]} boats 出走する艇
 * @returns {number[]}
 */
export function missingFirstBoats(odds, boats) {
  const keys = Object.keys(odds ?? {});
  if (!keys.length) return [];
  const legs = keys[0].split("-").length;
  const priced = (k) => odds[k] != null && odds[k] > 0;
  return boats.filter((b) => {
    let combos = [[b]];
    for (let i = 1; i < legs; i++)
      combos = combos.flatMap((c) =>
        boats.filter((x) => !c.includes(x)).map((x) => [...c, x]),
      );
    return combos.some((c) => !priced(c.join("-")));
  });
}

/** 軸レンズの図 */
function axisBoard({ racers, finalRound, hasToday, stMissing }) {
  const bNat = bestOfMetric("nat_win", racers, finalRound);
  const bSt = bestOfMetric("st_mean30", racers, finalRound);
  const s = span(racers.map((r) => r.natWin));
  return {
    kind: "axis",
    title: "全国勝率",
    // v16 の保存が無いと分かったレースは平均ST（直近30走）を出せない。黙って消さず理由を書く（BOA-808 6）。
    // 正本は v16 の st_mean30（BOA-815）なので、別の出どころの値では埋めない。読み込み中は書かない
    noSt: stMissing,
    left: s.lo.toFixed(1),
    right: s.hi.toFixed(1),
    good: "right",
    ...s,
    rows: racers.map((r) => ({
      boat: r.boat,
      x: r.natWin,
      nums: hasToday
        ? [numOf("nat_win", r, bNat), numOf("st_mean30", r, bSt)]
        : [numOf("nat_win", r, bNat)],
    })),
  };
}

/** 機力レンズの図（展示後。展示タイムの差） */
function powerBoardPost({ racers, finalRound }) {
  const bMotor = bestOfMetric("motor_2", racers, finalRound);
  const bExh = bestOfMetric("exh_time", racers, finalRound);
  const times = racers.map((r) => r.exhTime).filter((v) => v != null);
  const fastest = times.length ? Math.min(...times) : null;
  const gaps = racers.map((r) =>
    r.exhTime == null || fastest == null ? null : r.exhTime - fastest,
  );
  const hi = Math.max(0.1, ...gaps.filter((v) => v != null));
  return {
    kind: "power",
    title: "展示タイム（一番速い艇との差、左ほど速い）",
    left: "+0.00",
    right: `+${hi.toFixed(2)}`,
    good: "left",
    lo: 0,
    hi,
    rows: racers.map((r, i) => ({
      boat: r.boat,
      x: gaps[i],
      nums: [numOf("motor_2", r, bMotor), numOf("exh_time", r, bExh)],
    })),
  };
}

/** 機力レンズの図（展示前。モーター2連率） */
function powerBoardPre({ racers, finalRound }) {
  const bMotor = bestOfMetric("motor_2", racers, finalRound);
  const s = span(racers.map((r) => r.motor2));
  return {
    kind: "power",
    title: "モーター2連率（右ほど高い）",
    left: `${Math.round(s.lo)}%`,
    right: `${Math.round(s.hi)}%`,
    good: "right",
    ...s,
    rows: racers.map((r) => ({
      boat: r.boat,
      x: r.motor2,
      nums: [numOf("motor_2", r, bMotor)],
    })),
  };
}

/** boardModel の引数の既定値（元の分割代入の既定値と同じ） */
function withBoardDefaults({
  lens,
  stage,
  metric = null,
  racers,
  trifecta = null,
  finalRound = false,
  hasToday = true,
  pastWin = null,
  placeRates = null,
  target = 1,
  stBasis = "course",
  stMissing = false,
  finalWin = null,
}) {
  return {
    lens,
    stage,
    metric,
    racers,
    trifecta,
    finalRound,
    hasToday,
    pastWin,
    placeRates,
    target,
    stBasis,
    stMissing,
    finalWin,
  };
}

export {
  numOf,
  bestOfMetric,
  abs,
  ST_METRICS,
  span,
  axisBoard,
  powerBoardPost,
  powerBoardPre,
  withBoardDefaults,
};
