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
  hintBadgeByForm,
  hintRows,
  rankBand,
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

/**
 * 範囲の呼び名（VC は「{会場}・級の並びが同じ」、NC・NCR は「全国・級の並びが同じ（準優勝戦）」）。
 * 艇を渡すと「（{n}号艇が{級}）」を添える。範囲は選んだ艇の艇番と級をそろえるので、同じ呼び名でも艇ごとに件数が違う
 * （spec D-41 (4)。BOA-809、2026-10-10 ユーザー決定）
 */
export const factsScopeLabel = (scope, venue, boat = null, cls = null) =>
  `${
    scope.kind === "VC"
      ? `${venue ?? ""}・級の並びが同じ`
      : sameClassLabel({ kind: scope.kind, round: scope.round })
  }${boat && cls ? `（${boat}号艇が${cls}）` : ""}`;

/**
 * 差がつく材料の行。today の6艇の値で、その艇の今日の位置（1＝一番良い、6＝一番悪い）を付ける。
 * target は着順（1＝1着・2＝2着以内・3＝3着以内。軸・買い目の切り替え、spec D-44）。今日の位置は着順で変わらない
 * 優勝戦・準優勝戦の日の今節の平均着順点は「今日」に使わない（off。FR-5・v16 Q7）
 * @param {{scope: ReturnType<typeof factsScope>, today: object|null, exhibition?: object|null, boat: number, post: boolean, finalRound: boolean, target?: 1|2|3}} args
 * @returns {Array<{key: string, good: string, bad: string, level: string, bucket: number|null, off: boolean, hit: boolean, pair: [number, number]|null, rate: number|null, best: [number, number]|null, worst: [number, number]|null}>}
 */
export function factChips({
  scope,
  today,
  exhibition = null,
  boat,
  post,
  finalRound,
  target = 1,
}) {
  if (!scope) return [];
  const values = todayValues(today, exhibition);
  return factRows(scope.facts, boat, target, post).map((r) => {
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

/**
 * 軸の要約の「差がつく材料」の入口1行（2026-10-11 ユーザー決定 案D。要約の箱は深掘りと重なるので外した）。
 * ▲（今日6艇で一番上か一番下）の付いた材料の数と、深掘りの先頭と同じ順で項目を2つまで。材料が無い（範囲が無い）ときは null
 * @returns {null | {hits: number, keys: string[], rest: number}}
 */
export function factsEntry(chips) {
  if (!chips?.length) return null;
  const hits = chips.filter((c) => c.hit);
  return {
    hits: hits.length,
    keys: hits.slice(0, 2).map((c) => c.key),
    rest: Math.max(0, hits.length - 2),
  };
}

/**
 * 軸の要約の「件数が上の枠と違う理由」に出す項目（BOA-831）。会場の返還の項目は上の枠と同じ1着のときだけ。
 * 空なら折りたたみごと出さない（2着以内・3着以内で中身の無い折りたたみが出ないように）
 * @param {{kind: string, fellBack: boolean, venue: string|null, win: boolean, venueRefund: boolean}} args
 * @returns {Array<"venueScope"|"venueRefund"|"fellBack">}
 */
export function axisWhyKinds({ kind, fellBack, venue, win, venueRefund }) {
  if (!venue) return [];
  return [
    kind === "VC" && "venueScope",
    win && venueRefund && "venueRefund",
    fellBack && "fellBack",
  ].filter(Boolean);
}

/**
 * 図の「良い方の札」: 差が大きい項目のうち、今日その艇が6艇で一番良いもの（screens「レンズごとの図 C」軸）。
 * 一番悪い側は図に出さない（深掘り・要約で出す）
 */
export const boardFactMark = (chips) =>
  chips.find((c) => c.level === "large" && c.bucket === 1 && !c.off) ?? null;

/**
 * 軸の要約の大きい数字: その範囲でのその艇の1着・2着以内・3着以内（target。返還のあったレースを含む。facts の usual）
 * @returns {null | {k: number, n: number}}
 */
export function b1Usual(scope, boat = 1, target = 1) {
  const pair = scope ? usualOf(scope.facts, boat, target) : null;
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
 * 今日当てはまる「なりやすい」形（形ごとに当てはまったときの率が一番高い手がかり）。率の高い順（先頭が hintSummary の top）。
 * 2つ以上なら図の上の結論で選べる（承認モック v2 ④、spec D-47 (3)）
 * @returns {Array<object>} hintRows の行
 */
export const hintForms = (scenario, today) =>
  scenario
    ? Object.values(hintBadgeByForm(hintSummary(scenario, today).rows)).sort(
        (a, b) => b.ph - a.ph,
      )
    : [];

/**
 * もし{形}になったら の決まり手の内訳（spec D-47 (4)）。攻める艇が1着のレースの決まり手（まくり・まくり差し・差しの順。0件は外す）
 * 範囲は形の見立てと同じ scenario の attack（枠なりのレース）
 * @returns {null | {att: number, w: number, rows: Array<[string, number]>}}
 */
export function attackTech(scenario, form) {
  const a = scenario?.attack?.[form];
  const w = a?.all?.att_win?.[0] ?? 0;
  if (!a?.attacker || !w) return null;
  return {
    att: a.attacker,
    w,
    rows: ["makuri", "makurizashi", "sashi"]
      .map((t) => [t, a.all[`att_${t}_of_win`]?.[0] ?? 0])
      .filter(([, k]) => k > 0),
  };
}

const BANDS = ["top", "mid", "low"];
const rateOfPair = (p) => (p?.[1] ? p[0] / p[1] : null);

/**
 * 今日の展示を入れると（spec D-47 (5)）: 攻める艇の1着・1号艇の逃げを、その艇の展示タイムの順位の区分（1〜2位・3〜4位・5〜6位）ごとに。
 * 範囲は形の見立てと同じ scenario、nat は全国（NA）の同じ形の値。today は今日の区分（6艇の展示タイムがそろわなければ null。exhToday と同じ）
 * @param {object|null} scenario
 * @param {object|null} national 全国（NA）の scenario
 * @param {string} form
 * @param {(number|null)[]|null} exhRanks
 * @returns {null | {n: number, att: object|null, b1: object|null}} 各艇: {boat, rank, today, rows: [{band, k, n}], nat: (number|null)[]|null}
 */
export function exhBands(scenario, national, form, exhRanks) {
  // 攻める艇の無い形（横一線・内3艇そろう）は by_exh が無く、1号艇の区分（b1_by_exh）だけある
  const a = scenario?.attack?.[form];
  if (!a?.by_exh && !a?.b1_by_exh) return null;
  const na = national?.attack?.[form] ?? null;
  const ok =
    exhRanks?.length === 6 && exhRanks.every((r) => r != null) ? exhRanks : null;
  const side = (by, natBy, key, boat) => {
    const rank = ok ? ok[boat - 1] : null;
    return {
      boat,
      rank,
      today: rankBand(rank),
      rows: BANDS.map((band) => ({
        band,
        k: by?.[band]?.[key]?.[0] ?? 0,
        n: by?.[band]?.[key]?.[1] ?? 0,
      })),
      nat: natBy ? BANDS.map((b) => rateOfPair(natBy[b]?.[key])) : null,
    };
  };
  return {
    n: a.all?.n ?? 0,
    att:
      a.attacker && a.by_exh
        ? side(a.by_exh, na?.by_exh, "att_win", a.attacker)
        : null,
    b1: a.b1_by_exh ? side(a.b1_by_exh, na?.b1_by_exh, "b1_nige", 1) : null,
  };
}

/** 全国の値が上位 > 中位 > 下位の順に並ぶか（「順位が上ほど多い」と書いてよいか） */
export const descending = (vals) =>
  Array.isArray(vals) &&
  vals.every((v) => v != null) &&
  vals[0] > vals[1] &&
  vals[1] > vals[2];

/**
 * オリジナル展示の「6艇で一番」（spec D-47 (7)）。一周（周回）・まわり足だけ（直線は効かないので出さない。秒数は機力レンズ）
 * @param {{kinds: string[], byBoat: object}|null} original
 * @param {object[]} racers
 * @returns {Array<{kind: string, boats: number[]}>}
 */
export function originalBest(original, racers) {
  return (original?.kinds ?? [])
    .filter((k) => k === "一周" || k === "まわり足")
    .map((kind) => ({
      kind,
      boats: [
        ...bestBoats(
          OX_RULE[kind],
          racers
            .filter((r) => !r.absent)
            .map((r) => ({
              boat: r.boat,
              value: num(original?.byBoat?.[r.boat]?.[kind]),
            })),
        ),
      ].sort((x, y) => x - y),
    }))
    .filter((b) => b.boats.length > 0);
}

/**
 * 図の上の「今日の展示」1行（spec D-47 (3)）。攻める艇の展示タイムの順位（6艇の順位、同タイムは同じ順位）の区分で、
 * その形のときの攻める艇の1着。範囲は形の見立てと同じ scenario の attack（枠なりのレース）。
 * 区分の件数が30件未満なら割合を出さない（few。承認モック v2 の決まり）。展示タイムが1艇でも無ければ null
 * @param {object|null} scenario
 * @param {string} form スリットの形
 * @param {(number|null)[]|null} exhRanks 艇番順の展示タイムの順位
 * @returns {null | {att: number, rank: number, band: "top"|"mid"|"low", k: number, n: number, few: boolean}}
 */
export function exhToday(scenario, form, exhRanks) {
  // 区分の表（v16 の by_exh）は6艇の展示タイムがそろったレースだけで作る。欠けた日は5艇の順位になり母集団がずれるので出さない
  // （data-accuracy-verifier の指摘。10月の 1,692R 中 14R）
  if (!exhRanks || exhRanks.length !== 6 || exhRanks.some((r) => r == null))
    return null;
  const a = scenario?.attack?.[form];
  const att = a?.attacker ?? null;
  const rank = att ? (exhRanks?.[att - 1] ?? null) : null;
  const band = rankBand(rank);
  const pair = band ? a.by_exh?.[band]?.att_win : null;
  if (!pair?.[1]) return null;
  return {
    att,
    rank,
    band,
    k: pair[0],
    n: pair[1],
    few: pair[1] < MIN_SCENARIO,
  };
}

/**
 * 3連単の件数 → よく出た2連単（1着-2着）の多い順。同数は組み合わせの昇順（trifectaList と同じ）
 * @param {Record<string, number>} tri
 * @returns {Array<[number[], number]>}
 */
export function exactaList(tri) {
  const sum = new Map();
  for (const [x, c] of trifectaList(tri)) {
    const key = `${x[0]}-${x[1]}`;
    sum.set(key, (sum.get(key) ?? 0) + c);
  }
  return [...sum]
    .map(([k, c]) => [k.split("-").map(Number), c])
    .sort((a, b) => b[1] - a[1] || a[0].join("").localeCompare(b[0].join("")));
}

/**
 * 1号艇が1着のとき、2着・3着に来た艇（BOA-831 案1b、spec D-44 (3)）。範囲は軸の大きい数字と同じ範囲キーの scenario。
 * 全体のセル（cells.all.forms.any）の3連単から、1着が boat の組だけで数える（返還のあったレースは scenario 側で除かれている）
 * @param {object|null} scenario scenario の応答の scenario
 * @returns {null | {n: number, second: number[], third: number[], topTrifecta: Array<[number[], number]>, few: boolean}}
 *   second・third は1〜6号艇の件数（boat 自身は0）
 */
export function winFollowers(scenario, boat = 1) {
  const rows = trifectaList(scenario?.cells?.all?.forms?.any?.tri, {
    first: boat,
  });
  const n = rows.reduce((a, [, c]) => a + c, 0);
  if (!n) return null;
  const second = [0, 0, 0, 0, 0, 0];
  const third = [0, 0, 0, 0, 0, 0];
  for (const [x, c] of rows) {
    second[x[1] - 1] += c;
    third[x[2] - 1] += c;
  }
  return {
    n,
    second,
    third,
    topTrifecta: rows.slice(0, 3),
    few: n < MIN_SCENARIO,
  };
}

/**
 * 案1b の件数と軸の大きい数字（1着、返還を含む）の関係。同じなら same、少ないなら返還を除いた分で refund、
 * 多いとき（別の応答で時刻がずれた等）は書かない（null。BOA-831 /code-review の指摘）
 * @returns {"same"|"refund"|null}
 */
export const followNoteKind = (n, axisK) =>
  n === axisK ? "same" : n < axisK ? "refund" : null;

/**
 * スリットの形のときの1着の艇とよく出た3連単（枠なり。承認モック v7 の「もし2コース凹みになったら」）
 * よく出た2連単（上位5つ）は BOA-831 案2（spec D-44 (4)）
 * @returns {null | {form: string, n: number, first: number[], topExacta: Array<[number[], number]>, topTrifecta: Array<[number[], number]>, attacker: number|null, few: boolean}}
 */
export function formSummary(scenario, form) {
  const cell = scenario?.cells?.waku?.forms?.[form];
  if (!cell?.n) return null;
  return {
    form,
    n: cell.n,
    first: cell.first_boat,
    topExacta: exactaList(cell.tri).slice(0, 5),
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
 * 機力の結論に出す「項目ごとの一番」。順は展示タイム → オリジナル展示（種目の順）→ モーター2連率で固定。
 * 展示タイムだけで結論を決めない（BOA-808 2: 徳山の一周・まわり足は1号艇が一番なのに出なかった）
 * @param {{table: ReturnType<typeof exhibitionTable>|null, motor: {best: Set<number>, valueOf: (boat: number) => number|null}}} args
 * @returns {Array<{label: string, boats: number[], text: string}>} text は単位つきの値（同着は先頭の艇の値）
 */
export function powerWinners({ table, motor }) {
  const sorted = (set) => [...set].sort((a, b) => a - b);
  const rowOf = (boat) => table.rows.find((r) => r.boat === boat);
  const items = [];
  const push = (label, set, valueOf, fmt) => {
    if (!set?.size) return;
    const boats = sorted(set);
    const v = valueOf(boats[0]);
    if (v == null) return;
    items.push({ label, boats, text: fmt(v) });
  };
  const sec = (v) => `${v.toFixed(2)}秒`;
  if (table) {
    push("展示タイム", table.best.exh, (b) => rowOf(b)?.exh ?? null, sec);
    table.kinds.forEach((k, i) =>
      push(k, table.best.ox[i], (b) => rowOf(b)?.ox[i] ?? null, sec),
    );
  }
  push("モーター2連率", motor.best, motor.valueOf, (v) => `${v.toFixed(1)}%`);
  return items;
}

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
