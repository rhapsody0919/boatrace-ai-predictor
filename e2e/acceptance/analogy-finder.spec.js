import { test, expect } from "../fixtures.js";

// アナロジー・ファインダー（BOA-271、モック Version 16 準拠）の受け入れE2E。
// docs/design/analogy-finder/spec.md と screens.md だけから書いた（plan/tasks/src は読んでいない）。
// spec の Q1〜Q7 は 2026-10-04 にユーザーが推奨の案で決定済み（spec「決定事項」）。その内容で書いている。
//
// ■ 開くレース
//   spec の例のレース 2026-09-27 若松12R（6艇ともA1、G1優勝戦）。
//   spec・screens に raceId の形式もレースまでの導線も書かれていないため、固定値を環境変数で渡す。
//     ANALOGY_RACE_ID=<若松12R の raceId> npx playwright test --config=playwright.acceptance.config.js e2e/acceptance/analogy-finder.spec.js
//   画面は /race/:raceId の「AI予想」タブ（screens「画面の構造と操作要素」URL行）。
//   Q1（級別が混ざったレース）・Q7（優勝戦でない日）を確かめるテストは、同じレースを開いたまま
//   facts・scenario の応答だけを「級別が混ざった予選のレース」に差し替えている（mixed: true）。
//   画面が数えるレースの名前・今日のラウンドを facts 以外（ページのレース情報）から作る実装だと、
//   このテストは仕様と関係なく赤になる。その場合は、級別が混ざった予選のレースの raceId を別に渡す形に書き直す。
//
// ■ API はすべて page.route でモックする（screens「データ取得」の3本）。
//   実装前で応答の形が決まっていないため、下の形を仮定した。数字の検証はこの形を前提にしている。
//   実装の形が違う場合は、build* 関数（応答の組み立て）だけを合わせ、検証（expect）は変えないこと。
//
//   GET /api/analogy/facts/{raceId}?stage=before|after
//   {
//     status: "ok" | "scratched" | "not_saved",
//                       // scratched = 出走表の後に欠場が分かった（節を1行に）
//                       // not_saved = 保存が無いレース（節を1行に）
//     afterStatus: "ready" | "no_exhibition" | "reflecting" | "closed",
//                       // ready = 展示後の段が保存済み（「展示後」を押せる）
//                       // no_exhibition = 展示データがまだ無い（「展示の後に選べる」）
//                       // reflecting = 展示データは入ったが展示後の段が未保存（「展示の結果を反映しています」）
//                       // closed = 締切を過ぎても展示後の段が無い（1行を出さない）
//     stage: "before"|"after",
//     race: { venue, raceNumber, date, grade, round, classSummary },   // round で優勝戦・準優勝戦の日を判定（Q7）
//     period: { from: "2019-04-01", to: "2026-09-26" },
//     scopes: [{ key, label, n }],                    // 1号艇を選んだときの数えるレース
//     scopesByBoat: { [boat]: [{ key: "VC"|"NC"|"NCR"|"VA", label, n }] },
//                       // 名前と件数は選んだ艇の級別で変わる（Q1）。VC の n<300 なら既定は NC
//     items: [{ key, label, better: "高い"|"速い"|"早い", worse: "低い"|"遅い", folded?: true }],
//                       // 展示前は exhibition_time を含めない
//     today: {
//       boats: [{ boat, racerClass, values: { [itemKey]: number|null }, ranks: { [itemKey]: { rank, ties }|null } }],
//       wind: { speed, wave } | null,   // 展示前は null
//       classAllSame: "A1" | null,      // 6艇とも同じ級別のときだけ
//     },
//     counts: { [scopeKey]: { [finish "1"|"2"|"3"]: { [boat "1".."6"]: {
//       total: { hits, n },
//       avgRank: { [itemKey]: number },                       // 六角形の点線
//       items: { [itemKey]: [{ rank: 1..6, hits, n }] },      // 6艇中の順位ごと（同じ値は両端に含めて集計済み）
//     } } } },          // 今節の平均着順点を出さない範囲（NCR が優勝戦）は、その項目を items に含めない（screens データ取得）
//     windWave: { [finish]: { [boat]: { hits, n, allHits, allN } } } | null,   // 展示前は null
//     aiOutlook: { [finish]: { [boat]: [{ theme, share, items: [{ label, share, direction }] }] } } | null,
//                       // 展示前の集計が無ければ null
//   }
//
//   GET /api/analogy/similar/{raceId}?stage=before|after
//   {
//     stage, status: "ok" | "empty",                // empty = 層が0件
//     stratum: { n, label: "G1以上の優勝戦", conditions: [{ label, value }] },
//     items: [{ key, label, todayValue, aligned: boolean, usedForDistance: boolean }],   // 33項目
//     weightOrder: [itemLabel...],
//     races: [{ raceId, date, venue, raceNumber, grade, round, finish: [1着,2着,3着], kimarite,
//               trifectaPayout, entry: "123/456", stOrder: [..6], matches: { [itemKey]: "same"|"near"|"diff" } }],
//                       // 似ている順。最大800件。スライダーの件数での集計は画面で行う
//     comparison: { label: "グレードを問わない優勝戦（ほかの条件は同じ）", n, boats: [{ boat, hits }],
//                   national: [{ boat, hits, n }] },
//   }
//
//   GET /api/analogy/scenario/{raceId}?scope=&stage=     （進入・形の切り替えでは取り直さない）
//   {
//     scope, stage,
//     scopes: [{ key, label }],                       // 級別は1号艇でそろえた名前（Q1）
//     total,                                          // 数えるレースの件数
//     entryPatterns: [{ key, label, n, share, boat1: { hits, n }, todayExhibition?: true, parent?: "maezuke" }],
//     exhibitionEntry: { pattern, label, hits, n, since: "2026-04" } | null,   // 展示前は null
//     exhibitionShape: { label } | null,              // 展示前は null
//     slitHint: { boats: [{ boat, course: { st, n }, overall: { st, n }, venue: { st, n },
//                           venueAll: { st }, exhibition: { st, flying }|null }],
//                 conditions: [{ key, label, shapeKey, shapeLabel, hits, n, elseHits, elseN }] },
//                       // 札を付けるか（30件以上・高い・ぶれ幅が重ならない）は画面で判定する前提
//     cells: { [entryKey]: { [shapeKey "any"|...]: {
//       n, share, boat1: { hits, n },
//       attack: null | { attackerBoat, aheadRate: { hits, n },
//                        exTime: [{ band, hits, n, national: { hits, n }, today? }], motor: [...],
//                        boat1: { exTime: [...], motor: [...] } },          // shape が any のときは null
//       result: { n, win: [{ boat, hits }], top3: [{ boat, hits }], kimarite: [{ label, hits }],
//                 manshu: { hits, n, allHits, allN }, flows: [[1着,2着,3着,件数]...], trifecta: [{ combo, hits }],
//                 races?: [{ date, venue, raceNumber, entry, finish: [..3], kimarite, payout }] },   // n<30 のときだけ
//     } } },
//   }
//   モックの件数: 枠なり×カド一撃のセルだけ n=12（30件未満）。total は scope 文字列のハッシュで決まる。

const RACE_ID = process.env.ANALOGY_RACE_ID ?? "";

const VENUE = "若松";
const PERIOD = { from: "2019-04-01", to: "2026-09-26" };
const PERIOD_TEXT = "2019/4/1〜2026/9/26";
const SERIES_LABEL = "今節の平均着順点（前日まで）"; // Q6
const Q7_NOTE =
  "優勝戦・準優勝戦の日は、点の順位がほぼ枠の順になるので、今日の一文は出していない";

// ---------- 共通 ----------

const isBeforeStage = (stage) => /before|pre/i.test(stage ?? "");

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
};
const fmtN = (n) => n.toLocaleString("en-US");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// spec「割合の桁」: 大きい数字・よく出た3連単は小数1桁、ほかは整数
const pctInt = (hits, n) => `${Math.round((hits / n) * 100)}%`;
const pct1 = (hits, n) => `${((hits / n) * 100).toFixed(1)}%`;
const hashStr = (s) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------- facts（タブ1） ----------

const ITEMS = [
  { key: "series_score", label: SERIES_LABEL, better: "高い", worse: "低い" },
  {
    key: "exhibition_time",
    label: "展示タイム",
    better: "速い",
    worse: "遅い",
  },
  { key: "local_win_rate", label: "当地勝率", better: "高い", worse: "低い" },
  {
    key: "national_win_rate",
    label: "全国勝率",
    better: "高い",
    worse: "低い",
  },
  { key: "avg_st", label: "平均ST（直近30走）", better: "早い", worse: "遅い" },
  {
    key: "recent_win_rate",
    label: "直近30走の1着率",
    better: "高い",
    worse: "低い",
  },
  { key: "motor_2rate", label: "モーター2連率", better: "高い", worse: "低い" },
  {
    key: "boat_2rate",
    label: "ボート2連率",
    better: "高い",
    worse: "低い",
    folded: true,
  },
];
const LOWER_IS_BETTER = new Set(["exhibition_time", "avg_st"]);

// 今日の6艇の値（1号艇が index 0）
const TODAY_VALUES = {
  series_score: [8.67, 8.33, 8.0, 7.71, 7.33, 6.67], // spec A-4 の例のレースの値（枠の順）
  exhibition_time: [6.72, 6.75, 6.78, 6.74, 6.8, 6.77],
  local_win_rate: [6.5, 7.2, 6.5, 5.8, 6.5, 6.9], // 1号艇は高いほうから3番目・3艇が同じ値
  national_win_rate: [8.67, 7.8, 7.1, 6.67, 7.1, 7.5], // 1号艇は6艇で一番高い（6.67〜8.67）
  avg_st: [0.13, 0.15, 0.14, 0.16, 0.15, 0.17],
  recent_win_rate: [null, 0.27, 0.23, 0.5, 0.27, 0.27], // 1号艇は値なし → 今日の一文を出さない
  motor_2rate: [45.2, 38.1, 52.3, 41.0, 36.5, 48.8],
  boat_2rate: [40.1, 35.2, 38.8, 42.0, 33.3, 36.6],
};

const rankOf = (key, values, idx) => {
  const v = values[idx];
  if (v == null) return null;
  const lower = LOWER_IS_BETTER.has(key);
  const better = values.filter(
    (x) => x != null && (lower ? x < v : x > v),
  ).length;
  const ties = values.filter((x) => x === v).length;
  return { rank: better + 1, ties };
};

const SCOPE_N = { VC: 1134, NC: 5210, NCR: 588, VA: 41230 };
const SCOPE_FACTOR = { VC: 1, NC: 0.97, NCR: 1.03, VA: 0.85 };
const BASE_P = {
  1: [0.655, 0.13, 0.11, 0.06, 0.03, 0.015],
  2: [0.82, 0.38, 0.32, 0.27, 0.15, 0.06],
  3: [0.9, 0.6, 0.52, 0.47, 0.32, 0.19],
};
const buckets = (pairs) =>
  pairs.map(([hits, n], i) => ({ rank: i + 1, hits, n }));
// 判定・並び・今日の一文を確かめるための固定値（数えるレース|着順|艇番|項目）
const ITEM_OVERRIDES = {
  // 差が大きい: 76%（205/270）と 15%（40/260）
  "VC|1|1|national_win_rate": buckets([
    [205, 270],
    [180, 260],
    [160, 250],
    [120, 240],
    [80, 250],
    [40, 260],
  ]),
  // 差ははっきりしない: 63%（120/190）と 61%（110/180）でぶれ幅が重なる
  "VC|1|1|local_win_rate": buckets([
    [120, 190],
    [115, 185],
    [112, 182],
    [110, 180],
    [112, 183],
    [110, 180],
  ]),
  // 逆向き・差が大きい: 一番高いとき40%、一番低いとき64%
  "VC|1|1|motor_2rate": buckets([
    [100, 250],
    [110, 250],
    [120, 250],
    [130, 250],
    [140, 250],
    [160, 250],
  ]),
  // 差は小さい: 52% と 48%（件数が多くぶれ幅が重ならない、差5ポイント未満）
  "VA|1|1|avg_st": buckets([
    [10400, 20000],
    [10200, 20000],
    [10100, 20000],
    [9900, 20000],
    [9800, 20000],
    [9600, 20000],
  ]),
  // 今節の平均着順点（前日まで）: 一番高いとき71%（170/240）
  "VC|1|1|series_score": buckets([
    [170, 240],
    [150, 240],
    [140, 240],
    [120, 240],
    [100, 240],
    [70, 240],
  ]),
};

const factsCell = (scope, finish, boat, itemKeys, nOverride) => {
  const n = nOverride ?? SCOPE_N[scope];
  const p = Math.min(0.99, BASE_P[finish][boat - 1] * SCOPE_FACTOR[scope]);
  const total =
    scope === "VC" && finish === 1 && boat === 1 && nOverride == null
      ? { hits: 743, n: 1134 }
      : { hits: Math.round(n * p), n };
  const items = {};
  const avgRank = {};
  itemKeys.forEach((key, j) => {
    const ov =
      nOverride == null
        ? ITEM_OVERRIDES[`${scope}|${finish}|${boat}|${key}`]
        : undefined;
    const bn = Math.round(n / 5);
    items[key] =
      ov ??
      [1, 2, 3, 4, 5, 6].map((r) => ({
        rank: r,
        n: bn,
        hits: Math.round(
          bn *
            Math.max(
              0.005,
              Math.min(0.99, total.hits / total.n + (3.5 - r) * 0.002),
            ),
        ),
      }));
    avgRank[key] =
      Math.round((1.8 + ((boat + j + finish) % 4) * 0.7) * 10) / 10;
  });
  return { total, avgRank, items };
};

const AI_THEMES = [
  "選手の実力",
  "スタート・展示",
  "モーター・ボート",
  "体重・年齢・地元",
  "会場・レース番号",
  "天候・水面",
  "レースの条件",
];
const AI_SHARES = [0.34, 0.22, 0.15, 0.09, 0.11, 0.05, 0.04];
const AI_ITEMS = {
  選手の実力: [
    {
      label: "全国勝率",
      share: 0.21,
      direction: "6艇の中で全国勝率が高いほど見込みが上がる",
    },
  ],
  "スタート・展示": [
    {
      label: "平均ST",
      share: 0.12,
      direction: "6艇の中で平均STが早いほど見込みが上がる",
    },
  ],
  "モーター・ボート": [
    {
      label: "モーター2連率",
      share: 0.1,
      direction: "6艇の中でモーター2連率が高いほど見込みが上がる",
    },
  ],
  "体重・年齢・地元": [
    {
      label: "年齢",
      share: 0.05,
      direction: "中堅の年齢で上がりやすい（若いほど・年配ほど、ではない）",
    },
  ],
  "会場・レース番号": [
    {
      label: "会場",
      share: 0.08,
      direction: "上がる: 徳山・大村・尼崎／下がる: 江戸川・平和島・戸田",
    },
  ],
  "天候・水面": [
    { label: "風速", share: 0.03, direction: "風が強いほど見込みが下がる" },
  ],
  レースの条件: [
    {
      label: "グレード",
      share: 0.02,
      direction: "グレードが高いほど見込みが上がる",
    },
  ],
};
const aiOutlook = () => {
  const out = {};
  for (const f of [1, 2, 3]) {
    out[f] = {};
    for (let b = 1; b <= 6; b++) {
      out[f][b] = AI_THEMES.map((theme, t) => ({
        theme,
        share: AI_SHARES[(t + b - 1 + f - 1) % AI_SHARES.length],
        items: AI_ITEMS[theme],
      }));
    }
  }
  return out;
};

// 例のレース（6艇ともA1・G1優勝戦）と、Q1・Q7 を確かめるための級別が混ざった予選のレース
const ALL_A1_CLASSES = ["A1", "A1", "A1", "A1", "A1", "A1"];
const MIXED_CLASSES = ["A1", "A1", "A2", "B1", "B1", "B1"];
const MIXED_COMBO = "A1が2艇・A2が1艇・B1が3艇";
// 級別が混ざったレースの VC の件数（選んだ艇ごと）。1・2号艇は300件未満 → 既定が NC になる
const MIXED_VC_N = { 1: 180, 2: 180, 3: 450, 4: 520, 5: 520, 6: 520 };
const MIXED_NC_N = 4200;
const mixedScopeLabel = (prefix, boat) =>
  `${prefix}・${MIXED_COMBO}（${boat}号艇は${MIXED_CLASSES[boat - 1]}）`;

const scopesFor = (mixed, boat) => {
  if (!mixed) {
    return [
      { key: "VC", label: "若松・6艇ともA1", n: SCOPE_N.VC },
      { key: "NC", label: "全国・6艇ともA1", n: SCOPE_N.NC },
      { key: "NCR", label: "全国・6艇ともA1の優勝戦", n: SCOPE_N.NCR },
      { key: "VA", label: "若松の全レース", n: SCOPE_N.VA },
    ];
  }
  // 予選の日なので NCR は出さない
  return [
    { key: "VC", label: mixedScopeLabel("若松", boat), n: MIXED_VC_N[boat] },
    { key: "NC", label: mixedScopeLabel("全国", boat), n: MIXED_NC_N },
    { key: "VA", label: "若松の全レース", n: SCOPE_N.VA },
  ];
};

function buildFacts({
  stage,
  status = "ok",
  afterStatus = "ready",
  mixed = false,
}) {
  const before = isBeforeStage(stage) || afterStatus !== "ready";
  const items = ITEMS.filter((it) => !(before && it.key === "exhibition_time"));
  const keys = items.map((it) => it.key);
  const counts = {};
  for (const scope of mixed ? ["VC", "NC", "VA"] : ["VC", "NC", "NCR", "VA"]) {
    counts[scope] = {};
    for (const f of [1, 2, 3]) {
      counts[scope][f] = {};
      for (let b = 1; b <= 6; b++) {
        // NCR（優勝戦）は今節の平均着順点を集計に含めない（screens データ取得）
        const k =
          scope === "NCR" ? keys.filter((x) => x !== "series_score") : keys;
        const nOverride =
          mixed && scope === "VC"
            ? MIXED_VC_N[b]
            : mixed && scope === "NC"
              ? MIXED_NC_N
              : undefined;
        counts[scope][f][b] = factsCell(scope, f, b, k, nOverride);
      }
    }
  }
  const windWave = {};
  for (const f of [1, 2, 3]) {
    windWave[f] = {};
    for (let b = 1; b <= 6; b++)
      windWave[f][b] = {
        hits: 40 + b * 3 + f,
        n: 120 + b,
        allHits: 300 + b * 7,
        allN: 900,
      };
  }
  return {
    status,
    afterStatus,
    stage: before ? "before" : "after",
    race: {
      venue: VENUE,
      raceNumber: 12,
      date: "2026-09-27",
      grade: mixed ? "一般" : "G1",
      round: mixed ? "予選" : "優勝戦",
      classSummary: mixed ? MIXED_COMBO : "6艇ともA1",
    },
    period: PERIOD,
    scopes: scopesFor(mixed, 1),
    scopesByBoat: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((b) => [b, scopesFor(mixed, b)]),
    ),
    items,
    today: {
      boats: [1, 2, 3, 4, 5, 6].map((boat) => ({
        boat,
        racerClass: (mixed ? MIXED_CLASSES : ALL_A1_CLASSES)[boat - 1],
        values: Object.fromEntries(
          keys.map((k) => [k, TODAY_VALUES[k][boat - 1]]),
        ),
        ranks: Object.fromEntries(
          keys.map((k) => [k, rankOf(k, TODAY_VALUES[k], boat - 1)]),
        ),
      })),
      wind: before ? null : { speed: 3, wave: 2 },
      classAllSame: mixed ? null : "A1",
    },
    counts,
    windWave: before ? null : windWave,
    aiOutlook: before ? null : aiOutlook(),
  };
}

// ---------- similar（タブ2） ----------

const SIM_VENUES = [
  "若松",
  "徳山",
  "大村",
  "住之江",
  "尼崎",
  "下関",
  "芦屋",
  "福岡",
];
const KIMARITE = {
  1: "逃げ",
  2: "差し",
  3: "まくり",
  4: "まくり差し",
  5: "抜き",
  6: "恵まれ",
};

const SIM_ITEMS = (() => {
  const list = [];
  for (let b = 1; b <= 6; b++)
    list.push({ key: `nwr${b}`, label: `${b}号艇の全国勝率`, group: "card" });
  for (let b = 1; b <= 6; b++)
    list.push({ key: `st${b}`, label: `${b}号艇の平均ST`, group: "card" });
  for (let b = 1; b <= 6; b++)
    list.push({
      key: `mot${b}`,
      label: `${b}号艇のモーター2連率`,
      group: "card",
    });
  for (let b = 1; b <= 6; b++)
    list.push({
      key: `ext${b}`,
      label: `${b}号艇の展示タイム`,
      group: "after",
    });
  list.push({ key: "weather", label: "天候", group: "after" });
  list.push({ key: "wind", label: "風速", group: "after" });
  list.push({ key: "wave", label: "波高", group: "after" });
  list.push({ key: "venue", label: "会場", group: "card" });
  list.push({ key: "race_no", label: "レース番号", group: "card" });
  list.push({
    key: "final_day",
    label: "最終日かどうか",
    group: "card",
    usedForDistance: false,
  });
  list.push({
    key: "boat1_class",
    label: "1号艇の級別",
    group: "card",
    aligned: true,
  });
  list.push({
    key: "gap_band",
    label: "1号艇と勝率トップの差",
    group: "card",
    aligned: true,
  });
  list.push({
    key: "top_boat",
    label: "勝率トップの艇番",
    group: "card",
    aligned: true,
  });
  return list.map((it) => ({
    aligned: false,
    usedForDistance: true,
    todayValue: "—",
    ...it,
  }));
})();

// 層は120件（似ている順）。1着: 1号艇77・2号艇14・3号艇12・4号艇9・5号艇5・6号艇3
const SIM_N = 120;
const SIM_RACES = (() => {
  const head = [1, 1, 2, 1, 1, 3, 1, 4, 1, 1];
  const rest = { 1: 70, 2: 13, 3: 11, 4: 8, 5: 5, 6: 3 };
  const pool = Object.entries(rest).flatMap(([b, c]) =>
    Array(c).fill(Number(b)),
  );
  const order = pool
    .map((b, k) => ({ b, key: (k * 37) % pool.length }))
    .sort((x, y) => x.key - y.key)
    .map((x) => x.b);
  const winners = [...head, ...order];
  const w1Combos = [
    ...Array(18).fill([2, 4]),
    ...Array(12).fill([2, 3]),
    ...Array(9).fill([3, 2]),
  ];
  const w1Rest = [
    [3, 4],
    [4, 2],
    [2, 5],
    [5, 3],
    [4, 3],
    [2, 6],
    [3, 5],
    [4, 5],
  ];
  let w1 = 0;
  const other = {};
  const start = Date.UTC(2019, 5, 1);
  return winners.map((w, i) => {
    let second;
    let third;
    if (w === 1) {
      [second, third] =
        w1 < w1Combos.length
          ? w1Combos[w1]
          : w1Rest[(w1 - w1Combos.length) % w1Rest.length];
      w1++;
    } else {
      const k = other[w] ?? 0;
      other[w] = k + 1;
      second = 1;
      third = [2, 3, 4, 5, 6].filter((b) => b !== w)[k % 4];
    }
    const date = new Date(start + i * 17 * 86400000).toISOString().slice(0, 10);
    const matches = Object.fromEntries(
      SIM_ITEMS.map((it, j) => {
        if (it.aligned) return [it.key, "same"];
        if (j % 7 === 3) return [it.key, i % 4 === 0 ? "same" : "diff"]; // 半分未満しかそろわない項目
        return [
          it.key,
          (i + j) % 5 === 0 ? "diff" : (i + j) % 3 === 0 ? "near" : "same",
        ];
      }),
    );
    return {
      raceId: `sim-${i}`,
      date,
      venue: SIM_VENUES[i % SIM_VENUES.length],
      raceNumber: 12,
      grade: "G1",
      round: "優勝戦",
      finish: [w, second, third],
      kimarite: KIMARITE[w],
      trifectaPayout: 800 + ((i * 523) % 30000),
      entry: "123/456",
      stOrder: [1, 2, 2, 5, 2, 6],
      matches,
    };
  });
})();

const simRaceLabel = (r) =>
  `${fmtDate(r.date)}\\s?${escapeRe(r.venue)}${r.raceNumber}R`;

function buildSimilar({ stage, status = "ok" }) {
  const before = isBeforeStage(stage);
  const races =
    status === "empty" ? [] : before ? [...SIM_RACES].reverse() : SIM_RACES;
  return {
    stage: before ? "before" : "after",
    status,
    stratum: {
      n: races.length,
      label: "G1以上の優勝戦",
      conditions: [
        { label: "1号艇の級別", value: "A1" },
        { label: "1号艇と勝率トップの差", value: "+0.19以上" },
        { label: "勝率トップの艇番", value: "1号艇" },
        { label: "ラウンド", value: "優勝戦" },
        { label: "グレード", value: "G1以上" },
      ],
    },
    items: SIM_ITEMS.filter((it) => !(before && it.group === "after")),
    weightOrder: ["1号艇の全国勝率", "1号艇の平均ST", "1号艇のモーター2連率"],
    races,
    comparison: {
      label: "グレードを問わない優勝戦（ほかの条件は同じ）",
      n: 76,
      boats: [
        { boat: 1, hits: 49 },
        { boat: 2, hits: 8 },
        { boat: 3, hits: 7 },
        { boat: 4, hits: 6 },
        { boat: 5, hits: 4 },
        { boat: 6, hits: 2 },
      ],
      national: [1, 2, 3, 4, 5, 6].map((boat) => ({
        boat,
        hits: [55, 14, 12, 10, 6, 3][boat - 1],
        n: 100,
      })),
    },
  };
}

// ---------- scenario（タブ3） ----------

const SHAPES = [
  { key: "any", label: "どの形でも" },
  { key: "flat", label: "横一線" },
  { key: "inner3", label: "内3艇そろう" },
  { key: "two_dent", label: "2コース凹み" },
  { key: "kado_uke_dent", label: "カド受け凹み" },
  { key: "kado_ippatsu", label: "カド一撃" },
  { key: "in_dent", label: "イン凹み" },
  { key: "dash_lead", label: "ダッシュ勢先行" },
];
const ENTRIES = [
  { key: "any", label: "どの進入でも", share: 1 },
  { key: "wakunari", label: "枠なり", share: 0.8 },
  { key: "maezuke", label: "前付けあり（1号艇イン）", share: 0.15 },
  { key: "maezuke6", label: "6号艇だけ", share: 0.06, parent: "maezuke" },
  { key: "maezuke5", label: "5号艇だけ", share: 0.05, parent: "maezuke" },
  { key: "maezuke56", label: "5・6号艇", share: 0.03, parent: "maezuke" },
  { key: "maezuke_other", label: "その他", share: 0.01, parent: "maezuke" },
  { key: "in_taken", label: "1号艇がインを取られた", share: null }, // 12件固定（30件未満）
];
// 札の文言（screens「細部の約束」）
const HINT_TAG = "平均STが当てはまる 19%（当てはまらないとき10%）";

const scenarioResult = (n, seed) => {
  const w = [0.5, 0.15, 0.12, 0.12, 0.07, 0.04];
  const result = {
    n,
    win: [1, 2, 3, 4, 5, 6].map((boat) => ({
      boat,
      hits: Math.round(n * w[boat - 1]),
    })),
    top3: [1, 2, 3, 4, 5, 6].map((boat) => ({
      boat,
      hits: Math.round(n * [0.85, 0.6, 0.5, 0.5, 0.35, 0.2][boat - 1]),
    })),
    kimarite: Object.values(KIMARITE).map((label, i) => ({
      label,
      hits: Math.round(n * w[i]),
    })),
    manshu: {
      hits: Math.round(n * 0.2),
      n,
      allHits: Math.round(n * 0.18),
      allN: n,
    },
    flows: [
      [1, 2, 3, Math.round(n * 0.2)],
      [1, 3, 2, Math.round(n * 0.15)],
      [1, 2, 4, Math.round(n * 0.15)],
      [2, 1, 3, Math.round(n * 0.1)],
      [3, 1, 2, Math.round(n * 0.1)],
      [4, 1, 2, Math.round(n * 0.1)],
    ],
    trifecta: [
      { combo: "1-2-3", hits: Math.round(n * 0.2) },
      { combo: "1-3-2", hits: Math.round(n * 0.15) },
      { combo: "1-2-4", hits: Math.round(n * 0.12) },
    ],
  };
  if (n < 30) {
    result.races = Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2020, 0, 1) + (i + seed) * 9 * 86400000)
        .toISOString()
        .slice(0, 10),
      venue: SIM_VENUES[i % SIM_VENUES.length],
      raceNumber: (i % 12) + 1,
      entry: i % 3 === 0 ? "231/456" : "123/456",
      finish: [1 + (i % 6), 1 + ((i + 1) % 6), 1 + ((i + 2) % 6)],
      kimarite: KIMARITE[1 + (i % 6)],
      payout: 1000 + ((i * 731) % 40000),
    }));
  }
  return result;
};

const attackFor = (shapeKey) =>
  shapeKey === "any"
    ? null
    : {
        attackerBoat: 4,
        aheadRate: { hits: 30, n: 80 },
        exTime: [
          {
            band: "1〜2位",
            hits: 16,
            n: 45,
            national: { hits: 120, n: 300 },
            today: true,
          },
          { band: "3〜4位", hits: 24, n: 60, national: { hits: 100, n: 310 } },
          { band: "5〜6位", hits: 5, n: 30, national: { hits: 60, n: 280 } },
        ],
        motor: [
          { band: "1〜2位", hits: 20, n: 55, national: { hits: 110, n: 290 } },
          { band: "3〜4位", hits: 15, n: 50, national: { hits: 95, n: 300 } },
          { band: "5〜6位", hits: 9, n: 30, national: { hits: 70, n: 300 } },
        ],
        boat1: {
          exTime: [
            { band: "1〜2位", hits: 30, n: 70 },
            { band: "3〜4位", hits: 20, n: 50 },
            { band: "5〜6位", hits: 6, n: 15 },
          ],
          motor: [
            { band: "1〜2位", hits: 28, n: 60 },
            { band: "3〜4位", hits: 18, n: 50 },
            { band: "5〜6位", hits: 10, n: 25 },
          ],
        },
      };

const entryN = (total, e) =>
  e.share == null ? 12 : Math.round(total * e.share);
const cellN = (total, e, s, i) => {
  const base = entryN(total, e);
  if (s.key === "any") return base;
  if (e.key === "wakunari" && s.key === "kado_ippatsu") return 12;
  return Math.round(base * (0.05 + i * 0.02));
};

function buildScenario(url, { mixed = false } = {}) {
  const q = new URL(url).searchParams;
  const scope = q.get("scope") ?? "";
  const before = isBeforeStage(q.get("stage"));
  const total = 300 + (hashStr(scope || "default") % 2000);
  const cells = {};
  ENTRIES.forEach((e, ei) => {
    cells[e.key] = {};
    SHAPES.forEach((s, si) => {
      const n = cellN(total, e, s, si);
      cells[e.key][s.key] = {
        n,
        share: s.key === "any" ? 1 : n / Math.max(1, entryN(total, e)),
        boat1: { hits: Math.round(n * 0.4), n },
        attack: attackFor(s.key),
        result: scenarioResult(n, ei * 10 + si),
      };
    });
  });
  const scopes = mixed
    ? [
        // タブ3の級別は1号艇でそろえる（Q1）。予選・一般なので NCR・VG は無い
        { key: "VC", label: mixedScopeLabel("若松", 1) },
        { key: "NC", label: mixedScopeLabel("全国", 1) },
        { key: "VA", label: "若松の全レース" },
        { key: "NA", label: "全国の全レース" },
      ]
    : [
        { key: "VC", label: "若松・6艇ともA1" },
        { key: "NC", label: "全国・6艇ともA1" },
        { key: "NCR", label: "全国・6艇ともA1の優勝戦" },
        { key: "VA", label: "若松の全レース" },
        { key: "VG", label: "若松のG1" },
        { key: "NA", label: "全国の全レース" },
      ];
  return {
    scope,
    stage: before ? "before" : "after",
    scopes,
    total,
    entryPatterns: ENTRIES.map((e) => {
      const n = entryN(total, e);
      return {
        key: e.key,
        label: e.label,
        n,
        share: n / total,
        boat1: { hits: Math.round(n * 0.55), n },
        ...(e.parent ? { parent: e.parent } : {}),
        ...(!before && e.key === "wakunari" ? { todayExhibition: true } : {}),
      };
    }),
    exhibitionEntry: before
      ? null
      : {
          pattern: "wakunari",
          label: "枠なり",
          hits: 1882,
          n: 2023,
          since: "2026-04",
        },
    exhibitionShape: before ? null : { label: "横一線" },
    slitHint: {
      boats: [1, 2, 3, 4, 5, 6].map((boat) => ({
        boat,
        course: { st: 0.13 + boat * 0.003, n: 22 },
        overall: { st: 0.14 + boat * 0.002, n: 30 },
        venue: { st: 0.135 + boat * 0.002, n: 12 },
        venueAll: { st: 0.15 + boat * 0.002 },
        exhibition: before
          ? null
          : { st: boat === 3 ? 0.09 : 0.1 + boat * 0.01, flying: boat === 3 },
      })),
      conditions: [
        // 上げる・30件以上・ぶれ幅が重ならない → 2コース凹みに札が付く
        {
          key: "c_two_dent",
          label: "2号艇の平均STが1号艇・3号艇より.02以上遅い",
          shapeKey: "two_dent",
          shapeLabel: "2コース凹み",
          hits: 57,
          n: 300,
          elseHits: 120,
          elseN: 1200,
        },
        // 下げる → 「むしろなりにくい」、札なし
        {
          key: "c_kado",
          label: "4号艇の平均STが3号艇より.01以上遅い",
          shapeKey: "kado_ippatsu",
          shapeLabel: "カド一撃",
          hits: 20,
          n: 400,
          elseHits: 110,
          elseN: 1100,
        },
      ],
    },
    cells,
  };
}

// ---------- ルート・導線 ----------

/**
 * API のモックを入れる。opts で状態を切り替える。
 * 戻り値の calls に各エンドポイントの呼び出しURLが溜まる（遅延取得・取り直しの確認用）。
 */
async function mockApis(page, opts = {}) {
  const calls = { facts: [], similar: [], scenario: [] };
  const last = { scenario: null };
  await page.route("**/api/analogy/facts/**", async (route) => {
    const url = route.request().url();
    calls.facts.push(url);
    if (opts.factsFail) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "fail" }),
      });
      return;
    }
    const body = buildFacts({
      stage: new URL(url).searchParams.get("stage"),
      status: opts.factsStatus ?? "ok",
      afterStatus: opts.afterStatus ?? "ready",
      mixed: opts.mixed ?? false,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/analogy/similar/**", async (route) => {
    const url = route.request().url();
    calls.similar.push(url);
    const body = buildSimilar({
      stage: new URL(url).searchParams.get("stage"),
      status: opts.similarStatus ?? "ok",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/analogy/scenario/**", async (route) => {
    const url = route.request().url();
    calls.scenario.push(url);
    const body = buildScenario(url, { mixed: opts.mixed ?? false });
    last.scenario = body;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { calls, last };
}

async function openSection(page) {
  if (!RACE_ID) {
    throw new Error(
      "ANALOGY_RACE_ID が未設定。2026-09-27 若松12R の raceId を環境変数で渡す（spec・screens に raceId と導線が無いため）",
    );
  }
  await page.goto(`/race/${RACE_ID}`);
  await page
    .getByRole("tab", { name: /AI予想/ })
    .or(page.getByRole("button", { name: /AI予想/ }))
    .or(page.getByRole("link", { name: /AI予想/ }))
    .first()
    .click();
  const section = page.getByRole("region", {
    name: /アナロジー・ファインダー/,
  });
  await expect(section).toBeVisible();
  return section;
}

const timeGroup = (s) => s.getByRole("group", { name: "時点" });
const afterBtn = (s) =>
  timeGroup(s).getByRole("button", { name: "展示後（直前情報も）" });
const beforeBtn = (s) =>
  timeGroup(s).getByRole("button", { name: "展示前（出走表）" });
const finishGroup = (s) => s.getByRole("group", { name: "着順" });
const boatGroup = (s) => s.getByRole("group", { name: "艇番" });
const tab = (s, name) => s.getByRole("tab", { name });
const panel = (s) => s.getByRole("tabpanel");
const scopeGroup = (s) => panel(s).getByRole("group", { name: "数えるレース" });
const scopeBtn = (s, name) =>
  scopeGroup(s).getByRole("button", { name, exact: true });
const card = (s, label) =>
  panel(s)
    .getByRole("article")
    .filter({
      has: s
        .page()
        .getByRole("heading", { name: new RegExp(`^${escapeRe(label)}`) }),
    });

async function openTab(section, name) {
  await tab(section, name).click();
  await expect(tab(section, name)).toHaveAttribute("aria-selected", "true");
}

// ======================================================================
// 節・共通の操作・状態
// ======================================================================

test.describe("アナロジー・ファインダー: 節と共通の操作", () => {
  test("[screens S-1 / 構造] AI予想タブに節があり、見出しに会場とRが出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      section
        .getByRole("heading", { name: /アナロジー・ファインダー/ })
        .first(),
    ).toContainText(`${VENUE}12R`);
  });

  test("[spec 時点 / screens 状態] 展示後の段があれば時点の既定は「展示後（直前情報も）」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(afterBtn(section)).toBeEnabled();
    await expect(afterBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "false");
  });

  test("[screens 状態 / spec Q5] 展示データがまだ無いときは「展示後」を押せず「展示の後に選べる」と出る", async ({
    page,
  }) => {
    await mockApis(page, { afterStatus: "no_exhibition" });
    const section = await openSection(page);
    await expect(afterBtn(section)).toBeDisabled();
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText("展示の後に選べる")).toBeVisible();
    await expect(section.getByText("展示の結果を反映しています")).toHaveCount(
      0,
    );
  });

  test("[screens 状態 / spec Q5] 展示後の段がまだ保存されていないときは「展示後」を押せず「展示の結果を反映しています」", async ({
    page,
  }) => {
    await mockApis(page, { afterStatus: "reflecting" });
    const section = await openSection(page);
    await expect(afterBtn(section)).toBeDisabled();
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText("展示の結果を反映しています")).toBeVisible();
    await expect(section.getByText("展示の後に選べる")).toHaveCount(0);
  });

  test("[screens 状態 / spec Q5] 締切後も展示後の段が無いときは「展示後」を押せず、下の1行も出さない", async ({
    page,
  }) => {
    await mockApis(page, { afterStatus: "closed" });
    const section = await openSection(page);
    await expect(afterBtn(section)).toBeDisabled();
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText("展示の後に選べる")).toHaveCount(0);
    await expect(section.getByText("展示の結果を反映しています")).toHaveCount(
      0,
    );
  });

  test("[spec 時点 欠場 / screens 状態] 出走表の後に欠場が分かったレースは節の中を1行だけにする", async ({
    page,
  }) => {
    await mockApis(page, { factsStatus: "scratched" });
    const section = await openSection(page);
    await expect(
      section.getByText(
        "欠場があったため、このレースのアナロジー・ファインダーは出していません",
      ),
    ).toBeVisible();
    await expect(section.getByRole("tablist")).toHaveCount(0);
    await expect(section.getByRole("group", { name: "時点" })).toHaveCount(0);
  });

  test("[screens S-1 / 状態] 保存が無いレースは節の中を「このレースは、表示できるデータがありません」だけにする", async ({
    page,
  }) => {
    await mockApis(page, { factsStatus: "not_saved" });
    const section = await openSection(page);
    await expect(
      section.getByText("このレースは、表示できるデータがありません"),
    ).toBeVisible();
    await expect(section.getByRole("tablist")).toHaveCount(0);
    await expect(section.getByRole("group", { name: "時点" })).toHaveCount(0);
  });

  test("[screens 構造] 着順は「1着」「2着以内」「3着以内」、既定は1着", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const g = finishGroup(section);
    await expect(g.getByRole("button")).toHaveCount(3);
    await expect(g.getByRole("button", { name: "1着" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(g.getByRole("button", { name: "2着以内" })).toBeVisible();
    await expect(g.getByRole("button", { name: "3着以内" })).toBeVisible();
  });

  test("[screens S-1 2] タブは3つで、既定は「来る艇の条件」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(section.getByRole("tablist").getByRole("tab")).toHaveCount(3);
    await expect(tab(section, "来る艇の条件")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tab(section, "類似レース")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(tab(section, "展開シナリオ")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("[screens データ取得] 類似レース・展開シナリオのデータはタブを開くまで取得しない", async ({
    page,
  }) => {
    const { calls } = await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section).getByRole("heading", { level: 3 }).first(),
    ).toBeVisible();
    expect(calls.facts.length).toBeGreaterThan(0);
    expect(calls.similar).toHaveLength(0);
    expect(calls.scenario).toHaveLength(0);
    await openTab(section, "類似レース");
    await expect.poll(() => calls.similar.length).toBeGreaterThan(0);
    expect(calls.scenario).toHaveLength(0);
  });

  test("[screens S-1 / spec やらないこと] 選んだタブ・艇番はURLに残さず、開き直すと既定に戻る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const urlBefore = page.url();
    await boatGroup(section).getByRole("button", { name: "3" }).click();
    await openTab(section, "類似レース");
    expect(page.url()).toBe(urlBefore);
    const again = await openSection(page);
    await expect(tab(again, "来る艇の条件")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      boatGroup(again).getByRole("button", { name: "1" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("[screens 状態 / spec Q5] 取得に失敗したら、そのタブの中に案内を出し、ほかのタブは使える", async ({
    page,
  }) => {
    await mockApis(page, { factsFail: true });
    const section = await openSection(page);
    await expect(
      panel(section).getByText(
        "表示できませんでした。時間をおいて開き直してください",
      ),
    ).toBeVisible();
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("slider", { name: /似ている順に/ }),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        "表示できませんでした。時間をおいて開き直してください",
      ),
    ).toHaveCount(0);
  });

  test("[spec 位置づけ / FR-E / 非機能] 節の中に「寄与度」「モデル」「競艇」の語が出ない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await section
      .getByText(
        "AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか",
      )
      .click();
    await section
      .getByText("使っている項目（どの数字から出しているか）")
      .click();
    const text1 = await section.innerText();
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("heading", { name: "類似レース" }),
    ).toBeVisible();
    const text2 = await section.innerText();
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByRole("heading", { name: "展開シナリオ" }),
    ).toBeVisible();
    const text3 = await section.innerText();
    for (const t of [text1, text2, text3]) {
      expect(t).not.toContain("寄与度");
      expect(t).not.toContain("モデル");
      expect(t).not.toContain("競艇");
    }
  });
});

// ======================================================================
// タブ1 来る艇の条件（FR-A・FR-E）
// ======================================================================

test.describe("アナロジー・ファインダー: 来る艇の条件", () => {
  test("[spec FR-A A-1] 見出しは「1号艇が1着になったのは、どんなとき？」で、艇番の既定は1", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "1号艇が1着になったのは、どんなとき？",
      }),
    ).toBeVisible();
    await expect(boatGroup(section).getByRole("button")).toHaveCount(6);
    await expect(
      boatGroup(section).getByRole("button", { name: "1" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("[spec 着順 / FR-A] 艇番・着順を変えると見出しが「3号艇が2着以内に入ったのは、どんなとき？」になる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await boatGroup(section).getByRole("button", { name: "3" }).click();
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "3号艇が1着になったのは、どんなとき？",
      }),
    ).toBeVisible();
    await finishGroup(section).getByRole("button", { name: "2着以内" }).click();
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "3号艇が2着以内に入ったのは、どんなとき？",
      }),
    ).toBeVisible();
    await finishGroup(section).getByRole("button", { name: "3着以内" }).click();
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "3号艇が3着以内に入ったのは、どんなとき？",
      }),
    ).toBeVisible();
  });

  test("[spec A-3 / 数えるレース] 6艇ともA1の優勝戦は、数えるレースがVC・NC・NCR・VAの4つで、既定はVC（名前は「若松・6艇ともA1」）", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(scopeGroup(section).getByRole("button")).toHaveCount(4);
    await expect(scopeBtn(section, "若松・6艇ともA1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(scopeBtn(section, "全国・6艇ともA1")).toBeVisible();
    await expect(scopeBtn(section, "全国・6艇ともA1の優勝戦")).toBeVisible();
    await expect(scopeBtn(section, "若松の全レース")).toBeVisible();
    await expect(panel(section).getByText(/全国で数えています/)).toHaveCount(0);
  });

  test("[spec 数えるレース Q1] 級別が混ざったレースは名前に組み合わせと選んだ艇の級別が入り、VCが300件未満なら既定がNCで1行が出る", async ({
    page,
  }) => {
    await mockApis(page, { mixed: true });
    const section = await openSection(page);
    await expect(scopeGroup(section).getByRole("button")).toHaveCount(3); // 予選なので NCR は無い
    await expect(scopeBtn(section, mixedScopeLabel("全国", 1))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(scopeBtn(section, mixedScopeLabel("若松", 1))).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(scopeBtn(section, mixedScopeLabel("若松", 1))).toBeEnabled(); // VC は選べるまま
    await expect(
      panel(section).getByText(
        "若松で同じ組み合わせのレースは180件と少ないので、全国で数えています",
      ),
    ).toBeVisible();
    await expect(
      panel(section).getByText(`${mixedScopeLabel("全国", 1)}で、1号艇の1着率`),
    ).toBeVisible();
  });

  test("[spec 数えるレース Q1] 艇番を変えると数えるレースの名前と既定が選び直される", async ({
    page,
  }) => {
    await mockApis(page, { mixed: true });
    const section = await openSection(page);
    await expect(scopeBtn(section, mixedScopeLabel("全国", 1))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await boatGroup(section).getByRole("button", { name: "3" }).click();
    // 3号艇（A2）は VC が450件 → 既定は VC に戻り、1行は消える
    await expect(scopeBtn(section, mixedScopeLabel("若松", 3))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(scopeBtn(section, mixedScopeLabel("全国", 3))).toBeVisible();
    await expect(scopeBtn(section, mixedScopeLabel("若松", 1))).toHaveCount(0);
    await expect(panel(section).getByText(/全国で数えています/)).toHaveCount(0);
    await expect(
      panel(section).getByText(`${mixedScopeLabel("若松", 3)}で、3号艇の1着率`),
    ).toBeVisible();
    const vc3 = buildFacts({ stage: "after", mixed: true }).counts.VC[1][3]
      .total;
    await expect(
      panel(section).getByText(new RegExp(`${vc3.hits}/${vc3.n}レース`)),
    ).toBeVisible();
  });

  test("[spec 数えるレース Q1 / A-4] 級別が混ざったレースでは、級別のカードも級別の1行も出さない", async ({
    page,
  }) => {
    await mockApis(page, { mixed: true });
    const section = await openSection(page);
    await expect(card(section, "全国勝率")).toBeVisible();
    await expect(card(section, "級別")).toHaveCount(0);
    await expect(panel(section).getByText(/^級別: /)).toHaveCount(0);
  });

  test("[spec A-6 / 割合の桁] 大きい数字に範囲・艇番・着順・割合（小数1桁）・件数・期間が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const p = panel(section);
    await expect(p.getByText("若松・6艇ともA1で、1号艇の1着率")).toBeVisible();
    await expect(p.getByText("65.5%", { exact: true })).toBeVisible();
    await expect(
      p.getByText(`743/1,134レース（${PERIOD_TEXT}）`),
    ).toBeVisible();
  });

  test("[spec A-6 / 受入基準] 数えるレースを変えると大きい数字が変わる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const p = panel(section);
    await scopeBtn(section, "全国・6艇ともA1").click();
    await expect(p.getByText("全国・6艇ともA1で、1号艇の1着率")).toBeVisible();
    const nc = buildFacts({ stage: "after" }).counts.NC[1][1].total;
    await expect(
      p.getByText(pct1(nc.hits, nc.n), { exact: true }),
    ).toBeVisible();
    await expect(
      p.getByText(
        new RegExp(`${escapeRe(fmtN(nc.hits))}/${escapeRe(fmtN(nc.n))}レース`),
      ),
    ).toBeVisible();
    await expect(p.getByText(/743\/1,134レース/)).toHaveCount(0);
  });

  test("[spec A-6 受入基準] 艇番・着順を変えると大きい数字が変わる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const p = panel(section);
    await boatGroup(section).getByRole("button", { name: "2" }).click();
    await finishGroup(section).getByRole("button", { name: "3着以内" }).click();
    const vc = buildFacts({ stage: "after" }).counts.VC[3][2].total;
    await expect(
      p.getByText("若松・6艇ともA1で、2号艇の3着以内率"),
    ).toBeVisible();
    await expect(
      p.getByText(pct1(vc.hits, vc.n), { exact: true }),
    ).toBeVisible();
  });

  test("[spec A-5] 六角形のラベルに今日の6艇中の順位が出て、展示後は展示タイムの軸がある", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const hex = panel(section).getByRole("img", { name: /6艇中/ }).first();
    await expect(hex).toHaveAttribute("aria-label", /全国勝率\s*6艇中1位/);
    await expect(hex).toHaveAttribute("aria-label", /展示タイム/);
  });

  test("[spec A-7 / 割合の桁] カード「全国勝率」: 一番高いとき76%（205/270）、判定「差が大きい」、6つの順位の棒", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, "全国勝率");
    await expect(c).toContainText("6艇で一番高いとき");
    await expect(c).toContainText("76%");
    await expect(c).toContainText("205/270");
    await expect(c).toContainText("6艇で一番低いとき");
    await expect(c).toContainText("15%");
    await expect(c).toContainText("40/260");
    await expect(c).toContainText("差が大きい");
    await expect(c.getByRole("img")).toHaveAttribute(
      "aria-label",
      /76%[\s\S]*69%[\s\S]*64%[\s\S]*50%[\s\S]*32%[\s\S]*15%/,
    );
  });

  test("[spec A-7 判定] ぶれ幅が重なる項目は「差ははっきりしない」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, "当地勝率");
    await expect(c).toContainText("差ははっきりしない");
    await expect(c).not.toContainText("差が大きい");
    await expect(c).not.toContainText("差は小さい");
  });

  test("[spec A-7 判定] 悪いときのほうが高い項目は「（一番低いときのほうが高い）」を添える", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, "モーター2連率");
    await expect(c).toContainText("差が大きい");
    await expect(c).toContainText("（一番低いときのほうが高い）");
  });

  test("[spec A-7 判定] ぶれ幅が重ならず差が5ポイント未満の項目は「差は小さい」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await scopeBtn(section, "若松の全レース").click();
    const c = card(section, "平均ST（直近30走）");
    await expect(c).toContainText("差は小さい");
    await expect(c).toContainText("6艇で一番早いとき");
  });

  test("[spec A-7 並び] 差がはっきりしているものが先、その中は差の大きい順、はっきりしないものは後", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(card(section, "全国勝率")).toBeVisible();
    const headings = await panel(section)
      .getByRole("article")
      .getByRole("heading")
      .allInnerTexts();
    const idx = (label) => headings.findIndex((h) => h.startsWith(label));
    expect(idx("全国勝率")).toBeGreaterThanOrEqual(0);
    expect(idx("全国勝率")).toBeLessThan(idx("モーター2連率")); // 61pt > 24pt（どちらもはっきり）
    expect(idx("モーター2連率")).toBeLessThan(idx("当地勝率")); // はっきりしないものは後
  });

  test("[spec A-7 今日の一文] 6艇で一番高いときの一文に今日の値・6艇の幅・同じ条件の率と件数が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, "全国勝率");
    await expect(c).toContainText(
      "今日の1号艇は全国勝率が6艇で一番高い（今日8.67、6艇は6.67〜8.67）",
    );
    await expect(c).toContainText(
      /同じ条件の1号艇は、過去に76%が1着（205\/270件、ぶれ幅\d+〜\d+%）/,
    );
  });

  test("[spec A-7 今日の一文] 中間の順位は「高いほうから3番目（3艇が同じ値」と出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(card(section, "当地勝率")).toContainText(
      "今日の1号艇は当地勝率が高いほうから3番目（3艇が同じ値",
    );
  });

  test("[spec A-7 今日の一文] 今日の値が無い項目は一文を出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, "直近30走の1着率");
    await expect(c).toBeVisible();
    await expect(c).toContainText("6艇で一番高いとき");
    await expect(c).not.toContainText("今日の1号艇は");
  });

  test("[spec A-4 Q6・Q7] 優勝戦の日は「今節の平均着順点（前日まで）」のカードに率は出すが、今日の一文を出さず注記を出す", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const c = card(section, SERIES_LABEL);
    await expect(c).toBeVisible();
    await expect(c.getByRole("heading").first()).toContainText(SERIES_LABEL);
    await expect(c).toContainText("6艇で一番高いとき");
    await expect(c).toContainText("71%");
    await expect(c).toContainText("170/240");
    await expect(c).toContainText(Q7_NOTE);
    await expect(c).not.toContainText("今日の1号艇は");
    // 範囲を問わない（Q7）
    await scopeBtn(section, "若松の全レース").click();
    await expect(card(section, SERIES_LABEL)).toContainText(Q7_NOTE);
    await expect(card(section, SERIES_LABEL)).not.toContainText(
      "今日の1号艇は",
    );
  });

  test("[spec A-4 Q7] 優勝戦・準優勝戦でない日は、今節の平均着順点（前日まで）の今日の一文を出し、注記は出さない", async ({
    page,
  }) => {
    await mockApis(page, { mixed: true });
    const section = await openSection(page);
    const c = card(section, SERIES_LABEL);
    await expect(c).toBeVisible();
    await expect(c).toContainText(
      `今日の1号艇は${SERIES_LABEL}が6艇で一番高い（今日8.67、6艇は6.67〜8.67）`,
    );
    await expect(c).not.toContainText(Q7_NOTE);
  });

  test("[spec A-7 説明文] 項目ごとのカードの説明文が出る", async ({ page }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section).getByText(
        "各項目が6艇で一番良かったとき・一番悪かったときの1着率を比べた。差がはっきりしている順に並べている（項目どうしは重なっていて、どれが効いたかまでは分けられない）",
      ),
    ).toBeVisible();
  });

  test("[spec A-4 / 受入基準] NCR（優勝戦）では今節の平均着順点（前日まで）のカードを出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(card(section, SERIES_LABEL)).toBeVisible();
    await scopeBtn(section, "全国・6艇ともA1の優勝戦").click();
    await expect(
      panel(section).getByText("全国・6艇ともA1の優勝戦で、1号艇の1着率"),
    ).toBeVisible();
    await expect(card(section, "今節の平均着順点")).toHaveCount(0);
  });

  test("[spec 数えるレース / A-4] 6艇とも同じ級別なら「級別: 今日は6艇ともA1なので差がつかない」の1行だけで、級別のカードは出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section).getByText("級別: 今日は6艇ともA1なので差がつかない"),
    ).toBeVisible();
    await expect(card(section, "級別")).toHaveCount(0);
  });

  test("[spec A-8] ボート2連率は一番下に畳まれ、開くとカードと注記が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const summary = panel(section).getByText(
      "ボート2連率（着順との関係が小さい項目）",
    );
    await expect(summary).toBeVisible();
    await expect(card(section, "ボート2連率")).toBeHidden();
    await summary.click();
    await expect(card(section, "ボート2連率")).toBeVisible();
    await expect(
      panel(section).getByText(
        /ボート2連率が一番高いとき・低いときの差は2着以内・3着以内で/,
      ),
    ).toBeVisible();
  });

  test("[spec A-2 / screens 構造] もう1艇と比べる: 選択肢は自分以外の「N号艇」5つ、開くと次の艇番が選ばれ比べる艇の1行が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await panel(section).getByText("もう1艇と比べる").click();
    const select = panel(section).getByLabel("比べる艇");
    await expect(select).toBeVisible();
    const options = (await select.getByRole("option").allInnerTexts()).map(
      (o) => o.trim(),
    );
    expect(options).toEqual(["2号艇", "3号艇", "4号艇", "5号艇", "6号艇"]);
    await expect(card(section, "全国勝率")).toContainText(
      /2号艇の場合: 一番高いとき(\d+%|—)／一番低いとき(\d+%|—)（2号艇の全体の1着率\d+%）/,
    );
    await select.selectOption({ label: "4号艇" });
    await expect(card(section, "全国勝率")).toContainText(
      /4号艇の場合: 一番高いとき(\d+%|—)／一番低いとき(\d+%|—)（4号艇の全体の1着率\d+%）/,
    );
  });

  test("[spec A-9] 展示後は今日の風・波の見出しと艇番ごとの「（風を問わず{z}%）」が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section).getByText("今日の風・波（風3m・波2cm）に近いレースでは"),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByText(/\d+%（風を問わず\d+%）/)
        .first(),
    ).toBeVisible();
  });

  test("[spec 時点 / A-4 / A-9 / 受入基準] 展示前に切り替えると展示タイムのカード・六角形の軸・風・波が消える", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(card(section, "展示タイム")).toBeVisible();
    await beforeBtn(section).click();
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(card(section, "展示タイム")).toHaveCount(0);
    await expect(
      panel(section).getByRole("img", { name: /6艇中/ }).first(),
    ).not.toHaveAttribute("aria-label", /展示タイム/);
    await expect(
      panel(section).getByText("今日の風・波は、展示の後に出る"),
    ).toBeVisible();
    await expect(panel(section).getByText(/今日の風・波（風/)).toHaveCount(0);
  });

  test("[spec A-11] 脚注に「数えた割合で、原因とは限らない」がある", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(
      panel(section)
        .getByText(/数えた割合で、原因とは限らない/)
        .first(),
    ).toBeVisible();
  });

  test("[spec FR-E] AIの見立ては畳まれていて、開くと7テーマ、テーマを開くと項目と向きが出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const summary = panel(section).getByText(
      "AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか",
    );
    await expect(summary).toBeVisible();
    await expect(
      panel(section).getByText("選手の実力", { exact: true }),
    ).toBeHidden();
    await summary.click();
    await expect(
      panel(section)
        .getByText(/1号艇が1着.*を左右しやすい項目/)
        .first(),
    ).toBeVisible();
    for (const t of AI_THEMES)
      await expect(
        panel(section).getByText(t, { exact: true }).first(),
      ).toBeVisible();
    await panel(section)
      .getByText("選手の実力", { exact: true })
      .first()
      .click();
    await expect(
      panel(section).getByText("6艇の中で全国勝率が高いほど見込みが上がる"),
    ).toBeVisible();
  });

  test("[spec FR-E 受入基準] AIの見立ては艇番を変えると割合が変わる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    const summary = panel(section).getByText(
      "AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか",
    );
    await summary.click();
    const themeBox = () =>
      panel(section)
        .getByRole("group")
        .filter({ hasText: "選手の実力" })
        .last();
    await expect(themeBox()).toBeVisible();
    const before = await themeBox().innerText();
    await boatGroup(section).getByRole("button", { name: "2" }).click();
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "2号艇が1着になったのは、どんなとき？",
      }),
    ).toBeVisible();
    if (
      await panel(section)
        .getByText("選手の実力", { exact: true })
        .first()
        .isHidden()
    )
      await summary.click();
    await expect.poll(async () => themeBox().innerText()).not.toBe(before);
  });

  test("[spec FR-E] 展示前で集計が無いときは準備中の1文だけで、見出しも出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await beforeBtn(section).click();
    await expect(
      panel(section).getByText(
        "展示前のAIの見立ては準備中。展示後に切り替えると見られる",
      ),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        "AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか",
      ),
    ).toHaveCount(0);
  });
});

// ======================================================================
// タブ2 類似レース（FR-B）
// ======================================================================

test.describe("アナロジー・ファインダー: 類似レース", () => {
  const sliderOf = (s) =>
    panel(s).getByRole("slider", { name: /似ている順に/ });
  const winBar = (s, boat, hits, n) =>
    panel(s).getByRole("button", {
      name: new RegExp(`^${boat}号艇 ${escapeRe(pctInt(hits, n))} ${hits}件$`),
    });

  test("[spec B-4] スライダーの既定は層の件数（400未満のとき）で、全件を出している旨が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(sliderOf(section)).toBeVisible();
    await expect(
      panel(section).getByText(`${SIM_N}件`, { exact: true }).first(),
    ).toBeVisible();
    await expect(panel(section).getByText("少なく")).toBeVisible();
    await expect(panel(section).getByText("多く")).toBeVisible();
    await expect(
      panel(section).getByText("条件がそろった過去レースの全件を出している"),
    ).toBeVisible();
    await expect(
      panel(section).getByText(/件だと割合はぶれやすい/),
    ).toHaveCount(0);
  });

  test("[spec B-4 / screens 細部] 段は層の件数未満の段と最後に層の件数で、矢印キーで1段ずつ動く", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await sliderOf(section).focus();
    await page.keyboard.press("End");
    await expect(
      panel(section).getByText("120件", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(
      panel(section).getByText("100件", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(
      panel(section).getByText("75件", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("Home");
    await expect(
      panel(section).getByText("10件", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      panel(section).getByText("20件", { exact: true }).first(),
    ).toBeVisible();
  });

  test("[spec B-3] 説明文は『G1以上の優勝戦』と層の件数で、スライダーを動かしても件数は層のまま。直す前の※注記は出ない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("heading", { level: 3, name: "類似レース" }),
    ).toBeVisible();
    const text =
      "今日と同じ『G1以上の優勝戦』で、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース120件を、出走表が似ている順に並べた。展示後は展示タイム・天候・風・波も見ている";
    await expect(panel(section).getByText(text)).toBeVisible();
    await sliderOf(section).focus();
    await page.keyboard.press("Home");
    await expect(
      panel(section).getByText("10件", { exact: true }).first(),
    ).toBeVisible();
    await expect(panel(section).getByText(text)).toBeVisible();
    await expect(
      panel(section).getByText(/※優勝戦以外の名前の決勝/),
    ).toHaveCount(0);
  });

  test("[spec B-4/B-5/B-8 受入基準] スライダーを最小にすると件数・ソナーの点と扇・決まり方が10件に連動する", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await sliderOf(section).focus();
    await page.keyboard.press("Home");
    await expect(
      panel(section).getByText("10件", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        /一番遠い10件目でも、\d+項目中\d+項目が同じ・\d+項目が近い/,
      ),
    ).toBeVisible();
    const sonar = panel(section).getByRole("group", {
      name: "今日に似た過去レース10件",
    });
    await expect(sonar).toBeVisible();
    await expect(
      sonar.getByRole("button", {
        name: /^\d{4}\/\d{1,2}\/\d{1,2} .+\d+R 1着\d号艇$/,
      }),
    ).toHaveCount(10);
    // 扇の件数はスライダーの件数の中で数える（screens 細部）。先頭10件の1着: 1号艇7・2号艇1・3号艇1・4号艇1
    await expect(
      sonar.getByRole("button", { name: "1号艇が勝ったレース 7件" }),
    ).toBeVisible();
    await expect(panel(section).getByText(/似ている順の10件で/)).toBeVisible();
    await expect(winBar(section, 1, 7, 10)).toBeVisible();
  });

  test("[spec ぶれ幅・件数の扱い] 表示件数が30件未満なら「{n}件だと割合はぶれやすい」、30件では出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await sliderOf(section).focus();
    await page.keyboard.press("Home");
    await expect(
      panel(section).getByText("10件だと割合はぶれやすい（ぶれ幅が広い）"),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      panel(section).getByText("20件だと割合はぶれやすい（ぶれ幅が広い）"),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      panel(section).getByText("30件", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      panel(section).getByText(/件だと割合はぶれやすい/),
    ).toHaveCount(0);
    // タブ2は30件未満でも割合を出す（ぶれ幅と件数を添える）
    await page.keyboard.press("Home");
    await expect(winBar(section, 1, 7, 10)).toBeVisible();
  });

  test("[spec B-8 / 割合の桁] どの艇が勝った？: 艇番ごとの割合（整数）・件数と、比べる相手の名前と件数の凡例", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("heading", {
        level: 3,
        name: "類似レースの決まり方",
      }),
    ).toBeVisible();
    const wins = { 1: 77, 2: 14, 3: 12, 4: 9, 5: 5, 6: 3 };
    for (const [b, k] of Object.entries(wins))
      await expect(winBar(section, b, k, SIM_N)).toBeVisible();
    await expect(
      panel(section).getByText(
        /点線: グレードを問わない優勝戦（ほかの条件は同じ）\s*76件/,
      ),
    ).toBeVisible();
  });

  test("[spec B-8 / screens 構造] 棒を押すと吹き出しと着順の流れの絞り込みが同時に起き、もう一度押すと戻る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    const bar = winBar(section, 2, 14, SIM_N);
    await bar.click();
    await expect(panel(section).getByRole("status")).toContainText(
      new RegExp(
        `2号艇: 120件中14件（${escapeRe(pctInt(14, SIM_N))}、ぶれ幅\\d+〜\\d+%）`,
      ),
    );
    await expect(
      panel(section)
        .getByRole("button", { name: /^1着 2号艇→2着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
    await expect(
      panel(section).getByRole("button", { name: /^1着 1号艇→/ }),
    ).toHaveCount(0);
    await bar.click();
    await expect(
      panel(section)
        .getByRole("button", { name: /^1着 1号艇→2着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
  });

  test("[spec B-8 / screens ソナー] ソナーの扇を押すと棒と同じく、吹き出しが出てその艇が勝ったレースに着順の流れが絞られる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    const sonar = panel(section).getByRole("group", {
      name: `今日に似た過去レース${SIM_N}件`,
    });
    await sonar
      .getByRole("button", { name: "3号艇が勝ったレース 12件" })
      .click();
    await expect(panel(section).getByRole("status")).toContainText(
      "3号艇: 120件中12件",
    );
    await expect(
      panel(section)
        .getByRole("button", { name: /^1着 3号艇→2着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
    await expect(
      panel(section).getByRole("button", { name: /^1着 1号艇→/ }),
    ).toHaveCount(0);
  });

  test("[spec B-8 / 割合の桁] どう決まった？に決まり手の割合（整数）と件数が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("heading", { name: "どう決まった？" }).first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByText(new RegExp(`逃げ\\s*${escapeRe(pctInt(77, SIM_N))}\\s*77件`))
        .first(),
    ).toBeVisible();
  });

  test("[spec B-8 受入基準] 着順の流れは常に1着→2着→3着の3段で、「1号艇以外が勝ったレース」に切り替えられる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByRole("heading", { name: "着順の流れ" }).first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByRole("button", { name: /^1着 \d号艇→2着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByRole("button", { name: /^2着 \d号艇→3着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
    const toggle = panel(section).getByRole("button", {
      name: "1号艇以外が勝ったレース",
    });
    await expect(
      panel(section).getByRole("button", { name: "すべて" }),
    ).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel(section).getByRole("button", { name: /^1着 1号艇→/ }),
    ).toHaveCount(0);
    await expect(
      panel(section)
        .getByRole("button", { name: /^2着 \d号艇→3着 \d号艇 \d+件$/ })
        .first(),
    ).toBeVisible();
  });

  test("[spec B-8 / 割合の桁] よく出た3連単の上位3つ（小数1桁）と「残り{k}通りを見る（全{m}通り）」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    const m = new Set(SIM_RACES.map((r) => r.finish.join("-"))).size;
    await expect(
      panel(section).getByRole("heading", { name: "よく出た3連単" }).first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByText(new RegExp(`1-2-4\\s*${escapeRe(pct1(18, SIM_N))}\\s*18件`))
        .first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByText(new RegExp(`1-2-3\\s*${escapeRe(pct1(12, SIM_N))}\\s*12件`))
        .first(),
    ).toBeVisible();
    await expect(
      panel(section)
        .getByText(new RegExp(`1-3-2\\s*${escapeRe(pct1(9, SIM_N))}\\s*9件`))
        .first(),
    ).toBeVisible();
    await expect(
      panel(section).getByText(`残り${m - 3}通りを見る（全${m}通り）`),
    ).toBeVisible();
  });

  test("[spec B-6] 何が似ている？: 半分未満の項目は「そろっていない」側、そろえた条件の項目は出さない、全33項目の表", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await panel(section)
      .getByText("何が似ている？（項目ごとに、今日と同じだった割合）")
      .click();
    await expect(
      panel(section).getByText(/そろっていない（半分未満）/),
    ).toBeVisible();
    await expect(panel(section).getByText(/近さで重く見た順:/)).toBeVisible();
    await expect(
      panel(section).getByText("勝率トップの艇番", { exact: true }),
    ).toBeHidden();
    await panel(section)
      .getByText("全33項目（近さの計算に使わない項目も含む）を見る")
      .click();
    const table = panel(section).getByRole("table");
    await expect(
      table.getByRole("columnheader", { name: "項目（今日の値）" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "同じ（120件中）" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "近いも含む" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "全レースで同じ割合" }),
    ).toBeVisible();
    await expect(
      table.getByRole("row", { name: /最終日かどうか/ }),
    ).toContainText("—");
  });

  test("[spec B-6 受入基準] スライダーの件数が「何が似ている？」の表の件数に連動する", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await panel(section)
      .getByText("何が似ている？（項目ごとに、今日と同じだった割合）")
      .click();
    await panel(section)
      .getByText("全33項目（近さの計算に使わない項目も含む）を見る")
      .click();
    await sliderOf(section).focus();
    await page.keyboard.press("Home");
    await expect(
      panel(section)
        .getByRole("table")
        .getByRole("columnheader", { name: "同じ（10件中）" }),
    ).toBeVisible();
  });

  test("[spec B-7] 1件ずつ見比べる: 行は似ている順で、押すと全項目の比較が開く", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await panel(section)
      .getByText("1件ずつ見比べる（今日と全項目を並べる）")
      .click();
    const first = SIM_RACES[0];
    const row = panel(section).getByRole("button", {
      name: new RegExp(
        `${simRaceLabel(first)}[\\s\\S]*同じ\\d+・近い\\d+・違う\\d+`,
      ),
    });
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(
      panel(section)
        .getByText(/（全艇: 1号艇\d着/)
        .first(),
    ).toBeVisible();
  });

  test("[spec B-5] ソナーの点をタップすると、そのレースが「1件ずつ見比べる」で開く", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    const first = SIM_RACES[0];
    const sonar = panel(section).getByRole("group", {
      name: `今日に似た過去レース${SIM_N}件`,
    });
    await sonar
      .getByRole("button", {
        name: `${fmtDate(first.date)} ${first.venue}12R 1着${first.finish[0]}号艇`,
      })
      .click();
    const row = panel(section).getByRole("button", {
      name: new RegExp(
        `${simRaceLabel(first)}[\\s\\S]*同じ\\d+・近い\\d+・違う\\d+`,
      ),
    });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-expanded", "true");
  });

  test("[spec B-2 受入基準] 展示前と展示後で似ている順の並びが変わる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    const summary = panel(section).getByText(
      "1件ずつ見比べる（今日と全項目を並べる）",
    );
    await summary.click();
    const rows = () =>
      panel(section).getByRole("button", { name: /同じ\d+・近い\d+・違う\d+/ });
    const rowRe = (r) =>
      new RegExp(`${simRaceLabel(r)}[\\s\\S]*同じ\\d+・近い\\d+・違う\\d+`);
    await expect(rows().first()).toHaveAccessibleName(rowRe(SIM_RACES[0]));
    await beforeBtn(section).click();
    if (await rows().first().isHidden()) await summary.click();
    await expect(rows().first()).toHaveAccessibleName(
      rowRe(SIM_RACES[SIM_RACES.length - 1]),
    );
  });

  test("[spec B-8 脚注] 類似レースの脚注に「似ているからといって、同じ結果になるとは限らない」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByText(
        /似ているからといって、同じ結果になるとは限らない/,
      ),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        /AIの見立てと同じ向きになりやすい（別々の裏付けにはならない）/,
      ),
    ).toBeVisible();
  });

  test("[screens 状態 / spec Q5] 層が0件ならタブ2は1行だけで、スライダー・決まり方も出さない", async ({
    page,
  }) => {
    await mockApis(page, { similarStatus: "empty" });
    const section = await openSection(page);
    await openTab(section, "類似レース");
    await expect(
      panel(section).getByText("今日と同じ条件の過去レースがありません"),
    ).toBeVisible();
    await expect(
      panel(section).getByRole("heading", { name: "類似レースの決まり方" }),
    ).toHaveCount(0);
    await expect(panel(section).getByRole("slider")).toHaveCount(0);
  });
});

// ======================================================================
// タブ3 展開シナリオ（FR-C）
// ======================================================================

test.describe("アナロジー・ファインダー: 展開シナリオ", () => {
  const btnStartsWith = (s, name) =>
    panel(s).getByRole("button", { name: new RegExp(`^${escapeRe(name)}`) });
  const resultHeading = (s) =>
    panel(s).getByRole("heading", {
      name: /②の形のとき、どう決まった？（③の順位では分けていない）/,
    });
  const OTHER_ENTRY_NOTE =
    "枠なり以外を選んでいる。この手がかりは枠なりのときのものなので、そのまま当てはまらない（②の札も外している）";
  const scenarioFor = async (last) => {
    await expect.poll(() => last.scenario).not.toBeNull();
    return last.scenario;
  };

  test("[spec 着順 / screens] 展開シナリオのタブでは着順の切り替えを出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await expect(finishGroup(section)).toBeVisible();
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByRole("heading", { level: 3, name: "展開シナリオ" }),
    ).toBeVisible();
    await expect(finishGroup(section)).toHaveCount(0);
  });

  test("[spec C-0] 数えるレースは6つ（G1の今日は若松のG1も）、既定はVC", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(scopeGroup(section).getByRole("button")).toHaveCount(6);
    await expect(scopeBtn(section, "若松・6艇ともA1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of [
      "全国・6艇ともA1",
      "全国・6艇ともA1の優勝戦",
      "若松の全レース",
      "若松のG1",
      "全国の全レース",
    ]) {
      await expect(scopeBtn(section, name)).toBeVisible();
    }
  });

  test("[spec 数えるレース Q1 / screens S-1c] タブ3の数えるレースの級別は1号艇で、タブ1の艇番を変えても変わらない", async ({
    page,
  }) => {
    await mockApis(page, { mixed: true });
    const section = await openSection(page);
    await boatGroup(section).getByRole("button", { name: "3" }).click();
    await expect(scopeBtn(section, mixedScopeLabel("若松", 3))).toBeVisible();
    await openTab(section, "展開シナリオ");
    await expect(scopeBtn(section, mixedScopeLabel("若松", 1))).toBeVisible();
    await expect(scopeBtn(section, mixedScopeLabel("全国", 1))).toBeVisible();
    await expect(scopeBtn(section, mixedScopeLabel("若松", 3))).toHaveCount(0);
    await expect(scopeBtn(section, "若松のG1")).toHaveCount(0); // G1 でない日は VG を出さない
  });

  test("[spec C-1] ①進入の既定は枠なりで、型に1号艇の1着率が出る。30件未満の型は率を出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByRole("heading", { name: /進入はどうなる？/ }),
    ).toBeVisible();
    await expect(btnStartsWith(section, "枠なり")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(btnStartsWith(section, "どの進入でも")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(btnStartsWith(section, "枠なり")).toContainText(
      /1号艇の1着率\d+%/,
    );
    await expect(
      btnStartsWith(section, "前付けあり（1号艇イン）"),
    ).toBeVisible();
    const taken = btnStartsWith(section, "1号艇がインを取られた");
    await expect(taken).toContainText("12件（少ないので1着率は出さない）");
    await expect(taken).not.toContainText("1号艇の1着率");
  });

  test("[spec C-1] 前付けありの下に「6号艇だけ・5号艇だけ・5・6号艇・その他」を選べる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await btnStartsWith(section, "前付けあり（1号艇イン）").click();
    for (const name of ["6号艇だけ", "5号艇だけ", "5・6号艇", "その他"])
      await expect(btnStartsWith(section, name)).toBeVisible();
  });

  test("[spec C-1] 展示後は今日の展示に当てはまる型に「今日の展示」の印と、展示→本番の一致率が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(btnStartsWith(section, "枠なり")).toContainText("今日の展示");
    await expect(btnStartsWith(section, "どの進入でも")).not.toContainText(
      "今日の展示",
    );
    await expect(
      panel(section).getByText(
        new RegExp(
          `展示が枠なりだったレースの${escapeRe(pctInt(1882, 2023))}は、本番も枠なりだった`,
        ),
      ),
    ).toBeVisible();
  });

  test("[spec C-2] 既定（枠なり）で今日のスタートの手がかり（使う平均ST・表）が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByRole("heading", { name: "今日のスタートの手がかり" }),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        "平均STの並び（予想ではなく、過去の記録）。進入が枠なりになった場合の手がかり",
      ),
    ).toBeVisible();
    const st = panel(section).getByRole("group", { name: "使う平均ST" });
    await expect(
      st.getByRole("button", { name: "このコース" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(st.getByRole("button", { name: "全体" })).toBeVisible();
    const table = panel(section)
      .getByRole("table")
      .filter({ hasText: "このコース" });
    for (const name of [
      /^このコース/,
      /^全体/,
      /^若松で/,
      /^若松の全選手（コース別）/,
      /^今日の展示/,
    ]) {
      await expect(table.getByRole("row", { name })).toBeVisible();
    }
    await expect(table).toContainText(/\.\d{3}/); // 平均STは3桁（.133）
    await expect(table).toContainText(/F\.\d{2}/); // 展示のFは「F.09」
    await expect(panel(section).getByText(OTHER_ENTRY_NOTE)).toHaveCount(0);
  });

  test("[spec C-2 / 受入基準] 率を上げる条件を押すと②でその形が選ばれる。下げる条件は「むしろなりにくい」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    const raise = panel(section).getByRole("button", {
      name: /→ 過去、2コース凹みになったのは19%（当てはまらないとき10%）/,
    });
    await expect(raise).toBeVisible();
    await expect(
      panel(section)
        .getByText(/むしろなりにくい/)
        .first(),
    ).toBeVisible();
    await raise.click();
    await expect(btnStartsWith(section, "2コース凹み")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("[spec C-2 / screens 細部 / 受入基準] ②の札は率を上げる条件の形にだけ付き、下げる条件の形には付かない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(btnStartsWith(section, "2コース凹み")).toContainText(HINT_TAG);
    await expect(btnStartsWith(section, "カド一撃")).not.toContainText(
      "平均STが当てはまる",
    );
    await expect(btnStartsWith(section, "横一線")).not.toContainText(
      "平均STが当てはまる",
    );
  });

  test("[spec C-2 / screens 細部] 枠なり以外を選ぶと手がかりに注意が出て、②の札が外れる", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(btnStartsWith(section, "2コース凹み")).toContainText(HINT_TAG);
    await btnStartsWith(section, "前付けあり（1号艇イン）").click();
    await expect(panel(section).getByText(OTHER_ENTRY_NOTE)).toBeVisible();
    await expect(btnStartsWith(section, "2コース凹み")).not.toContainText(
      "平均STが当てはまる",
    );
  });

  test("[spec C-3] ②スリットの形は「どの形でも」と7つの形で、既定は「どの形でも」", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByRole("heading", {
        name: /スタートはどう並ぶ？（スリットの形）/,
      }),
    ).toBeVisible();
    await expect(btnStartsWith(section, "どの形でも")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const s of SHAPES.slice(1))
      await expect(btnStartsWith(section, s.label)).toBeVisible();
    await expect(btnStartsWith(section, "横一線")).toContainText(
      /1号艇の1着率\d+%/,
    );
  });

  test("[spec C-3] 展示後は「参考: 今日の展示の形は{形}」が出て、形のボタンに展示の印は付けない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByText(/参考: 今日の展示の形は横一線/),
    ).toBeVisible();
    await expect(btnStartsWith(section, "横一線")).not.toContainText(
      "今日の展示",
    );
  });

  test("[spec C-4 / screens 細部] 形を選ぶまでは③に案内の1行、選ぶと表（50件未満は同じセルに値と「少ない」）", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    const guide =
      "②でスリットの形を選ぶと、その形のときに攻める艇が勝ちきったか、1号艇が逃げたかが出る";
    await expect(
      panel(section).getByRole("heading", {
        name: /攻めは決まった？（攻める艇と1号艇の着順）/,
      }),
    ).toBeVisible();
    await expect(panel(section).getByText(guide)).toBeVisible();
    await btnStartsWith(section, "2コース凹み").click();
    await expect(panel(section).getByText(guide)).toHaveCount(0);
    const small = panel(section)
      .getByRole("cell", { name: /36%（16\/45）/ })
      .first();
    await expect(small).toBeVisible();
    await expect(small).toContainText("少ない");
    const enough = panel(section)
      .getByRole("cell", { name: /40%（24\/60）/ })
      .first();
    await expect(enough).toBeVisible();
    await expect(enough).not.toContainText("少ない");
  });

  test("[screens データ取得] 進入・形を切り替えても scenario を取り直さない", async ({
    page,
  }) => {
    const { calls } = await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(resultHeading(section)).toBeVisible();
    const count = calls.scenario.length;
    expect(count).toBeGreaterThan(0);
    await btnStartsWith(section, "どの進入でも").click();
    await btnStartsWith(section, "カド一撃").click();
    await btnStartsWith(section, "枠なり").click();
    await expect(btnStartsWith(section, "枠なり")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls.scenario).toHaveLength(count);
    for (const url of calls.scenario) {
      const q = new URL(url).searchParams;
      expect(q.has("entry")).toBe(false);
      expect(q.has("shape")).toBe(false);
    }
  });

  test("[spec FR-C 受入基準] 進入・形を変えると④の件数が変わる", async ({
    page,
  }) => {
    const { last } = await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    const sc = await scenarioFor(last);
    const nWaku = sc.cells.wakunari.any.n;
    const nAny = sc.cells.any.any.n;
    const nTwo = sc.cells.wakunari.two_dent.n;
    await expect(resultHeading(section)).toBeVisible();
    await expect(
      panel(section)
        .getByText(new RegExp(`(^|[^\\d,])${escapeRe(fmtN(nWaku))}件`))
        .first(),
    ).toBeVisible();
    await btnStartsWith(section, "どの進入でも").click();
    await expect(
      panel(section)
        .getByText(new RegExp(`(^|[^\\d,])${escapeRe(fmtN(nAny))}件`))
        .first(),
    ).toBeVisible();
    await btnStartsWith(section, "枠なり").click();
    await btnStartsWith(section, "2コース凹み").click();
    await expect(
      panel(section)
        .getByText(new RegExp(`(^|[^\\d,])${escapeRe(fmtN(nTwo))}件`))
        .first(),
    ).toBeVisible();
  });

  test("[spec C-5 / 受入基準] ④が30件未満なら割合を出さず1件ずつの一覧（進入 231/456 形式）", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await btnStartsWith(section, "カド一撃").click();
    await expect(resultHeading(section)).toBeVisible();
    await expect(
      panel(section)
        .getByRole("listitem")
        .filter({ hasText: /\d{3}\/\d{3}/ }),
    ).toHaveCount(12);
    await expect(panel(section).getByText("1着になった艇")).toHaveCount(0);
  });

  test("[spec C-5] 30件以上の④に1着の艇・3着以内・決まり手・万舟・着順の流れ・よく出た3連単が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    const p = panel(section);
    await expect(resultHeading(section)).toBeVisible();
    for (const name of [
      "1着になった艇",
      "3着以内に入った艇",
      "どう決まった？",
      "万舟（3連単1万円以上）",
      "着順の流れ",
      "よく出た3連単",
    ]) {
      await expect(p.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(
      p.getByRole("button", { name: /^2着 \d号艇→3着 \d号艇 \d+件$/ }).first(),
    ).toBeVisible();
  });

  test("[spec C-5 脚注] 返還レースを除くので来る艇の条件の件数とは合わない旨が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await expect(
      panel(section).getByText(
        /スリットの形はレース後に分かるもので、『もしこうなったら』の参考/,
      ),
    ).toBeVisible();
    await expect(
      panel(section).getByText(
        /返還（F・L・欠場）があったレース[\d,]+件を除くので、『来る艇の条件』の件数とは合わない/,
      ),
    ).toBeVisible();
  });

  test("[spec FR-C 受入基準] 数えるレースを変えると取り直して④の件数が変わる", async ({
    page,
  }) => {
    const { calls, last } = await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    const n1 = (await scenarioFor(last)).cells.wakunari.any.n;
    await expect(
      panel(section)
        .getByText(new RegExp(`(^|[^\\d,])${escapeRe(fmtN(n1))}件`))
        .first(),
    ).toBeVisible();
    const before = calls.scenario.length;
    await scopeBtn(section, "全国の全レース").click();
    await expect.poll(() => calls.scenario.length).toBeGreaterThan(before);
    await expect.poll(() => last.scenario.cells.wakunari.any.n).not.toBe(n1);
    const n2 = last.scenario.cells.wakunari.any.n;
    await expect(
      panel(section)
        .getByText(new RegExp(`(^|[^\\d,])${escapeRe(fmtN(n2))}件`))
        .first(),
    ).toBeVisible();
  });

  test("[spec C-1/C-2/C-3 / 受入基準] 展示前は「今日の展示」の印・展示の行・展示の形・一致率を出さない", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await openTab(section, "展開シナリオ");
    await beforeBtn(section).click();
    await expect(beforeBtn(section)).toHaveAttribute("aria-pressed", "true");
    await expect(btnStartsWith(section, "枠なり")).not.toContainText(
      "今日の展示",
    );
    await expect(panel(section).getByText(/本番も枠なりだった/)).toHaveCount(0);
    await expect(
      panel(section).getByText(/参考: 今日の展示の形は/),
    ).toHaveCount(0);
    const table = panel(section)
      .getByRole("table")
      .filter({ hasText: "このコース" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row", { name: /^今日の展示/ })).toHaveCount(
      0,
    );
  });
});

// ======================================================================
// 使っている項目（FR-D）
// ======================================================================

test.describe("アナロジー・ファインダー: 使っている項目", () => {
  test("[spec FR-D] 折りたたみを開くと、数えた値の期間が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await section
      .getByText("使っている項目（どの数字から出しているか）")
      .click();
    await expect(
      section.getByText(new RegExp(`数えた値は${escapeRe(PERIOD_TEXT)}`)),
    ).toBeVisible();
  });

  test("[spec FR-D] 展示前は「展示前は天候・風・波・展示タイムを使わず、見比べにも出さない」と書く", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await beforeBtn(section).click();
    await section
      .getByText("使っている項目（どの数字から出しているか）")
      .click();
    await expect(
      section.getByText(
        /展示前は天候・風・波・展示タイムを使わず、見比べにも出さない/,
      ),
    ).toBeVisible();
  });

  test("[spec ぶれ幅・件数の扱い] 使っている項目にぶれ幅の計算の注意が出る", async ({
    page,
  }) => {
    await mockApis(page);
    const section = await openSection(page);
    await section
      .getByText("使っている項目（どの数字から出しているか）")
      .click();
    await expect(
      section.getByText(
        /ぶれ幅は1レースずつ別々に起きたとみなした計算。似たレースは同じ会場・同じ節に偏るので、実際はもう少し広い/,
      ),
    ).toBeVisible();
  });
});
