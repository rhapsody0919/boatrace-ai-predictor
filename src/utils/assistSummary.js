/**
 * 思考アシスト（BOA-430）のレンズの要約・図の印・深掘りのモデル。純粋関数だけ（取得・描画はしない）。
 * 検査は scripts/maintenance/verify-thinking-assist-summary.js（徳山10R 2026-10-06 の本番 v16 の値で固定）。
 * 仕様: docs/design/thinking-assist/spec.md（FR-4・FR-5・D-29・D-36 (10)(11)・D-37・D-41）・screens「レンズごとの図 C」
 */
import {
  defaultScope,
  factRows,
  rateOf,
  scopeKind,
  todayPosition,
  todayValues,
  usualOf,
} from "./analogyFacts.js";
import {
  ATTACK_BOAT,
  MIN_SCENARIO,
  entryType,
  hintRows,
} from "./analogyScenario.js";
import { trifectaList } from "./analogyAggregate.js";
import { wilsonInterval } from "./wilson.js";
import { FEW_ROUND, bestBoats, sameClassLabel } from "./assistModel.js";
import {
  buildMeetResults,
  finishPositionOf,
  recordsBeforeRace,
} from "../components/race/basicInfoStats.js";
import { SCORE_POINTS } from "../components/race/seriesPoints.js";

// ---- 差がつく材料の範囲（D-37）----

/**
 * その艇の差がつく材料に使う範囲。v16 の既定（VC が300件以上なら VC、ほかは NC）。
 * 優勝戦・準優勝戦の日に NC になるときは、同じラウンドの NCR が30件以上あれば NCR に絞る（D-37）
 * @param {Record<string, object>|null} facts v16 facts の facts（範囲キー → 集計）
 * @param {object|null} today v16 facts の today
 * @param {number} boat
 * @param {string|null} round assistModel.raceRound の戻り値
 * @returns {null | {key: string, kind: "VC"|"NC"|"NCR"|"VA", facts: object, n: number, round: string|null, fellBack: boolean, vcCount: number|null}}
 */
export function factsScope(facts, today, boat, round) {
  const keys = today?.scope_keys?.[String(boat)];
  if (!keys || !facts) return null;
  const d = defaultScope(keys, (k) => facts[k]?.n ?? null);
  let key = d.key;
  if (
    round &&
    key === keys.NC &&
    keys.NCR &&
    (facts[keys.NCR]?.n ?? 0) >= FEW_ROUND
  )
    key = keys.NCR;
  const f = facts[key];
  if (!f) return null;
  const kind = scopeKind(key);
  return {
    key,
    kind,
    facts: f,
    n: f.n,
    round: kind === "NCR" ? round : null,
    fellBack: d.fellBack,
    vcCount: d.vcCount,
  };
}

/** 範囲の呼び名（VC は「{会場}・級の並びが同じ」、NC・NCR は「全国・級の並びが同じ（準優勝戦）」） */
export const factsScopeLabel = (scope, venue) =>
  scope.kind === "VC"
    ? `${venue ?? ""}・級の並びが同じ`
    : sameClassLabel({ kind: scope.kind, round: scope.round });

/**
 * 差がつく材料の行（1着）。today の6艇の値で、その艇の今日の位置（1＝一番良い、6＝一番悪い）を付ける。
 * 優勝戦・準優勝戦の日の今節の平均着順点は「今日」に使わない（off。FR-5・v16 Q7）
 * @param {{scope: ReturnType<typeof factsScope>, today: object|null, exhibition?: object|null, boat: number, post: boolean, finalRound: boolean}} args
 * @returns {Array<{key: string, good: string, bad: string, level: string, bucket: number|null, off: boolean, hit: boolean, pair: [number, number]|null, rate: number|null, best: [number, number]|null, worst: [number, number]|null}>}
 */
export function factChips({
  scope,
  today,
  exhibition = null,
  boat,
  post,
  finalRound,
}) {
  if (!scope) return [];
  const values = todayValues(today, exhibition);
  return factRows(scope.facts, boat, 1, post).map((r) => {
    const off = r.key === "series_score" && finalRound;
    const pos = values[r.key]
      ? todayPosition(values[r.key], r.hib, boat)
      : null;
    const bucket = pos?.bucket ?? null;
    const hit = !off && (bucket === 1 || bucket === 6);
    const pair = bucket === 1 ? r.all[0] : bucket === 6 ? r.all[5] : null;
    return {
      key: r.key,
      good: r.good,
      bad: r.bad,
      level: r.judge.level,
      bucket,
      off,
      hit,
      pair: hit ? pair : null,
      rate: hit ? rateOf(pair) : null,
      // セオリーカード（TC-F）の「一番良いとき／一番悪いとき」の棒
      best: r.all[0],
      worst: r.all[5],
    };
  });
}

/** 軸の要約の札: 差が大きい項目だけ、今日当てはまる（一番良い・悪い）ものを先に、上位4つ（承認モック v7） */
export const axisFactChips = (chips) =>
  chips
    .filter((c) => c.level === "large")
    .sort((a, b) => Number(b.hit) - Number(a.hit))
    .slice(0, 4);

/**
 * 図の「良い方の札」: 差が大きい項目のうち、今日その艇が6艇で一番良いもの（screens「レンズごとの図 C」軸）。
 * 一番悪い側は図に出さない（深掘り・要約で出す）
 */
export const boardFactMark = (chips) =>
  chips.find((c) => c.level === "large" && c.bucket === 1 && !c.off) ?? null;

/**
 * 軸の要約の大きい数字: その範囲での1号艇の1着（返還のあったレースを含む。facts の usual）
 * @returns {null | {k: number, n: number}}
 */
export function b1Usual(scope, boat = 1) {
  const pair = scope ? usualOf(scope.facts, boat, 1) : null;
  return pair && pair[1] ? { k: pair[0], n: pair[1] } : null;
}

// ---- 展開（screens「レンズごとの図 C」展開、FR-6 TC-H・TC-S・TC-E）----

/** 手がかりの印を付ける艇（凹む・攻めるのが1艇に決まる条件だけ） */
export const HINT_BOAT = {
  d2_slow01: 2,
  d3_slow01: 3,
  in_slow02: 1,
  kado4: 4,
  kado4_02: 4,
};

/**
 * 今日当てはまる平均ST の手がかり（このコースの平均ST、v16 タブ3 と同じ数え方）。
 * top は「なりやすい」（up）のうち、当てはまったときの率が一番高いもの
 * @param {object|null} scenario scenario の応答の scenario（全国・級の並びが同じ）
 * @param {object|null} today
 */
export function hintSummary(scenario, today) {
  const rows = hintRows(
    scenario?.hints,
    today?.hints?.course,
    "course",
    wilsonInterval,
  );
  const up = rows.filter((r) => r.kind === "up").sort((a, b) => b.ph - a.ph);
  return { rows, top: up[0] ?? null };
}

/**
 * スリットの形のときの1着の艇とよく出た3連単（枠なり。承認モック v7 の「もし2コース凹みになったら」）
 * @returns {null | {form: string, n: number, first: number[], topTrifecta: Array<[number[], number]>, attacker: number|null, few: boolean}}
 */
export function formSummary(scenario, form) {
  const cell = scenario?.cells?.waku?.forms?.[form];
  if (!cell?.n) return null;
  return {
    form,
    n: cell.n,
    first: cell.first_boat,
    topTrifecta: trifectaList(cell.tri).slice(0, 3),
    attacker: ATTACK_BOAT[form] ?? null,
    few: cell.n < MIN_SCENARIO,
  };
}

/**
 * 今日の展示の進入の型と、その型のときの1号艇の1着（前付けは型をまとめた mae の値）
 * @param {object|null} scenario
 * @param {(number|null)[]} courseByBoat 艇番順の展示の進入コース
 * @returns {null | {type: string, group: string, k: number, n: number}}
 */
export function entrySummary(scenario, courseByBoat) {
  const type = entryType(courseByBoat ?? []);
  if (!type) return null;
  const group = type.startsWith("mae") ? "mae" : type;
  const cell = scenario?.cells?.[group]?.forms?.any;
  return { type, group, k: cell?.b1_win ?? 0, n: cell?.n ?? 0 };
}

// ---- 機力（screens「レンズごとの図 C」機力、FR-3a）----

/** オリジナル展示の種別 → 最良の判定のキー（raceIndicators の ORIGINAL_EXHIBITION_ROW_META と同じく全種別 min） */
export const OX_RULE = {
  一周: "ox_lap",
  まわり足: "ox_turn",
  直線: "ox_straight",
  半周ラップ: "ox_half_lap",
};

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 展示の表（展示・オリジナル展示・展示ST・体重・チルト）。最良は展示・オリジナル展示・展示ST（F は除く）だけ。
 * 体重・チルトは向きが無いので付けない（D-33）。体重の一番軽い艇に light
 * @param {{racers: object[], maintenance: object[]|null, original: {kinds: string[], byBoat: object}|null}} args
 *   maintenance は getRaceMotorMaintenanceBreakdown の rows（boat_number・today_weight・tilt・parts_changed・propeller_change）
 */
export function exhibitionTable({ racers, maintenance, original }) {
  const mt = new Map((maintenance ?? []).map((r) => [r.boat_number, r]));
  const kinds = (original?.kinds ?? []).filter((k) => OX_RULE[k]);
  const rows = racers.map((r) => {
    const m = mt.get(r.boat) ?? null;
    return {
      boat: r.boat,
      absent: r.absent,
      exh: r.exhTime,
      exhSt: r.exhSt,
      exhFlying: r.exhFlying,
      ox: kinds.map((k) => num(original?.byBoat?.[r.boat]?.[k])),
      weight: num(m?.today_weight),
      tilt: r.tilt ?? num(m?.tilt),
    };
  });
  const weights = rows.map((r) => r.weight).filter((v) => v != null);
  const lightest = weights.length > 1 ? Math.min(...weights) : null;
  return {
    kinds,
    rows: rows.map((r) => ({
      ...r,
      light: lightest != null && r.weight === lightest,
    })),
    best: {
      exh: bestBoats(
        "exh_time",
        rows.map((r) => ({ boat: r.boat, value: r.exh })),
      ),
      exhSt: bestBoats(
        "exh_st",
        rows.map((r) => ({
          boat: r.boat,
          value: r.exhSt,
          flying: r.exhFlying,
        })),
      ),
      ox: kinds.map((k, i) =>
        bestBoats(
          OX_RULE[k],
          rows.map((r) => ({ boat: r.boat, value: r.ox[i] })),
        ),
      ),
    },
  };
}

/** 部品交換・プロペラ交換のあった艇（raceIndicators の部品交換の行と同じ判定。parts_changed は部品名の配列） */
export function partsChangedBoats(maintenance) {
  return (maintenance ?? [])
    .filter(
      (r) =>
        (Array.isArray(r.parts_changed) && r.parts_changed.length > 0) ||
        Boolean(r.propeller_change),
    )
    .map((r) => r.boat_number)
    .sort((a, b) => a - b);
}

/**
 * チルトが6艇の中で違う艇（一番多い値と違う艇）。多い値が1艇だけ（全艇ばらばら）なら印を付けない
 * @returns {Map<number, number>} 艇番 → チルト
 */
export function tiltOutliers(racers) {
  const vals = racers
    .filter((r) => !r.absent && r.tilt != null)
    .map((r) => [r.boat, r.tilt]);
  const freq = new Map();
  for (const [, t] of vals) freq.set(t, (freq.get(t) ?? 0) + 1);
  const [mode, count] = [...freq].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (count < 2) return new Map();
  return new Map(vals.filter(([, t]) => t !== mode));
}

// ---- 深掘り（FR-5・D-29・D-36 (10)(11)）----

/** 1走の着（1〜6）。着が無い（欠場・失格等）は null */
export const finishOf = (run) => finishPositionOf(run);

/** 1走の点。着があれば着順点、欠場は null（走数に入れない）、F・L・失格・転覆など走って着の無い走は0点 */
const pointsOf = (run) => {
  const f = finishOf(run);
  if (f != null) return SCORE_POINTS[f];
  return run.absent ? null : 0;
};

/**
 * 今節の各走（表示中のレースより前、同じ会場・同じ節）。今日の走は点に入れない（D-29）
 * @param {object[]} records getRacerScopedRaceStats の戻り値
 * @param {string} raceId 表示中のレース
 * @returns {{past: object[], today: object[], sum: number, count: number, avg: number|null, byDay: Array<{date: string, finishes: Array<number|string|null>}>}}
 *   finishes は着（1〜6）か、着の無い走の公式の記号（F・失 等）
 */
export function meetRuns(records, raceId) {
  const venueCode = Number(raceId.slice(11, 13));
  const runs = buildMeetResults(records, { raceId, venueCode });
  const date = raceId.slice(0, 10);
  const past = runs.filter((r) => r.date !== date);
  const today = runs.filter((r) => r.date === date);
  // F・L・失格・転覆等は0点で走数に入れ、欠場だけ外す（v16 の今節の平均着順点・seriesPoints の規則3と同じ。
  // data-accuracy-verifier の指摘: 分母から落とすと平均が v16 の値より高く出る）
  const scored = past.filter((r) => pointsOf(r) != null);
  const sum = scored.reduce((s, r) => s + pointsOf(r), 0);
  const byDay = [];
  for (const r of past) {
    const mark = finishOf(r) ?? r.finishMark ?? null;
    const last = byDay[byDay.length - 1];
    if (last?.date === r.date) last.finishes.push(mark);
    else byDay.push({ date: r.date, finishes: [mark] });
  }
  return {
    past,
    today,
    sum,
    count: scored.length,
    avg: scored.length ? sum / scored.length : null,
    byDay,
  };
}

/** 日付 YYYY-MM-DD → 「10/2」（月・日とも0埋めしない。1走ずつの表と着順の並びで共通） */
export const monthDay = (date) => {
  const [, m, d] = String(date).split("-");
  return `${Number(m)}/${Number(d)}`;
};

/** 着の色のクラス（既存の RaceHistoryTable と同じ: 1着＝金、5・6着＝赤） */
export const finishClass = (f) =>
  f === 1 ? " ta-fin-1" : f === 5 || f === 6 ? " ta-fin-bad" : "";

/** 今節の走の点（今日の走・欠場は null） */
export const runPoints = (run, today) => (today ? null : pointsOf(run));

/**
 * 今節より前の5走（新しい順）。今節の走と表示中のレースより後の走を除いてから5走（D-36 (10)）
 * @param {object[]} records
 * @param {string} raceId
 * @param {object[]} meet meetRuns の past と today
 */
export function priorRuns(records, raceId, meet) {
  const ids = new Set(meet.map((r) => r.raceId));
  return (recordsBeforeRace(records ?? [], raceId) ?? [])
    .filter((r) => !ids.has(r.raceId))
    .slice(-5)
    .reverse();
}

/**
 * そのコースで走ったときの1着（進入コースで数える。D-36 (11)。表示中のレースより前、直近2年）
 * @returns {{k: number, n: number}}
 */
export function courseWins(records, raceId, course) {
  const runs = (recordsBeforeRace(records ?? [], raceId) ?? []).filter(
    (r) => r.actualCourse === course && finishOf(r) != null,
  );
  return { k: runs.filter((r) => finishOf(r) === 1).length, n: runs.length };
}

/**
 * 成績から付けた札（D-41。承認モック v7 の featChips）。6艇の中の一番（同値を含む）だけ。
 * 優勝戦・準優勝戦の日は「今節好調」を出さない（FR-5）
 * @param {{boat: number, today: object|null, finalRound: boolean, technique?: {win_count: number, techniques: Array<{technique: string, count: number}>}|null}} args
 * @returns {Array<{id: string, technique?: string, wins?: number, count?: number}>}
 */
export function featChips({ boat, today, finalRound, technique = null }) {
  const out = [];
  const first = (key, hib) => {
    const v = today?.items?.[key]?.values;
    if (!Array.isArray(v)) return false;
    const vals = key === "loc_win" ? v.map((x) => (x === 0 ? null : x)) : v;
    return todayPosition(vals, hib, boat)?.bucket === 1;
  };
  if (first("st_mean30", false)) out.push({ id: "stFast" });
  if (!finalRound && first("series_score", true))
    out.push({ id: "seriesGood" });
  if (first("recent_win30", true)) out.push({ id: "recentWin" });
  if (first("nat_win", true)) out.push({ id: "natTop" });
  if (first("loc_win", true)) out.push({ id: "locTop" });
  const loc = today?.items?.loc_win?.values?.[boat - 1];
  if (loc === 0 || (today?.items?.loc_win && loc == null))
    out.push({ id: "locNone" });
  const top = technique?.techniques?.[0];
  if (
    top &&
    top.technique !== "逃げ" &&
    technique.win_count >= 8 &&
    top.count / technique.win_count >= 0.3
  )
    out.push({
      id: "tech",
      technique: top.technique,
      wins: technique.win_count,
      count: top.count,
    });
  return out;
}
