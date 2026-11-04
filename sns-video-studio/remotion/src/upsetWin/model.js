/**
 * YouTube Shorts【人気薄の1着】（format・kind = upset_win_short、BOA-1284、オーナー 2026-11-04 承認）の型の決まり。
 * 選び（pickUpset）・材料（buildBundle）・検査（checkBundle）・時間の並び（timeline）を、作り手（scripts/upset-win/daily.mjs）・
 * 描画（UpsetWin.jsx）・送る口（scripts/sns/push-upset-win-short.js）・試験（scripts/maintenance/verify-upset-win.js）が同じ関数で使う。
 * remotion を import しない（CI の Node から読むため）。LLM は使わない。数字は全部 DB の値の差し込み、文は差し込みの型。
 *
 * 仕様の正本: Linear BOA-1284（hq drafts/fp-youtube-type/b-upset/spec.md と同じ文）。見本は hq の同じ場所の b1〜b3.png（2026-11-03 宮島10R）。
 *
 * 選び方（仕様「選び方（機械）」）:
 *   1. 前日の全レース（中止・不成立を除く）のうち、1着の艇の単勝（race_odds_final.win_all）が10倍以上
 *   2. その艇に「データ上の弱さ」が1つ以上: 勝率・展示タイム（遅い順）・展示 ST・モーター2連率のどれかが6艇で最下位（同値の最下位を含む）
 *   3. 単勝の一番高いもの。同じなら弱さの数の多いもの、次にグレードの高いもの（さらに同じなら race_id の小さい方。決まった順にするため）
 *   4. 欠場のあるレースは外す。該当が無い日は null（0本）
 * この型で決めたこと（仕様に無い所。PR の本文に書いた）:
 *   - 展示 ST の F は負の数（F.08 は -0.08）、L（出遅れ）は一番遅いとして並べる（docs/knowledge/data-columns.md の展示 F・L の持ち方）
 *   - 値の無い艇・0 の値（勝率・モーター2連率・展示タイムの 0 は「記録なし」）が1艇でもあれば、そのレースのその項目は比べない。
 *     6艇とも同じ値のときも比べない（「6艇で最下位」と言えない）
 *   - 3コマ目の「一番目立つ1つ」は、その日の状態の項目を先にした決まった順（展示タイム → 展示 ST → モーター2連率 → 勝率）の最初の弱さ
 *     （見本の宮島10R が勝率と展示タイムの2つで、展示タイムを出したのに合わせた）
 *   - 1コマ目の「{弱さ1}も{弱さ2}も」は、表に列のある弱さ（勝率・展示タイムと、3コマ目の項目）だけを、勝率 → 展示 → ST → モーターの順で2つまで
 *   - 直近1年は、レースの日を含む365日。ただし DB のデータは 2025-12-02 から（2026-11-04 の読み取り）なので、窓の頭の「その項目で比べたレースが0の日」が
 *     続く間はデータの前として外し、文は「{Y/M/D}以降」にする（2026-12-02 以降は自然に「直近1年」に戻る）。窓の中ほどに0の日があれば、データの欠けとして止める
 *   - 展示 ST は今は弱さの項目に入れない（METRIC_KEYS の外）。展示の F（start_flag）は 2026-09 からしかそろっていない
 *     （2026-04〜08 は F の行が月に 59〜416 件、2026-10 は 5,759 件。本番の exhibition_data の読み取り、2026-11-04）。F を正の値のまま比べると
 *     「一番遅い」が逆になり、直近1年の回数も合わない。そろった記録が1年たまったら（2027-09〜）METRIC_KEYS に戻す
 *   - 決まり手「恵まれ」のレースは選ばない（「恵まれて1着」が、弱い艇が運で勝ったという含みに読める。wording-editor 2026-11-04）
 *   - 題の「{弱さ}も最下位だった」は「{A}も{B}も6艇で最下位だった」（1つなら「{A}が6艇で最下位だった」）にした。「6艇で」が無いと選手の実力の
 *     最下位と読め、1つのときの「も」は並ぶ相手が無い（youtube-channel・wording-editor 2026-11-04）
 */

import {
  seriesDayTextOf,
  seriesTitleOf,
} from "../../../../src/utils/raceSeriesText.js";
import { isCancellationConfirmed } from "../../../../scripts/lib/cancellationStatus.js";

export const FORMAT = "upset_win_short";
export const SERIES = "【人気薄の1着】";
export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** 文字を置いてよい範囲（Shorts の下の帯 y1450〜と右のボタン列 x960〜を避ける。節の機力と同じ） */
export const SAFE = { right: 940, bottom: 1400 };
/** 字の最小（docs/knowledge/video-composition.md「字は最小36px相当」） */
export const MIN_FONT = 36;
export const CX = 540;
export const CENTER_MAX_W = 760;
/** 尺（仕様「25〜35秒」） */
export const DURATION = { min: 25, max: 35 };
/** 1コマ目は0〜3秒（仕様）。声が長ければ声に合わせて少し延ばす（上限 4 秒、越えたら止める） */
export const HOOK = { sec: 3, maxSec: 4 };
/** 声の後の間（目安・根拠なし） */
export const VOICE_TAIL_SEC = 0.6;
/** 単勝の下限（仕様「10倍以上」） */
export const ODDS_MIN = 10;
/** 直近1年の日数（レースの日を含む） */
export const YEAR_DAYS = 365;
export const BOATS = [1, 2, 3, 4, 5, 6];
export const CLASSES = ["A1", "A2", "B1", "B2"];
/** races.race_grade の高い順（PG1 は本番の値に無いが来たら SG の次） */
export const GRADE_RANK = { SG: 6, PG1: 5, G1: 4, G2: 3, G3: 2, ippan: 1 };
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const VOICE = {
  speaker: "青山龍星",
  speedScale: 1.1,
  credit: "VOICEVOX:青山龍星",
};
export const SITE = "https://www.boat-ai.jp";
/** 会場の読み（声だけ。字は会場名のまま） */
export const VENUE_READING = {
  桐生: "きりゅう",
  戸田: "とだ",
  江戸川: "えどがわ",
  平和島: "へいわじま",
  多摩川: "たまがわ",
  浜名湖: "はまなこ",
  蒲郡: "がまごおり",
  常滑: "とこなめ",
  津: "つ",
  三国: "みくに",
  びわこ: "びわこ",
  住之江: "すみのえ",
  尼崎: "あまがさき",
  鳴門: "なると",
  丸亀: "まるがめ",
  児島: "こじま",
  宮島: "みやじま",
  徳山: "とくやま",
  下関: "しものせき",
  若松: "わかまつ",
  芦屋: "あしや",
  福岡: "ふくおか",
  唐津: "からつ",
  大村: "おおむら",
};
export const VENUES = Object.keys(VENUE_READING);
/** 決まり手 → 3コマ目の言い方（見本「まくって1着」）。無い決まり手のレースは選ばない */
export const TECHNIQUE_VERB = {
  逃げ: "逃げて",
  まくり: "まくって",
  差し: "差して",
  まくり差し: "まくり差しで",
  抜き: "抜いて",
};

/**
 * 弱さの項目。worse(a, b) が正なら a の方が悪い。fmt は画面の字（表・照合）。
 * 並びは1コマ目・題の順（勝率 → 展示 → ST → モーター）
 */
export const METRICS = {
  win_rate: {
    label: "勝率",
    hook: "勝率",
    head: "勝率",
    cond: "勝率が6艇で一番低い艇の1着",
    tie: "（同じ勝率の最下位を含む）",
    say: "勝率",
    sayHook: "勝率",
    value: (b) => (b.win_rate > 0 ? b.win_rate : null),
    worse: (a, b) => b - a,
    fmt: (b) => (b.win_rate > 0 ? b.win_rate.toFixed(2) : "—"),
  },
  exhibition_time: {
    label: "展示タイム",
    hook: "展示",
    head: "展示",
    cond: "展示タイムが6艇で一番遅い艇の1着",
    tie: "（同じタイムの最下位を含む）",
    say: "展示タイム",
    sayHook: "展示",
    value: (b) => (b.exhibition_time > 0 ? b.exhibition_time : null),
    worse: (a, b) => a - b,
    fmt: (b) => (b.exhibition_time > 0 ? b.exhibition_time.toFixed(2) : "—"),
  },
  start_timing: {
    label: "展示ST",
    hook: "展示ST",
    head: "展示ST",
    cond: "展示STが6艇で一番遅い艇の1着",
    tie: "（同じSTの最下位を含む）",
    say: "展示エスティー",
    sayHook: "展示エスティー",
    // F は負の数、L（出遅れ）は一番遅い。どちらでもなく値が無ければ比べない
    value: (b) =>
      b.st_flag === "L"
        ? Number.POSITIVE_INFINITY
        : typeof b.start_timing === "number"
          ? b.st_flag === "F"
            ? -b.start_timing
            : b.start_timing
          : null,
    worse: (a, b) => (a === b ? 0 : a > b ? 1 : -1),
    fmt: (b) =>
      b.st_flag === "L"
        ? "L"
        : typeof b.start_timing === "number"
          ? `${b.st_flag === "F" ? "F" : ""}${b.start_timing.toFixed(2).replace(/^0/, "")}`
          : "—",
  },
  motor_2rate: {
    label: "モーター2連率",
    hook: "モーター2連率",
    // 表の見出しは2行（「モーター」だけだとモーター本体の優劣に読める。wording-editor 2026-11-04）
    head: "モーター\n2連率",
    cond: "モーター2連率が6艇で一番低い艇の1着",
    tie: "（同じ2連率の最下位を含む）",
    say: "モーター2連率",
    sayHook: "モーター2連率",
    value: (b) => (b.motor_2rate > 0 ? b.motor_2rate : null),
    worse: (a, b) => b - a,
    fmt: (b) => (b.motor_2rate > 0 ? b.motor_2rate.toFixed(1) : "—"),
  },
};
/** 弱さとして比べる項目（展示 ST は今は外す。冒頭の注記） */
export const METRIC_KEYS = ["win_rate", "exhibition_time", "motor_2rate"];
/** 3コマ目に出す「一番目立つ1つ」の順（その日の状態の項目を先に） */
export const PRIMARY_ORDER = ["exhibition_time", "motor_2rate", "win_rate"];
/** 表にいつも出す項目（仕様の表: 勝率・展示タイム） */
export const TABLE_FIXED = ["win_rate", "exhibition_time"];

// ---------- 日付 ----------

export const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const weekdayOf = (date) =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** "2026-11-03" → "11/3" */
export const md = (date) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
/** 直近1年の範囲（レースの日を含む365日） */
export const yearRange = (raceDate) => ({
  from: addDays(raceDate, -(YEAR_DAYS - 1)),
  to: raceDate,
});
export const jstDateOf = (d) =>
  new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);

// ---------- 選び ----------

/** 名前の空白（全角・半角）を詰める（出走表は「鈴木　　柊介」） */
export const racerName = (s) => String(s ?? "").replace(/[\s　]+/g, "");

const num = (v) =>
  v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
/** 読み取り（PostgREST）で取る列。作り手と送る口の読み直しで同じ列を読む */
export const READ_COLUMNS = {
  races:
    "race_id,race_date,venue_code,race_number,race_grade,cancellation_status,start_time",
  race_conditions: "race_id,series_day,is_final_day,race_title",
  race_results:
    "race_id,rank1,winning_technique,race_status",
  race_entries:
    "race_id,boat_number,player_name,grade,win_rate,motor_2rate,is_absent",
  exhibition_data:
    "race_id,boat_number,exhibition_time,start_timing,start_flag,is_absent",
  race_odds_final: "race_id,win_all",
};

/**
 * DB の行（1レース分）→ 選び・集計・bundle が使う形（純粋関数）。
 * 中止は races.cancellation_status が confirmed で1着が無いこと、不成立は race_status='no_race'（旧フラグ is_cancelled・is_no_race は書かれていないので読まない。verify-race-status-exclusion.js）、
 * 欠場は出走表か展示のどれかの is_absent。単勝は win_all の値（0 は「無い」）
 */
export function shapeRace({
  race,
  result,
  entries = [],
  exhibition = [],
  odds = null,
}) {
  const venue = VENUES[Number(race.venue_code) - 1] ?? null;
  const byBoat = (rows) => new Map(rows.map((r) => [Number(r.boat_number), r]));
  const en = byBoat(entries);
  const ex = byBoat(exhibition);
  const win = odds?.win_all ?? {};
  return {
    race_id: race.race_id,
    race_date: race.race_date,
    venue,
    venue_code: Number(race.venue_code),
    race_number: Number(race.race_number),
    grade: race.race_grade ?? null,
    start_time: deadlineOf(race.start_time),
    // 中止は「confirmed かつ1着が無い」（docs/knowledge/data-definitions.md。confirmed のまま結果のあるレースがある・tentative は中止でない）
    cancelled:
      isCancellationConfirmed(race.cancellation_status) &&
      result?.rank1 == null,
    no_race: result?.race_status === "no_race",
    absent: [...entries, ...exhibition].some((r) => r.is_absent === true),
    rank1: num(result?.rank1),
    technique: result?.winning_technique ?? null,
    boats: BOATS.filter((b) => en.has(b)).map((b) => {
      const e = en.get(b);
      const x = ex.get(b) ?? {};
      return {
        boat: b,
        racer: racerName(e.player_name),
        class: e.grade ?? null,
        win_rate: num(e.win_rate),
        motor_2rate: num(e.motor_2rate),
        exhibition_time: num(x.exhibition_time),
        start_timing: num(x.start_timing),
        st_flag:
          x.start_flag === "F" || x.start_flag === "L" ? x.start_flag : null,
        odds: num(win[String(b)]),
      };
    }),
  };
}

/** 1日の行の束 → レースの形の配列（race_id の順） */
export function shapeDay({
  races = [],
  results = [],
  entries = [],
  exhibition = [],
  odds = [],
  race_conditions = [],
}) {
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.race_id, [...(m.get(r.race_id) ?? []), r]);
    return m;
  };
  const res = new Map(results.map((r) => [r.race_id, r]));
  const od = new Map(odds.map((r) => [r.race_id, r]));
  const conditions = new Map(race_conditions.map((r) => [r.race_id, r]));
  const en = group(entries);
  const ex = group(exhibition);
  return [...races]
    .sort((a, b) => a.race_id.localeCompare(b.race_id))
    .map((race) => ({
      ...conditions.get(race.race_id),
      ...shapeRace({
        race,
        result: res.get(race.race_id) ?? null,
        entries: en.get(race.race_id) ?? [],
        exhibition: ex.get(race.race_id) ?? [],
        odds: od.get(race.race_id) ?? null,
      }),
    }));
}

/**
 * 比べてよいレースか（中止・不成立・欠場・結果の欠けを外す）。race は shapeRace の形
 */
export function raceUsable(race) {
  return Boolean(
    race &&
    !race.cancelled &&
    !race.no_race &&
    !race.absent &&
    BOATS.includes(race.rank1) &&
    Array.isArray(race.boats) &&
    race.boats.length === 6 &&
    BOATS.every((b, i) => race.boats[i]?.boat === b),
  );
}

/** そのレースのその項目で最下位の艇（同値を含む）。比べられなければ null */
export function lowestBoats(race, key) {
  const m = METRICS[key];
  const vals = race.boats.map((b) => m.value(b));
  if (vals.some((v) => v == null || Number.isNaN(v))) return null;
  let worst = vals[0];
  for (const v of vals) if (m.worse(v, worst) > 0) worst = v;
  const low = BOATS.filter((_, i) => m.worse(vals[i], worst) === 0);
  // 6艇とも同じ値なら「6艇で最下位」と言えないので比べない
  return low.length === BOATS.length ? null : low;
}

/** 1着の艇の弱さ（METRICS の並び） */
export function weaknessesOf(race) {
  return METRIC_KEYS.filter((k) => lowestBoats(race, k)?.includes(race.rank1));
}

/** 1着の艇の単勝（0・欠けは null） */
export const winnerOdds = (race) => {
  const v = race.boats[race.rank1 - 1]?.odds;
  return typeof v === "number" && v > 0 ? v : null;
};

/** 選べるレース（単勝10倍以上・弱さ1つ以上・決まり手あり）の候補。並びは選びの順 */
export function candidates(races) {
  return (races ?? [])
    .filter(raceUsable)
    .map((race) => ({
      race,
      odds: winnerOdds(race),
      weaknesses: weaknessesOf(race),
    }))
    .filter(
      (c) =>
        c.odds != null &&
        c.odds >= ODDS_MIN &&
        c.weaknesses.length > 0 &&
        TECHNIQUE_VERB[c.race.technique],
    )
    .sort(
      (a, b) =>
        b.odds - a.odds ||
        b.weaknesses.length - a.weaknesses.length ||
        (GRADE_RANK[b.race.grade] ?? 0) - (GRADE_RANK[a.race.grade] ?? 0) ||
        a.race.race_id.localeCompare(b.race.race_id),
    );
}

/** その日の1本（無ければ null） */
export const pickUpset = (races) =>
  candidates(races).find(({ race }) => deadlineOf(race.start_time)) ?? null;

export const primaryOf = (weaknesses) =>
  PRIMARY_ORDER.find((k) => weaknesses.includes(k)) ?? null;

/** 1コマ目・題に出す弱さ（表に列のあるものだけ、METRICS の並びで2つまで。3コマ目の項目は必ず入れる） */
export function hookMetrics(weaknesses, primary) {
  const shown = new Set([...TABLE_FIXED, primary]);
  const list = METRIC_KEYS.filter(
    (k) => weaknesses.includes(k) && shown.has(k),
  );
  if (list.length <= 2) return list;
  // 3つ（勝率・展示・3コマ目）は無い（3コマ目が展示でないのは展示が弱さでないとき）が、来たら3コマ目と、並びの最初の1つ
  const other = list.find((k) => k !== primary);
  return METRIC_KEYS.filter((k) => k === primary || k === other);
}

/** 表の項目（勝率・展示と、表に無い3コマ目の項目） */
export const tableMetrics = (primary) =>
  TABLE_FIXED.includes(primary) ? [...TABLE_FIXED] : [...TABLE_FIXED, primary];

// ---------- 直近1年の回数 ----------

/** 1日のレースの、項目ごとの [比べたレースの数, 最下位の艇が1着になった数] */
export function dayCounts(races) {
  const out = Object.fromEntries(METRIC_KEYS.map((k) => [k, [0, 0]]));
  for (const race of races ?? []) {
    if (!raceUsable(race)) continue;
    for (const k of METRIC_KEYS) {
      const low = lowestBoats(race, k);
      if (!low) continue;
      out[k][0] += 1;
      if (low.includes(race.rank1)) out[k][1] += 1;
    }
  }
  return out;
}

/** days（{ "YYYY-MM-DD": [n, k] }）を範囲で足す。範囲の日が1日でも欠けていれば null */
export function sumDays(days, { from, to }) {
  let n = 0;
  let k = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = days?.[d];
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      !v.every((x) => Number.isInteger(x) && x >= 0) ||
      v[1] > v[0]
    )
      return null;
    n += v[0];
    k += v[1];
  }
  return { n, k };
}

/** 窓の頭の「比べたレースが0の日」（データの前）を外した始まりの日。全部0なら null */
export function dataFrom(days, { from, to }) {
  for (let d = from; d <= to; d = addDays(d, 1))
    if (days?.[d]?.[0] > 0) return d;
  return null;
}

/**
 * 「およそ{x}回に1回」の x（N/k の四捨五入。100以上は10の位で四捨五入）。k=0・N<k は null（言えない）
 * 例: 51,369/5,339=9.62 → 10、51,720/2,724=18.99 → 19、1000/7=142.9 → 140
 */
export function oneIn(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k <= 0 || n < k)
    return null;
  const x = n / k;
  const r = Math.round(x);
  return r >= 100 ? Math.round(x / 10) * 10 : r;
}

// ---------- 文 ----------

export const comma = (n) => n.toLocaleString("en-US");
export const fmtOdds = (v) =>
  typeof v === "number" && v > 0 ? v.toFixed(1) : "—";
const deadlineOf = (value) =>
  typeof value === "string" &&
  /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(value)
    ? value.slice(0, 5)
    : null;
const raceText = (b) =>
  `${md(b.race_date)}（${weekdayOf(b.race_date)}）${b.venue}${b.race_number}R`;
export const headerText = (b) => {
  const day = seriesDayTextOf(
    [{ raceId: b.race_id, seriesDay: b.series_day, isFinalDay: b.is_final_day }],
    b.race_id,
  );
  return `${raceText(b)}${day ? ` ${day}` : ""} 締切${deadlineOf(b.start_time)}`;
};
const winnerOf = (b) => b.boats[b.rank1 - 1];
const whoText = (b) => {
  const w = winnerOf(b);
  return `${b.rank1}号艇 ${w.racer} ${w.class}`;
};

/** 画面の文（描画はこの値だけを描く。checkBundle が bundle の texts と照らす） */
export function screensOf(b) {
  const hook = b.hook_metrics.map((k) => METRICS[k].hook);
  const w = winnerOf(b);
  const p = METRICS[b.primary];
  const x = oneIn(b.year.n, b.year.k);
  return {
    header: headerText(b),
    hook: [
      ...(hook.length === 2 ? [`${hook[0]}も${hook[1]}も`] : [`${hook[0]}が`]),
      "6艇で最下位",
    ],
    hook_em: "それでも1着",
    hook_who: whoText(b),
    hook_odds: `単勝${fmtOdds(w.odds)}倍`,
    table_title: "レース前のデータ",
    table_head: [
      "艇",
      "選手",
      "級",
      ...b.table_metrics.map((k) => METRICS[k].head),
      "単勝",
    ],
    table_rows: b.boats.map((bt) => [
      String(bt.boat),
      bt.racer,
      bt.class,
      ...b.table_metrics.map((k) => METRICS[k].fmt(bt)),
      fmtOdds(bt.odds),
    ]),
    table_note: hasDash(b) ? "赤＝6艇で最下位　—＝記録なし" : "赤＝6艇で最下位",
    result_label: "結果",
    result: `${b.rank1}号艇が${TECHNIQUE_VERB[b.technique]}1着`,
    cond: p.cond,
    year_n: `${yearLabel(b)} ${comma(b.year.n)}レース中`,
    year_k: `${comma(b.year.k)}回`,
    one_in: x == null ? null : `およそ${x}回に1回`,
    tie: p.tie,
    footer: `${SERIES}ボートレース`,
    footer_last: `${SERIES}毎朝7時`,
  };
}

/** 表に「—」（値の無い所）があるか */
const hasDash = (b) =>
  b.boats.some(
    (bt) =>
      fmtOdds(bt.odds) === "—" ||
      b.table_metrics.some((k) => METRICS[k].fmt(bt) === "—"),
  );
const slashDate = (d) =>
  `${Number(d.slice(0, 4))}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 集計の範囲の名前: 窓の頭からデータがあれば「直近1年」、データの前を外したら「{Y/M/D}以降」 */
export const yearLabel = (b) =>
  b.year.from === b.year.window_from
    ? "直近1年"
    : `${slashDate(b.year.from)}以降`;
const sayYearLabel = (b) =>
  b.year.from === b.year.window_from
    ? "直近1年"
    : `${Number(b.year.from.slice(0, 4))}年${Number(b.year.from.slice(5, 7))}月${Number(b.year.from.slice(8, 10))}日以降`;

/** 表の赤（その項目で最下位の艇。同値を含む）: { 項目: [艇] } */
export const redCells = (b) =>
  Object.fromEntries(b.table_metrics.map((k) => [k, lowestBoats(b, k) ?? []]));

/** 声の文（選手名は声で読まない。全貌の f01 と同じ決まり。会場は読みに置き換える） */
export function voiceOf(b) {
  const s = screensOf(b);
  const reading = VENUE_READING[b.venue] ?? b.venue;
  // 1コマ目は3秒に収めるため、画面と同じ短い言い方で読む
  const hook = b.hook_metrics.map((k) => METRICS[k].sayHook);
  const w = winnerOf(b);
  return {
    hook: `${hook.length === 2 ? `${hook[0]}も${hook[1]}も` : `${hook[0]}が`}6艇で最下位。それでも1着。`,
    table: `${reading}${b.race_number}レース。${b.rank1}号艇は単勝${fmtOdds(w.odds)}倍。赤が、6艇で最下位のデータです。`,
    // 向きは画面の文（cond の「一番遅い」「一番低い」）とそろえる（wording-editor 2026-11-04）
    result: `結果は${b.rank1}号艇が${TECHNIQUE_VERB[b.technique]}1着。${METRICS[b.primary].cond}は、${sayYearLabel(b)}${b.year.n}レース中${b.year.k}回。${s.one_in}です。人気薄の1着、毎朝7時。`,
  };
}

/** 題（仕様「題」。配当の円は出さない） */
export function titleOf(b) {
  const w = winnerOf(b);
  const labels = b.hook_metrics.map((k) => METRICS[k].label);
  const weak =
    labels.length === 2 ? `${labels[0]}も${labels[1]}も` : `${labels[0]}が`;
  return `${raceText(b)} 締切${deadlineOf(b.start_time)} 単勝${fmtOdds(w.odds)}倍の${w.racer}${w.class}が1着 ${weak}6艇で最下位だった｜ボートレース`;
}

/** 説明欄のリンク（龍神ソナーのレースの頁。snsScreenMarkers の race-sonar） */
export const sonarUrl = (raceId) =>
  `${SITE}/race/${raceId}?tab=sonar&utm_source=youtube&utm_medium=shorts&utm_campaign=upset-win&utm_content=${raceId}`;

/** 説明欄（仕様「説明欄」: 1行目・集計の範囲と日付・龍神ソナーのレースの頁へのリンク） */
export function descriptionOf(b) {
  const w = winnerOf(b);
  const s = screensOf(b);
  const all = b.weaknesses.map((k) => METRICS[k].label).join("・");
  const p = METRICS[b.primary];
  const ymd = (d) => d.replaceAll("-", "/");
  return [
    `ボートレース ${s.header}の結果の振り返り`,
    ...[seriesTitleOf({ grade: b.grade, raceTitle: b.race_title })].filter(Boolean),
    "",
    `${b.rank1}号艇 ${w.racer} ${w.class} が単勝${fmtOdds(w.odds)}倍で1着（${b.technique}）。レース前のデータでは ${all} が6艇で最下位だった。`,
    `${p.cond}: ${yearLabel(b)}（${ymd(b.year.from)}〜${ymd(b.year.to)}）${comma(b.year.n)}レース中 ${comma(b.year.k)}回${p.tie}`,
    `集計: 龍神レーダーのデータ（${md(b.as_of_date)} 時点）。中止・不成立・欠場のあるレースと、6艇のどれかに値の無いレースは除く。単勝は最終オッズ`,
    "過去のレースの結果の振り返りで、これからのレースの結果を示すものではありません。",
    "",
    "このレースの類似レースは龍神ソナーで",
    sonarUrl(b.race_id),
    "",
    VOICE.credit,
    "#ボートレース #人気薄の1着",
  ].join("\n");
}

// ---------- 材料 → bundle ----------

/**
 * 材料（選んだレース・直近1年の日ごとの数）から bundle を作る（純粋関数）。声の秒（pages[].sec）は作り手が声を作った後に入れる
 * @param {{ race: object, days: Record<string, [number, number]>, date: string, asOf: string, sendTime?: string }} m
 */
export function buildBundle({
  race,
  days,
  date,
  asOf,
  sendTime = "07:15",
}) {
  const weaknesses = weaknessesOf(race);
  const primary = primaryOf(weaknesses);
  const range = yearRange(race.race_date);
  const sum = sumDays(days, range);
  if (!sum)
    throw new Error(
      `直近1年（${range.from}〜${range.to}）の日ごとの数がそろっていない`,
    );
  const yearDays = {};
  for (let d = range.from; d <= range.to; d = addDays(d, 1))
    yearDays[d] = days[d];
  const from = dataFrom(yearDays, range);
  if (!from)
    throw new Error(
      `直近1年（${range.from}〜${range.to}）に比べたレースが無い`,
    );
  const b = {
    format: FORMAT,
    version: 1,
    date,
    send_time: sendTime,
    race_id: race.race_id,
    race_date: race.race_date,
    venue: race.venue,
    venue_code: race.venue_code,
    race_number: race.race_number,
    grade: race.grade,
    start_time: deadlineOf(race.start_time),
    series_day: race.series_day ?? null,
    is_final_day: race.is_final_day ?? null,
    race_title: race.race_title ?? null,
    technique: race.technique,
    rank1: race.rank1,
    boats: race.boats.map((x) => ({ ...x })),
    weaknesses,
    primary,
    hook_metrics: hookMetrics(weaknesses, primary),
    table_metrics: tableMetrics(primary),
    year: {
      metric: primary,
      window_from: range.from,
      from,
      to: range.to,
      n: sum.n,
      k: sum.k,
      days: yearDays,
    },
    as_of: asOf,
    as_of_date: jstDateOf(new Date(asOf)),
    source_observed_at: asOf,
  };
  b.texts = screensOf(b);
  b.voice = voiceOf(b);
  b.youtube = { title: titleOf(b), description: descriptionOf(b) };
  return b;
}

// ---------- 時間の並び ----------

/** 章の秒（声の秒＋間。1コマ目は3秒、合計が25秒に満たなければ2・3コマ目を同じだけ延ばす） */
export function pageSeconds(voiceSec) {
  const hook = Math.max(HOOK.sec, voiceSec.hook + 0.3);
  let table = voiceSec.table + VOICE_TAIL_SEC + 4;
  let result = voiceSec.result + VOICE_TAIL_SEC + 1.5;
  const short = DURATION.min - (hook + table + result);
  if (short > 0) {
    table += short / 2;
    result += short / 2;
  }
  const r = (x) => Math.round(x * 100) / 100;
  return { hook: r(hook), table: r(table), result: r(result) };
}

export function timeline(b) {
  let from = 0;
  const chapters = ["hook", "table", "result"].map((id) => {
    const len = Math.round((b.pages?.[id]?.sec ?? 0) * FPS);
    const out = { id, from, len };
    from += len;
    return out;
  });
  return { chapters, total: from };
}

/** 各章の代表のコマ（静止画の一覧用）。章の動きが済んだ後 */
export const stillsOf = (b) =>
  timeline(b).chapters.map((c) => c.from + c.len - 10);

// ---------- 検査（P0: 事実の誤り・禁止語・数字の不一致）。理由の配列を返す（空なら通る） ----------

/** 仕様「守ること」の禁止語と、射幸心・誇大・次の予想の語（risk-rules.json の外。この型の決まり） */
export const TYPE_BANNED = [
  "必ず当たる",
  "稼げる",
  "万舟",
  "儲か",
  "高配当",
  "大穴",
  "穴党",
  "一攫千金",
  "爆益",
  "的中",
  "狙い",
  "買い目",
  "買え",
  "予想",
  "推奨",
  "次は",
  "次も",
  "鉄板",
  "激アツ",
  "勝てる",
  // 弱さと勝ちの因果を言わない（「データ上は最下位だった」まで）
  "だから",
  "なのに",
  "おかげ",
  "原因",
  "理由",
];
/** リポジトリの言い方の規則の禁止語（節の機力の model.js と同じ。AGENTS.md「言い方の規則」） */
export const REPO_BANNED = ["数え", "似た", "似て", "ふつう", "普通", "いつも"];
const norm = (t) =>
  String(t)
    .replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[ 　]/g, "");

/** 画面の文の一覧（語の検査・数の照合用） */
export function screenTextList(t) {
  return [
    t.header,
    ...t.hook,
    t.hook_em,
    t.hook_who,
    t.hook_odds,
    t.table_title,
    ...t.table_head,
    ...t.table_rows.flat(),
    t.table_note,
    t.result_label,
    t.result,
    t.cond,
    t.year_n,
    t.year_k,
    t.one_in,
    t.tie,
    t.footer,
    t.footer_last,
  ].filter((x) => typeof x === "string");
}

/** 画面に出てよい数（bundle の値から作れる数） */
function allowedNumbers(b) {
  const ok = new Set([
    "1",
    "6",
    "7",
    String(b.race_number),
    String(b.rank1),
    ...BOATS.map(String),
  ]);
  const add = (s) => {
    for (const n of norm(s).match(/\d+(?:\.\d+)?/g) ?? []) ok.add(n);
  };
  add(md(b.race_date));
  add(deadlineOf(b.start_time) ?? "");
  if (b.series_day != null) add(String(b.series_day));
  for (const bt of b.boats) {
    add(bt.class);
    for (const k of METRIC_KEYS) add(METRICS[k].fmt(bt));
    add(fmtOdds(bt.odds));
  }
  add(comma(b.year.n));
  add(comma(b.year.k));
  add(yearLabel(b));
  ok.add(String(oneIn(b.year.n, b.year.k)));
  return ok;
}

/** 文の幅の推定（全角1・半角0.62・空白0.3）。描画は DOM で測り直す */
const units = (s) =>
  [...s].reduce(
    (a, ch) => a + (ch === " " ? 0.3 : /[\x21-\x7e]/.test(ch) ? 0.62 : 1),
    0,
  );
export const fitSize = (text, maxW, max, min = MIN_FONT) => {
  const u = units(text);
  const size = u ? Math.min(max, Math.floor(maxW / u)) : max;
  return size >= min ? size : null;
};

/**
 * 表の列（x と幅）。艇 60〜130、選手、級、数の列（右寄せ）。右端は SAFE.right。
 * 名前の列の幅は、数の列の残り。名前・数が MIN_FONT で入らなければ size が null（checkBundle が止める）
 */
export const TABLE = {
  top: 370,
  rowH: 128,
  font: 44,
  headFont: 36,
  boatX: 60,
  boatW: 70,
  nameX: 140,
  gap: 10,
  gradeW: 58,
};
const NUM_W = {
  win_rate: 100,
  exhibition_time: 100,
  start_timing: 120,
  motor_2rate: 144,
  odds: 124,
};
export function tableLayout(b) {
  const nums = [...b.table_metrics, "odds"];
  let x = SAFE.right;
  const cols = [];
  for (const k of [...nums].reverse()) {
    const w = NUM_W[k];
    cols.unshift({ key: k, x: x - w, w });
    x -= w + TABLE.gap;
  }
  const gradeX = x - TABLE.gradeW;
  const nameW = gradeX - TABLE.gap - TABLE.nameX;
  return { cols, gradeX, nameW };
}

/** bundle の値の形（buildBundle の出力）と、型の決まり。理由の配列（空なら通る） */
export function checkBundle(b, { rules = [], matchRiskRules = null } = {}) {
  const why = [];
  if (!b || typeof b !== "object") return ["bundle が無い"];
  if (b.format !== FORMAT) why.push(`format が ${FORMAT} でない: ${b.format}`);
  for (const k of [
    "date",
    "race_date",
    "race_id",
    "venue",
    "as_of",
    "as_of_date",
    "technique",
  ])
    if (typeof b[k] !== "string" || !b[k]) why.push(`${k} が無い`);
  if (why.length) return why;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.race_date)
  )
    return ["date・race_date が YYYY-MM-DD でない"];
  if (!deadlineOf(b.start_time)) why.push("start_time が締切 HH:MM でない");
  if (b.race_date !== addDays(b.date, -1))
    why.push(`race_date（${b.race_date}）が date（${b.date}）の前日でない`);
  if (!VENUES.includes(b.venue))
    why.push(`venue が24場の名前でない: ${b.venue}`);
  const idOk = new RegExp(
    `^${b.race_date}-${String(b.venue_code).padStart(2, "0")}-${String(b.race_number).padStart(2, "0")}$`,
  ).test(b.race_id);
  if (!idOk) why.push(`race_id（${b.race_id}）が日・会場・R と合わない`);
  if (!(GRADE_RANK[b.grade] > 0)) why.push(`grade が知らない値: ${b.grade}`);
  if (!raceUsable({ ...b, cancelled: false, no_race: false, absent: false }))
    return [...why, "6艇・1着の形が違う"];
  b.boats.forEach((bt, i) => {
    if (typeof bt.racer !== "string" || !bt.racer || /[\s　]/.test(bt.racer))
      why.push(`${i + 1}号艇の名前が無いか空白がある`);
    if (!CLASSES.includes(bt.class))
      why.push(`${i + 1}号艇の級が A1・A2・B1・B2 でない: ${bt.class}`);
  });
  if (!TECHNIQUE_VERB[b.technique])
    why.push(`決まり手が知らない値: ${b.technique}`);
  if (why.length) return why;

  // 選びの照合: 単勝10倍以上・弱さ・3コマ目の項目・1コマ目の項目を値から作り直して照らす
  const odds = winnerOdds(b);
  if (odds == null || odds < ODDS_MIN)
    why.push(`1着の単勝が${ODDS_MIN}倍以上でない: ${odds}`);
  const weak = weaknessesOf(b);
  if (JSON.stringify(weak) !== JSON.stringify(b.weaknesses))
    why.push(`弱さが値と合わない: ${b.weaknesses} ≠ ${weak}`);
  if (!weak.length) why.push("1着の艇に6艇で最下位の項目が無い");
  const primary = primaryOf(weak);
  if (b.primary !== primary)
    why.push(`3コマ目の項目が決まりと合わない: ${b.primary} ≠ ${primary}`);
  if (
    JSON.stringify(b.hook_metrics) !==
    JSON.stringify(hookMetrics(weak, primary))
  )
    why.push("1コマ目の項目が決まりと合わない");
  if (JSON.stringify(b.table_metrics) !== JSON.stringify(tableMetrics(primary)))
    why.push("表の項目が決まりと合わない");
  if (why.length) return why;

  // 直近1年: 日ごとの数を足し直す（範囲・欠け・N と k）
  const range = yearRange(b.race_date);
  const from = dataFrom(b.year?.days, range);
  if (
    b.year?.metric !== primary ||
    b.year.window_from !== range.from ||
    b.year.from !== from ||
    b.year.to !== range.to
  )
    why.push(
      `直近1年の範囲・項目が違う（${b.year?.metric} ${b.year?.window_from}・${b.year?.from}〜${b.year?.to}、期待 ${primary} ${range.from}・${from}〜${range.to}）`,
    );
  const sum = sumDays(b.year?.days, range);
  if (!sum) why.push("直近1年の日ごとの数が欠けている");
  else if (sum.n !== b.year.n || sum.k !== b.year.k)
    why.push(
      `直近1年の数が日ごとの和と合わない（${b.year.n}・${b.year.k}、和 ${sum.n}・${sum.k}）`,
    );
  // データの始まりの後に、比べたレースが0の日があれば欠け（取得の失敗が黙って0になる）として止める
  if (sum && from)
    for (let d = from; d <= range.to; d = addDays(d, 1))
      if (b.year.days[d][0] === 0) {
        why.push(`${d} の比べたレースが0（データの欠け）`);
        break;
      }
  if (Object.keys(b.year?.days ?? {}).length !== YEAR_DAYS)
    why.push(`直近1年の日の数が ${YEAR_DAYS} でない`);
  if (oneIn(b.year?.n, b.year?.k) == null)
    why.push(`およそ何回に1回が作れない（${b.year?.n}・${b.year?.k}）`);
  if (why.length) return why;

  // 画面の文・声・題・説明欄が、値から作った文と同じか（差し込みの型の外の文を通さない）
  const t = screensOf(b);
  if (JSON.stringify(b.texts) !== JSON.stringify(t))
    why.push("画面の文（texts）が値から作った文と違う");
  if (JSON.stringify(b.voice) !== JSON.stringify(voiceOf(b)))
    why.push("声の文（voice）が値から作った文と違う");
  if (b.youtube?.title !== titleOf(b)) why.push("題が値から作った文と違う");
  if (b.youtube?.description !== descriptionOf(b))
    why.push("説明欄が値から作った文と違う");
  if (why.length) return why;

  // 画面の数が値に無いものを出していないか（二重の守り）
  const ok = allowedNumbers(b);
  for (const s of screenTextList(b.texts))
    for (const num of norm(s).match(/\d+(?:\.\d+)?/g) ?? [])
      if (!ok.has(num))
        why.push(`画面の文の数「${num}」が bundle の値に無い: ${s}`);
  // 配当の円を題と1コマ目に出さない（仕様）
  const hookTexts = [
    ...b.texts.hook,
    b.texts.hook_em,
    b.texts.hook_who,
    b.texts.hook_odds,
    b.texts.header,
  ];
  for (const s of [b.youtube.title, ...hookTexts])
    if (/円|配当|払戻/.test(s)) why.push(`題か1コマ目に配当・円がある: ${s}`);

  // 禁止語・射幸心・次の予想・因果（画面・声・題・説明欄）
  const all = [
    ...screenTextList(b.texts),
    ...Object.values(b.voice),
    b.youtube.title,
    b.youtube.description,
  ];
  for (const s0 of all) {
    const s = norm(s0);
    for (const w of [...TYPE_BANNED, ...REPO_BANNED])
      if (s.includes(w)) why.push(`禁止語「${w}」: ${s0.slice(0, 40)}`);
  }
  if (matchRiskRules) {
    const fields = [
      ...screenTextList(b.texts).map((text) => ({ text, field: "body" })),
      ...Object.values(b.voice).map((text) => ({ text, field: "body" })),
      { text: b.youtube.title, field: "body" },
      { text: b.youtube.description, field: "description" },
    ];
    for (const v of matchRiskRules(fields, "youtube", rules))
      why.push(`禁止表現（${v.id}）「${v.matchedPattern}」`);
  }

  // 尺（25〜35秒）と1コマ目（3〜4秒）
  for (const id of ["hook", "table", "result"])
    if (!(b.pages?.[id]?.sec > 0) || typeof b.pages[id].file !== "string")
      why.push(`声の ${id} が無い（pages.${id}）`);
  if (!why.length) {
    const total = b.pages.hook.sec + b.pages.table.sec + b.pages.result.sec;
    if (total < DURATION.min || total > DURATION.max)
      why.push(
        `尺が ${DURATION.min}〜${DURATION.max} 秒でない: ${total.toFixed(2)}`,
      );
    if (b.pages.hook.sec > HOOK.maxSec)
      why.push(`1コマ目が ${HOOK.maxSec} 秒を越える: ${b.pages.hook.sec}`);
  }

  // 字が最小の大きさで収まるか（推定。描画は DOM で測り直す）
  const { cols, nameW } = tableLayout(b);
  for (const row of t.table_rows) {
    if (fitSize(row[1], nameW, TABLE.font) == null)
      why.push(
        `表の名前が ${nameW}px に ${MIN_FONT}px で収まらない: ${row[1]}`,
      );
    row.slice(3).forEach((v, i) => {
      if (fitSize(v, cols[i].w, TABLE.font) == null)
        why.push(`表の数が ${cols[i].w}px に収まらない: ${v}`);
    });
  }
  t.table_head.slice(3).forEach((v, i) => {
    if (v.split("\n").some((line) => fitSize(line, cols[i].w, TABLE.headFont) == null))
      why.push(`表の見出しが ${cols[i].w}px に収まらない: ${v}`);
  });
  for (const s of [
    ...t.hook,
    t.hook_em,
    t.hook_who,
    t.result,
    t.cond,
    t.year_n,
    t.one_in,
    t.tie,
  ])
    if (fitSize(s, CENTER_MAX_W, MIN_FONT) == null)
      why.push(`文が ${CENTER_MAX_W}px に収まらない: ${s}`);
  return why;
}
