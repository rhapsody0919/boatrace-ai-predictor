#!/usr/bin/env node
/**
 * verify-motor-tab-readability.js — モータ情報タブ・選手ページのモーター状況の
 * 読みやすさの修正（BOA-513 の文言・不具合の分）を固定する。
 *
 * ## なぜ要るか
 *
 * BOA-329 / BOA-521 のファン評価（2026-09-28〜29）で、次の読み違いが指摘された。
 * どれも値は正しいのに、見せ方で誤読を生む。
 * - 375px で枠番別成績の表の3連率・展示タイム推移の列が切れ、横に動かせることも分からない
 * - 枠番別成績の見出しが「1着率」と「2連率 (%)」で (%) の有無が揃っていない
 * - 過去レースの出典注記が、表に無い「1着率」の列に触れる（戸田など）
 * - 2連率推移の縦軸が「出現率 (%)」で出目の用語に見え、グラフに見出しが無い
 * - 使用履歴のグラフが推移グラフと左右逆で、「右肩下がり＝最近悪化」と読める
 * - 使用履歴に集計期間が書かれていない
 * - 鮮度（◯走目）・1着率などの公式値は節の終わりにしか更新されず、機力指数の走数と合わない
 * - 選手ページの展示タイムのグラフで、同じ日に2回走ると横軸の日付が重複する
 *
 * ## 何を検査するか
 *
 * 画面はブラウザでしか動かないため、ソースと文言を検査する
 * （verify-motor-window-generation.js と同じ方式）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import {
  formatPowerIndex,
  formatRateOrCount,
  powerIndexTone,
} from "../../src/utils/smallSampleRate.js";
import { officialTallyState } from "../../src/utils/motorGeneration.js";
import {
  exhibitionTimeAxis,
  exhibitionSparklineY,
} from "../../src/utils/chartDomain.js";
import { competitionRank } from "../../src/utils/competitionRank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyMotorTabReadabilitySupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);

const say = console.log.bind(console);
const sayErr = console.error.bind(console);
const failures = [];
const check = (label, ok) => {
  say(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
// サービス層の [Cache ...] ・エラーの通知は出さない（結果は check で見る）
console.log = console.error = console.warn = () => {};

/**
 * 偽の supabase クライアント（メモリ上の表）。select（列を絞る。"*" は全列）・eq・gt・gte・lt・lte・like・in・
 * order・range・limit・maybeSingle と await を扱い、呼ばれた問い合わせを calls に残す。
 * 並びの決まらない行（order が無い・同値）は、実 DB のように安定しない順で返す（ページ境界の検査のため）。
 * 返す列は select で頼んだ列だけ（頼んでいない列を読む本体は、実 DB では値が無い）
 */
const fake = {
  tables: {},
  calls: [],
  reset(tables) {
    this.tables = tables;
    this.calls = [];
  },
  from(table) {
    const q = {
      table,
      select: "*",
      filters: [],
      orders: [],
      range: null,
      limit: null,
      single: false,
    };
    fake.calls.push(q);
    const matches = (row, [op, col, val]) => {
      const v = row[col];
      if (op === "eq") return v === val;
      if (op === "gt") return v > val;
      if (op === "gte") return v >= val;
      if (op === "lt") return v < val;
      if (op === "lte") return v <= val;
      if (op === "in") return val.includes(v);
      if (op === "like")
        return new RegExp(
          `^${val.replace(/%/g, ".*").replace(/_/g, ".")}$`,
        ).test(v);
      throw new Error(`偽のクライアントに無い絞り: ${op}`);
    };
    // 並びの決まらない行の順は問い合わせごとに変わる（実 DB は同じ並びを約束しない。ページ境界で欠落・重複が出る）
    const salt = fake.calls.length;
    const scramble = (row) =>
      [...JSON.stringify(row)].reduce(
        (h, c) => (h * 31 + c.charCodeAt(0) + salt) | 0,
        salt,
      );
    const project = (row) => {
      if (q.select.trim() === "*") return { ...row };
      const cols = q.select.split(",").map((c) => c.trim());
      return Object.fromEntries(
        cols.filter((c) => c in row).map((c) => [c, row[c]]),
      );
    };
    const run = () => {
      let rows = (fake.tables[table] ?? []).filter((row) =>
        q.filters.every((f) => matches(row, f)),
      );
      rows = [...rows].sort((a, b) => {
        for (const { col, asc } of q.orders) {
          if (a[col] !== b[col])
            return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
        }
        return scramble(a) - scramble(b);
      });
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit !== null) rows = rows.slice(0, q.limit);
      const out = rows.map(project);
      return Promise.resolve({
        data: q.single ? (out[0] ?? null) : out,
        error: null,
      });
    };
    const filter = (op) => (col, val) => (
      q.filters.push([op, col, val]),
      chain
    );
    const chain = {
      select: (cols) => ((q.select = cols), chain),
      eq: filter("eq"),
      gt: filter("gt"),
      gte: filter("gte"),
      lt: filter("lt"),
      lte: filter("lte"),
      like: filter("like"),
      in: filter("in"),
      order: (col, opts) => (
        q.orders.push({ col, asc: opts?.ascending !== false }),
        chain
      ),
      range: (a, b) => ((q.range = [a, b]), chain),
      limit: (n) => ((q.limit = n), chain),
      maybeSingle: () => ((q.single = true), chain),
      then: (res, rej) => run().then(res, rej),
    };
    return chain;
  },
};
globalThis[FAKE_KEY] = fake;
// サービス層のキャッシュは localStorage にも書く。Node には無いので、中身を見られる物を置く（メモリのキャッシュは clearCache で消す）
const store = {};
Object.defineProperties(store, {
  getItem: { value: (k) => (k in store ? store[k] : null) },
  setItem: { value: (k, v) => void (store[k] = String(v)) },
  removeItem: { value: (k) => void delete store[k] },
  key: { value: (i) => Object.keys(store)[i] ?? null },
  length: { get: () => Object.keys(store).length },
});
globalThis.localStorage = store;
// 時計を進められるようにする（キャッシュの期限・「今日」が変わる日をまたぐ振る舞いを見る）
const RealDate = Date;
let clockOffsetMs = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + clockOffsetMs);
    else super(...args);
  }
  static now() {
    return RealDate.now() + clockOffsetMs;
  }
};

const { getTodayJST } = await import("../../src/utils/dateUtils.js");
const { clearCache } = await import("../../src/services/core.js");
const { fetchMotorDailySeries } =
  await import("../../src/services/motorQueries.js");
const { getMotorUsageHistory } =
  await import("../../src/services/motorQueries2.js");
const { getRaceMotorBreakdown } =
  await import("../../src/services/motorQueries3.js");
const { getVenueMotorRanking } =
  await import("../../src/services/motorQueries4.js");
const { getMotorPartsHistory } =
  await import("../../src/services/motorQueries6.js");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const addDays = (ymd, n) =>
  new RealDate(new RealDate(`${ymd}T00:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const T = getTodayJST();
const day = (n) => addDays(T, n); // 今日から n 日後（負は前）
const V = 15;
const M = 24;
const rid = (n, no, venue = V) =>
  `${day(n)}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const race = (race_id) => ({
  race_id,
  race_date: race_id.slice(0, 10),
  venue_code: Number(race_id.slice(11, 13)),
});
// レースの艇（出走表）の行。列は本体が読む名前
const ent = (race_id, boat_number, racer_id, extra = {}) => ({
  race_id,
  boat_number,
  racer_id,
  player_name: `選手${racer_id}`,
  grade: "A1",
  motor_number: M,
  global_2rate: 50,
  motor_2rate: 40,
  motor_3rate: 60,
  ...extra,
});
// order に並べた艇番が 1着, 2着, ...（rank1〜rank6）
const resultOf = (race_id, order, extra = {}) => ({
  race_id,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [`rank${n}`, order[n - 1] ?? null]),
  ),
  race_status: null,
  ...extra,
});
const startRows = (venue, ...dates) =>
  dates.map((start_date) => ({ venue_code: venue, start_date }));
const run = async (tables, fn) => {
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  clockOffsetMs = 0;
  fake.reset(tables);
  return fn();
};
const seed = (key, data) =>
  localStorage.setItem(
    `boatai:${key}`,
    JSON.stringify({ data, timestamp: Date.now() }),
  );

const chart = read("src/components/analysis/MotorConditionChart.jsx");
const grid = read("src/components/analysis/MotorWakuStatsGrid.jsx");
const card = read("src/components/racer/RacerMotorStatusCard.jsx");
// 選手ページの今節のモーター（RA40 BOA-1673 で racerService.js から移した）
const racerMotor = read("src/services/motorQueries7.js");

check(
  "枠番別成績の表に、横スクロールの目印（hscroll-hint・›）を付ける",
  grid.includes("useHorizontalScrollHint(") &&
    grid.includes("hscroll-hint") &&
    grid.includes('className="table-scroll"'),
);
check(
  "枠番別成績の見出しは、セルに%が付くので (%) の付かない名前（legend2/legend3）を使う",
  grid.includes('t("analysis.motor.legend2")') &&
    grid.includes('t("analysis.motor.legend3")') &&
    !grid.includes('t("analysis.motor.rate2Header")'),
);
check(
  "使用履歴の2連率ラベルも (%) の付かない名前を使う（「2連率 (%) 66.7%」と二重にしない）",
  !/\{t\("analysis\.motor\.rate2Header"\)\} \{meet\.rate2/.test(chart),
);
check(
  "過去レースの出典注記は、表に出ている会場公式の列だけを挙げる（1着率の列が無ければ触れない）",
  /venueColsLabel = \[\s*showFirstPlaceRate && "analysis\.motor\.firstPlaceRateHeader"/.test(
    chart,
  ),
);
check(
  "2連率・3連率の推移グラフに見出しを付ける",
  chart.includes('t("analysis.motor.rateTrendHeading")'),
);
check(
  "使用履歴のグラフは左が古く右が新しい（推移グラフと同じ向き）",
  /usageHistoryChartData = \[\.\.\.usageHistory\]\s*\.reverse\(\)/.test(chart),
);
check(
  "公式サイトのスナップショット（鮮度・順位・1着率・優出・優勝）の更新が遅れる旨を注記する",
  chart.includes('t("analysis.motor.officialSnapshotNote")'),
);
check(
  "選手ページ: 同じ日に2回走った日は、横軸にレース番号を添える",
  racerMotor.includes("raceNo: Number(e.race_id.slice(-2))") &&
    // 2回走った日が1日でもあれば全部の点に付ける（BOA-557。付く点と付かない点が混ざらない）
    card.includes("runsOnDate.values()].some((n) => n > 1)"),
);
check(
  "選手ページ: 説明文の「）」と「、」の間に空白を入れない（1つのテンプレート文字列で組む）",
  /\}）、この選手がこのモーターで出走してからの展示タイム`/.test(card),
);

// ---- BOA-513 PR2: ファン4人のパネルで決めた表示（2026-09-29 ユーザー承認） ----
check(
  "formatRateOrCount: n<6 は「該当数/出走数」、6以上は %、出走なしは「-」",
  formatRateOrCount(66.66666, 3, 6) === "2/3" &&
    formatRateOrCount(100, 1, 6) === "1/1" &&
    formatRateOrCount(0, 5, 6) === "0/5" &&
    formatRateOrCount(50, 6, 6) === "50.0%" &&
    formatRateOrCount(null, 0, 6) === "-",
);
check(
  "枠番別成績・選手×枠成績の率を formatRateOrCount で出す（n<6 の率を % で出さない）",
  (grid.match(/formatRateOrCount\(/g) ?? []).length >= 3 &&
    (
      read("src/components/analysis/MotorRacerWakuDrillDown.jsx").match(
        /formatRateOrCount\(/g,
      ) ?? []
    ).length >= 3,
);
check(
  "展示タイムのスパークラインは3点未満なら出さない",
  grid.includes("trend.length < 3) return null"),
);
check(
  "優出数・優勝数は、会場の全モーターで値が無いとき列ごと畳む（見出し・セル・出典注記）",
  chart.includes("showFinalCount && (") &&
    chart.includes("showChampionshipCount && (") &&
    chart.includes('showFinalCount && "analysis.motor.finalCountHeader"') &&
    // 列が1つも無い会場（戸田など）では、列名の文ごと出さない（文が崩れない）
    /\{venueColsLabel &&\s*`\$\{t\(/.test(chart),
);
check(
  "結果の出た走が無い新モーター（sample_count === 0）に「初下ろし」を添える",
  chart.includes("row.sample_count === 0 && (") &&
    chart.includes('t("analysis.motor.firstUseBadge")') &&
    // 行の組み立ては src/pure/raceMotorBreakdown.js の recalcMotorRows に移した
    /sample_count: powerIndexes\[i\]\?\.sample_count/.test(
      read("src/pure/raceMotorBreakdown.js"),
    ),
);
check(
  "推移グラフは、入れ替え直後の 2連率・3連率とも 0 の先頭の点を描かない",
  /findIndex\(\s*\(row\) => row\.motor_2rate !== 0 \|\| row\.motor_3rate !== 0/.test(
    chart,
  ),
);
{
  // 偽の DB: 使用開始日は40日前。a2 に部品交換、c にプロペラ交換が記録される（同じ日の2レースは a・a2）
  const G = day(-40);
  const ID = {
    g0: rid(-40, 1),
    a: rid(-20, 1),
    a2: rid(-20, 5),
    b: rid(-5, 1),
    c: rid(-3, 1),
  };
  const tables = () => ({
    venue_motor_start_dates: startRows(V, G),
    races: Object.values(ID).map(race),
    race_entries: [
      ent(ID.g0, 1, 11),
      ent(ID.a, 2, 12),
      ent(ID.a2, 4, 12),
      ent(ID.b, 3, 13),
      ent(ID.c, 5, 13),
    ],
    exhibition_data: [
      {
        race_id: ID.g0,
        boat_number: 1,
        exhibition_time: 6.8,
        propeller_change: false,
        parts_changed: null,
      },
      {
        race_id: ID.a,
        boat_number: 2,
        exhibition_time: 6.7,
        propeller_change: false,
        parts_changed: null,
      },
      {
        race_id: ID.a2,
        boat_number: 4,
        exhibition_time: 6.65,
        propeller_change: false,
        parts_changed: ["ピストン"],
      },
      {
        race_id: ID.b,
        boat_number: 3,
        exhibition_time: 6.6,
        propeller_change: false,
        parts_changed: null,
      },
      {
        race_id: ID.c,
        boat_number: 5,
        exhibition_time: null,
        propeller_change: true,
        parts_changed: null,
      },
    ],
  });
  const { series } = await run(tables(), async () => {
    // 交換のレース番号が無かった頃（v2）のキャッシュ。読むとレース番号が出ない
    seed(`motor-daily-series-v2-${V}-${M}-90`, {
      window: null,
      series: [{ date: G, eventRaceNos: undefined }],
    });
    return fetchMotorDailySeries(V, M, 90);
  });
  const parts = await run(tables(), async () => {
    seed(`motor-parts-history-v2-${V}-${M}-90`, {
      events: [{ date: day(-20) }],
    });
    return getMotorPartsHistory(V, M, 90);
  });
  check(
    "部品交換に、交換が記録されたレース番号を添える（日次系列の eventRaceNos・部品交換の raceNos。同じ日は1日に畳み、交換の無い日は空。旧版のキャッシュを読まない）",
    series.length === 4 &&
      same(
        series.map((d) => d.eventRaceNos),
        [[], [5], [], [1]],
      ) &&
      parts.events.length === 2 &&
      same(
        parts.events.map((e) => [e.date, e.raceNos]),
        [
          [day(-20), [5]],
          [day(-3), [1]],
        ],
      ),
  );
  check(
    "部品交換: チャートが raceNos を「◯R」に整形する（画面）",
    chart.includes("event.raceNos.map((n) => `${n}R`)"),
  );
}
// ---- BOA-513 PR2 ファン評価1周目（2026-09-29） ----
// 公式 0/0 が「集計前」か「集計済みの 0%」かは、会場公式の出走数で分ける
// （丸亀24号機は 9/21 に2走とも6着＝集計済みの 0%。2026-09-29 ファン評価 P1）
check(
  "officialTallyState: 会場公式の出走数が1以上なら集計済み、値のある会場で0/無しなら集計前、値の無い会場は不明",
  officialTallyState(true, 2) === "tallied" &&
    officialTallyState(false, 2) === "tallied" &&
    officialTallyState(true, 0) === "pending" &&
    officialTallyState(true, null) === "pending" &&
    officialTallyState(false, null) === "unknown",
);
check(
  "推移グラフ: 全部の点が 0 のとき、集計前なら線を引かず、集計済みなら 0 の線を引き、不明なら断定しない",
  /firstRatedIndex === -1\s*\?\s*drillTallyState === "tallied"/.test(chart) &&
    chart.includes('t("analysis.motor.trendNotYetOfficial")') &&
    chart.includes('t("analysis.motor.trendOfficialZeroUnknown")'),
);
check(
  "推移グラフ: 先頭の 0 を落としたときは、展示タイムと始まりがずれる理由を書く",
  chart.includes("firstRatedIndex > 0 && (") &&
    chart.includes('t("analysis.motor.trendStartNote")'),
);
check(
  "使用履歴: 今日これから走るレースは「未」と出し、欠場等の「-」と区別する",
  /r\.date >= getTodayJST\(\)\s*\?\s*t\("analysis\.motor\.usageHistoryNotRun"\)/.test(
    chart,
  ),
);
check(
  "選手×枠成績: n<6 では (n=◯) を付けない（分数に走数が入る）",
  /\{!isSmallSample && \(\s*<span className="motor-waku-n">/.test(
    read("src/components/analysis/MotorRacerWakuDrillDown.jsx"),
  ),
);
// 公式の 0.0 の「集計前」の印は、BOA-830（公式が 0 の艇は自前の値）に置き換えた。
// 新しい決まりは verify-motor-fresh-rate.js が守る
check(
  "一覧: 「集計前」の印と注記を出さない（BOA-830 で、公式が 0 の艇は自前の値に置き換えた）",
  !chart.includes("isOfficialPending") &&
    !chart.includes('t("analysis.motor.officialPendingBadge")') &&
    !chart.includes('t("analysis.motor.officialPendingNote")'),
);
// ---- BOA-549: 走数が少ない機力指数（2026-09-29 ファン4人のパネル） ----
check(
  "powerIndexTone: n<6 は評価せず small、6以上は符号で good/bad/even、値なしは null",
  powerIndexTone(-3.1, 4, 6) === "small" &&
    powerIndexTone(9.5, 5, 6) === "small" &&
    powerIndexTone(9.5, 6, 6) === "good" &&
    powerIndexTone(-0.9, 20, 6) === "bad" &&
    powerIndexTone(0, 20, 6) === "even" &&
    // 丸めて 0.0 になる値は良い・悪いと言わない（丸亀45号機 -0.04 が「低調」と出ていた）
    powerIndexTone(-0.04, 13, 6) === "even" &&
    powerIndexTone(0.04, 13, 6) === "even" &&
    powerIndexTone(0.05, 13, 6) === "good" &&
    powerIndexTone(null, 4, 6) === null,
);
check(
  "機力指数: 一覧・ドリルダウン・選手ページの3か所で powerIndexTone を使い、小標本では評価の言葉を出さない",
  (chart.match(/powerIndexTone\(/g) ?? []).length >= 2 &&
    chart.includes('t("analysis.motor.powerIndexSmallSample")') &&
    card.includes("powerIndexTone(") &&
    card.includes('tone === "small"'),
);
check(
  "グラフ: 縦軸のラベルを縦方向の中央に置き（375px で切れない）、展示タイムの目盛りは小数2桁にそろえる",
  read("src/components/analysis/TrendLineChart.jsx").includes(
    'style: { textAnchor: "middle" }',
  ) && /exhibitionYAxis"\)\}\s*yTickDecimals=\{2\}/.test(chart),
);
{
  // 使用履歴の節ごとの2連率も、着順の付かなかった走を分母に数える（機力指数・枠番別と
  // そろえる。BOA-549、戸田14号機で 4/6 と 22/38 が食い違っていた）
  const G = day(-40);
  const g0 = rid(-40, 1); // 艇1が1着
  const g1 = rid(-39, 2); // 艇3が着順なし（失格等）。結果は成立している
  const g1b = rid(-39, 3); // 不成立（no_race）。艇6は着順なし
  const g2 = rid(-38, 1); // 結果がまだ無い（未確定）
  const g3 = rid(-38, 2); // 艇4が1着
  const tables = {
    venue_motor_start_dates: startRows(V, G),
    races: [g0, g1, g1b, g2, g3].map(race),
    race_entries: [
      ent(g0, 1, 11),
      ent(g1, 3, 11),
      ent(g1b, 6, 11),
      ent(g2, 2, 11),
      ent(g3, 4, 11),
    ],
    race_results: [
      resultOf(g0, [1, 2, 3, 4, 5, 6]),
      resultOf(g1, [4, 2, 1, 5, 6]),
      resultOf(g1b, [1, 2, 3, 4, 5], { race_status: "no_race" }),
      resultOf(g3, [4, 1, 2, 3, 5, 6]),
    ],
  };
  const usage = await run(tables, async () => {
    // 着順の付かない走を分母に数えなかった頃（v3）のキャッシュ。読むと節の走数が1になる
    seed(`motor-usage-history-v3-${V}-${M}`, [{ racerId: 11, sampleCount: 1 }]);
    return getMotorUsageHistory(V, M);
  });
  const [meet] = usage;
  check(
    "使用履歴: 着順の付かなかった走も、結果の出たレースなら分母に数える（不成立・結果なしは数えない。旧版のキャッシュを読まない）",
    usage.length === 1 &&
      same(
        meet.races.map((r) => r.rank),
        [1, null, null, null, 1],
      ) &&
      meet.sampleCount === 3 &&
      near(meet.rate2, 200 / 3) &&
      near(meet.rate3, 200 / 3),
  );
}
check(
  "formatPowerIndex: 丸めて0になる負の値を「-0.0」と出さない（丸亀45号機 -0.04 → 0.0）",
  formatPowerIndex(-0.04) === "0.0" &&
    formatPowerIndex(12.14) === "+12.1" &&
    formatPowerIndex(-4.1) === "-4.1" &&
    formatPowerIndex(0) === "0.0" &&
    !/power_index > 0 \? "\+" : ""/.test(chart + card),
);
check(
  "一覧: オレンジ色の機力指数がある行があるときは、表の下の注記で意味（6走未満の参考値）を書く",
  chart.includes('t("analysis.motor.powerIndexSmallSampleNote"'),
);
check(
  "1基の詳細: 会場公式の成績が取れなかったとき（fetchFailed）は、推移グラフを「集計前」と判定しない（BOA-740）",
  /officialTallyState\(\s*venueHasOfficialStats && !venueMotorStats\?\.fetchFailed,\s*venueMotorStats\?\.raceCount,?\s*\)/.test(
    chart,
  ),
);
check(
  "選手ページ: 参考値の文言をレースページと同じ「— 走数が少ないため参考値」にそろえる",
  card.includes('" — 走数が少ないため参考値"'),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  // 「入れ替え後の最初の節」ではなくモーター単位で言う。丸亀は入れ替え後の最初の節が
  // 終わった後も、その後に初めて使われたモーターが集計前になる（ファン評価2周目 P2）
  check(
    `${lang}: 集計前の説明を「入れ替え後の最初の節」でなく、モーターが初めて使われた節で言う`,
    !/入れ替え後の最初の節|first meet since the changeover|更換後第一節|교체 후 첫 절/.test(
      motor.trendNotYetOfficial + motor.trendOfficialZeroUnknown,
    ),
  );
  check(
    `${lang}: 縦軸の名前が「出現率」でない（2連率・3連率を指す）`,
    !/出現率|Occurrence|出現率|출현율/.test(motor.yAxis),
  );
  check(
    `${lang}: 出典注記が {{venueCols}} を受け取り、見出し・区切り・更新遅れの注記・使用履歴の期間がある`,
    !motor.officialModeSourceNote.includes("{{venueCols}}") &&
      motor.venueColsPastNote?.includes("{{venueCols}}") &&
      motor.venueColsTodayNote?.includes("{{venueCols}}") &&
      typeof motor.rateTrendHeading === "string" &&
      motor.quotedLabel?.includes("{{label}}") &&
      typeof motor.quotedLabelSeparator === "string" &&
      typeof motor.officialSnapshotNote === "string" &&
      /90/.test(motor.usageHistoryNote) &&
      // 使用履歴の「-」（着順の付かない走）と「未」の意味・数え方を書く（BOA-549）
      /「-」|"-"/.test(motor.usageHistoryNote) &&
      // 枠番別成績の展示タイムの列が、平均の値と推移の図だと分かる見出し（BOA-549）
      /平均|avg|平均|평균/i.test(motor.exhibitionTrendHeader),
  );
}

// ---- BOA-557（BOA-549 ファン評価の残り） ----
{
  const chart = read("src/components/analysis/MotorConditionChart.jsx");
  const racerCard = read("src/components/racer/RacerMotorStatusCard.jsx");
  const trendChart = read("src/components/analysis/TrendLineChart.jsx");
  // 当日のレースも「このレースの直前まで」。終了後に開くとそのレース自身の結果が入り、
  // 翌日（過去レース扱い）に開いたときと数字が変わっていた
  check(
    "ドリルダウンは当日のレースも「このレースの直前まで」で集計する",
    /const beforeRaceId = selectedRace \?\? null;/.test(chart),
  );
  check(
    "一覧の機力指数も当日のレースは「このレースの直前まで」（同日の後のレース・このレース自身を入れず、公式の2連率・3連率を直前までの値に差し替える）",
    await (async () => {
      const tt = rid(0, 3); // 表示する当日のレース
      const before = rid(0, 2); // 同日の前のレース（入る）
      const after = rid(0, 5); // 同日の後のレース（入れない）
      const past = rid(-5, 1);
      const tables = {
        venue_motor_start_dates: startRows(V, day(-400)),
        races: [past, before, tt, after].map(race),
        race_entries: [
          ent(past, 3, 13, { global_2rate: 40 }),
          ent(before, 1, 11, { global_2rate: 50 }),
          ent(tt, 1, 11, {
            motor_2rate: 41.2,
            motor_3rate: 61.5,
            global_2rate: 50,
          }),
          ent(after, 1, 11, { global_2rate: 50 }),
        ],
        race_results: [
          resultOf(past, [1, 2, 3, 4, 5, 6]), // 艇3が3着: 2着以内でない
          resultOf(before, [1, 2, 3, 4, 5, 6]), // 艇1が1着
          resultOf(after, [1, 2, 3, 4, 5, 6]),
          resultOf(tt, [1, 2, 3, 4, 5, 6]),
        ],
        venue_motor_stats: [],
        motor_pretest_stats: [],
      };
      const got = await run(tables, () => getRaceMotorBreakdown(tt, V, 90));
      const [row] = got.rows;
      return (
        got.rows.length === 1 &&
        row.rate_source === "recalc" &&
        row.sample_count === 2 &&
        near(row.power_index, 5) &&
        near(row.motor_2rate, 50) &&
        near(row.motor_3rate, 100) &&
        row.official_2rate === 41.2
      );
    })(),
  );
  // 展示タイムは速い（小さい）ほど上。枠番別成績の小さな線が逆（遅いほど上）で、
  // 下の推移グラフを「上ほど速い」にしたとき同じタブで向きが食い違った（PR #1193 ファン評価1周目）
  check(
    "展示タイムの小さな推移線は速いほど上（最小が上端 y=0、最大が下端 y=height）",
    exhibitionSparklineY(6.7, 6.7, 6.9, 24) === 0 &&
      exhibitionSparklineY(6.9, 6.7, 6.9, 24) === 24 &&
      exhibitionSparklineY(6.8, 6.8, 6.8, 24) === 0 &&
      grid.includes("exhibitionSparklineY(t, min, max, height)"),
  );
  check(
    "モータ情報の展示タイムの推移は縦軸を反転し（速いほど上）、渡した目盛りを全部出す",
    /dataKey: "exhibition_time"/.test(chart) &&
      /yTicks=\{exhibitionAxis\?\.ticks\}[\s\S]{0,300}yReversed/.test(chart) &&
      read("src/components/analysis/TrendLineChart.jsx").includes(
        "interval={yTicks ? 0 : undefined}",
      ) &&
      read("src/components/analysis/TrendLineChart.jsx").includes(
        "reversed={yReversed}",
      ),
  );
  // 展示タイムの縦軸の端は0.2秒の倍数（6.43 / 6.63 … や上端だけ7.10にしない）
  // 範囲だけ渡すと recharts が5本に等分し、幅0.6秒で 6.80/6.95/7.10… になった（ファン評価）
  const axisA = exhibitionTimeAxis([6.86, 7.31]);
  const axisB = exhibitionTimeAxis([6.53, 7.04, null]);
  check(
    "展示タイムの縦軸は端も目盛りも0.2秒刻み（幅0.6秒でも0.15刻みにしない）",
    JSON.stringify(axisA) ===
      JSON.stringify({ domain: [6.8, 7.4], ticks: [6.8, 7, 7.2, 7.4] }) &&
      JSON.stringify(axisB.ticks) === JSON.stringify([6.4, 6.6, 6.8, 7, 7.2]) &&
      exhibitionTimeAxis([null]) === null,
  );
  check(
    "展示タイムのグラフ（モータ情報・選手ページ）が0.2秒刻みの範囲と目盛りを使い、直線でつなぐ",
    [chart, racerCard].every(
      (src) =>
        src.includes("yAxisDomain={exhibitionAxis?.domain}") &&
        src.includes("yTicks={exhibitionAxis?.ticks}") &&
        /dataKey: "exhibition_time",[\s\S]{0,200}type: "linear"/.test(src),
    ) &&
      !/dataMin - 0\.1/.test(chart + racerCard) &&
      /ticks=\{yTicks\}/.test(trendChart),
  );
  check(
    "選手ページの展示タイムも、375pxでラベルを間引かない",
    /yTicks=\{exhibitionAxis\?\.ticks\}\s*\/\/[^\n]*\n\s*slantXLabels/.test(
      racerCard,
    ),
  );
  check(
    "「このレースの直前まで」の注記を当日のレースのドリルダウンにも出す",
    /\{selectedRace && \(\s*<p className="table-note">\s*\{t\("analysis\.motor\.drillAsOfRaceNote"\)\}/.test(
      chart,
    ),
  );
  check(
    "使用履歴のグラフは選手名を間引かず、直線でつなぐ",
    /slantXLabels\b/.test(chart) &&
      /interval: 0/.test(trendChart) &&
      !/dataKey: "rate[23]",[\s\S]{0,160}type: "monotone"/.test(
        chart.slice(chart.indexOf("usageHistoryChartData}")),
      ),
  );
  check(
    "選手ページの展示タイムの横軸は、レース番号を全部の点に付けるか全部付けない",
    /hasDoubleRunDay && row\.raceNo/.test(racerCard),
  );
  check(
    "使用履歴のグラフの向きの説明は、グラフが出ているときだけ",
    /usageHistoryChartData\.length > 1 &&\s*` \$\{t\("analysis\.motor\.usageHistoryChartNote"\)\}`/.test(
      chart,
    ),
  );
  // 初出走（直前までの走りが0）の空表示は、取得失敗と区別できる文言にする
  check(
    "初出走のドリルダウンは「データが見つかりません」でなく理由を出す（3か所）",
    /drillFirstRun =\s*powerIndex\?\.sample_count === 0 && usageHistory\.length === 0/.test(
      chart,
    ) &&
      (chart.match(/t\(emptyKey\("analysis\.motor\.[a-zA-Z]+Empty"\)\)/g) ?? [])
        .length === 3,
  );
  // ダークモードでツールチップの見出しが白地に白字にならない
  check(
    "推移グラフのツールチップはテーマの色（背景・文字）を使う",
    /contentStyle=\{\{[\s\S]{0,120}background: "var\(--surface-card\)"/.test(
      trendChart,
    ) && /labelStyle=\{\{ color: "var\(--text-primary\)" \}\}/.test(trendChart),
  );
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 公式値の更新遅れの注記が、当サイトの集計を「最新のレースまで」と言わない`,
      !/最新のレースまで|latest race|至最新比賽|최신 레이스까지/.test(
        motor.officialSnapshotNote,
      ),
    );
    check(
      `${lang}: 使用履歴の注記からグラフの向きの文を分け、別キーにある`,
      typeof motor.usageHistoryChartNote === "string" &&
        !motor.usageHistoryNote.includes(motor.usageHistoryChartNote),
    );
  }
}

// ---- BOA-529: 会場内順位の同値は同じ順位 ----
{
  // 丸亀 2026-09-28 のスナップショット: 11号機の2連率44.4は5基が同値、上に10基
  const values = [
    60, 58, 55, 52, 50, 49, 48, 47, 46, 45, 44.4, 44.4, 44.4, 44.4, 44.4, 40,
  ];
  check(
    "competitionRank: 同値5基・上に10基なら11位で5基タイ（行順に依存しない）",
    JSON.stringify(competitionRank(values, 44.4)) ===
      JSON.stringify({ rank: 11, tied: 5 }) &&
      JSON.stringify(competitionRank([...values].reverse(), 44.4)) ===
        JSON.stringify({ rank: 11, tied: 5 }),
  );
  check(
    "competitionRank: 同値の次は飛ばす（1, 2, 2, 4）",
    competitionRank([9, 8, 8, 7], 7).rank === 4 &&
      competitionRank([9, 8, 8, 7], 8).rank === 2,
  );
  check(
    "competitionRank: 小さいほど良い指標（事故率）は昇順",
    competitionRank([0.1, 0.2, 0.2, 0.5], 0.5, { ascending: true }).rank === 4,
  );
  const chart = read("src/components/analysis/MotorConditionChart.jsx");
  {
    // 会場内順位は competitionRank で出す: 同じ値は同じ順位（1, 2, 2, 4）・値なしと出走数 0 は母数に入れない
    const row = (motor_number, top2_rate, race_count = 10) => ({
      venue_code: V,
      motor_number,
      scraped_date: day(-10),
      top2_rate,
      win_rate: top2_rate,
      top3_rate: top2_rate,
      accident_rate: 0.1,
      final_count: 0,
      championship_count: 0,
      race_count,
      stats_period_end: null,
    });
    const tables = {
      venue_motor_stats: [
        row(24, 50),
        row(25, 60),
        row(26, 50),
        row(27, null),
        row(28, 99, 0),
        row(29, 40),
      ],
    };
    const own = await run(tables, async () => {
      // 同じ値の順位を付ける前（v1）の形・出走数 0 を外す前（v2）のキャッシュ。読むと順位がずれる
      seed(`venue-motor-ranking-v2-${V}-24-top2Rate`, { rank: 3, total: 5 });
      return getVenueMotorRanking(V, 24, "top2Rate");
    });
    const last = await getVenueMotorRanking(V, 29, "top2Rate");
    const none = await getVenueMotorRanking(V, 27, "top2Rate");
    check(
      "会場内順位は同値を同順位にし（50が2基なら両方2位・tied 2。並べた位置の順位ではない）、次は飛ばす（4位）。値なし・出走数 0 は順位を出さず母数に入れない",
      same(own, {
        rank: 2,
        tied: 2,
        total: 4,
        metric: "top2Rate",
        value: 50,
        scrapedDate: day(-10),
      }) &&
        last.rank === 4 &&
        last.tied === 1 &&
        none === null,
    );
    check(
      "会場内順位: 画面は同順位なら「◯位タイ」の文言、値・切り捨ての注記を出す",
      /venueMotorRanking\.tied > 1\s*\?\s*"analysis\.motor\.venueRankBadgeTied"/.test(
        chart,
      ) &&
        /value: Number\(venueMotorRanking\.value\)\.toFixed\(1\)/.test(chart) &&
        /venueMotorRanking &&\s*` \$\{t\("analysis\.motor\.venueRankRoundingNote"\)\}`/.test(
          chart,
        ),
    );
  }
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 会場内順位の値が一覧と0.1違いうる理由（会場公式は切り捨て）の注記がある`,
      /0\.1/.test(motor.venueRankRoundingNote ?? ""),
    );
    check(
      `${lang}: 会場内順位の見出しに基準（2連率）が書いてある`,
      /2連率|top-2|2연대율/.test(motor.venueRankLabel),
    );
    check(
      `${lang}: 同順位の会場内順位の文言がある`,
      /\{\{rank\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        /\{\{total\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        // 何の値の順位かを数字で示す（当日は一覧に2連率が2列ある。ファン評価2周目）
        [motor.venueRankBadge, motor.venueRankBadgeTied].every((s) =>
          s.includes("{{value}}"),
        ),
    );
  }
}

if (failures.length > 0) {
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
