#!/usr/bin/env node
/**
 * BOA-635「過去に発生した割合を見る」の純関数の検証（tasks T1-1・T1-3・T2-1）。DB 接続は不要。
 *
 *   1. src/utils/analogyScenario.js  … slitForms の強さの段（1段目は今と同じ、2段目の線）
 *   2. src/utils/pastRate/count.js   … 6つの型の一致件数・分母・除いた件数・内訳・点数・同時に起きない形
 *   3. src/utils/pastRate/layer.js   … 切り詰めの判定・使える layer か・v16 公開前のレース
 *   4. src/utils/pastRate/label.js   … 定番／レアの線（15%・5%）と、小分けごとに出すラベル
 *   5. src/utils/pastRate/storage.js … 端末内保存（置き換え・30日・上限・締切・壊れた値・例外）
 *
 * 仕様は docs/design/past-rate-check/spec.md（FR-1〜FR-5）。ST は 1/100秒の整数で比べる（浮動小数で
 * 割れる 0.15−0.10 等の組を入れる）。末尾の変異検証で、要を1つずつ壊したコピーに同じ検証をかけ、
 * 検証が失敗する（＝歯がある）ことを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const TARGETS = {
  scenario: "src/utils/analogyScenario.js",
  count: "src/utils/pastRate/count.js",
  layer: "src/utils/pastRate/layer.js",
  label: "src/utils/pastRate/label.js",
  storage: "src/utils/pastRate/storage.js",
  format: "src/components/race/pastRate/format.js",
};

const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// 固定の行データ（layer の rows と同じ形）
// ---------------------------------------------------------------------------
const WAKU = [1, 2, 3, 4, 5, 6];
const EVEN = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15];
let seq = 0;
function row({
  rank = [1, 2, 3],
  tech = "逃げ",
  cb = WAKU,
  st = EVEN,
  pay = 1500,
  date = "2026-09-01",
} = {}) {
  seq += 1;
  return {
    race_id: `${date}-01-${String((seq % 12) + 1).padStart(2, "0")}`,
    race_date: date,
    rank1: rank[0],
    rank2: rank[1],
    rank3: rank[2],
    winning_technique: tech,
    course_by_boat: cb,
    st_by_course: st,
    payout_3tan: pay,
  };
}

// 着順・1号艇・展開・配当・進入の行（ST はそろっている）
const ROWS = [
  row({ rank: [1, 2, 3], tech: "逃げ", pay: 999 }),
  row({ rank: [1, 3, 2], tech: "逃げ", pay: 1000 }),
  row({ rank: [1, 3, 4], tech: "逃げ", pay: 9999 }),
  row({ rank: [1, 4, 2], tech: "逃げ", pay: 10000 }),
  row({ rank: [2, 1, 3], tech: "差し", pay: 2500 }),
  row({ rank: [3, 1, 4], tech: "まくり", pay: 4800, cb: [1, 2, 3, 4, 5, 6] }),
  row({ rank: [3, 4, 1], tech: "まくり", pay: 31000 }),
  row({ rank: [4, 1, 2], tech: "まくり差し", pay: null }),
  row({ rank: [5, 6, 4], tech: null, pay: 88000, cb: [1, 2, 4, 3, 5, 6] }),
  row({ rank: [1, 2, 4], tech: "抜き", pay: 1900, cb: [1, 2, 3, 5, 4, 6] }),
  row({ rank: [1, 5, 2], tech: "逃げ", pay: 3000, cb: [2, 1, 3, 4, 6, 5] }),
  row({
    rank: [6, 1, 2],
    tech: "まくり",
    pay: 51000,
    cb: [1, 2, 3, 4, null, 6],
  }),
];
// 進入: 4号艇のコース = 4,4,4,4,4,4,4,4,3,5,4,4 → 3コース以内1、4コース以内11、枠なり10
// 6号艇のコース = 6×9, 6, 5, 6 → 枠なり11

// ---------------------------------------------------------------------------
// 検証の本体（モジュールを受け取る。変異検証でも同じものを使う）
// ---------------------------------------------------------------------------
const SUITES = {
  scenario(m, check) {
    const f = (st, level) =>
      Object.entries(m.slitForms(st, level))
        .filter(([, v]) => v)
        .map(([k]) => k);
    // 1段目（既定）は今の slitForms と同じ答え
    check(
      "1段目: 2コース凹み 0.15−0.10（浮動小数で割れる組）",
      f([0.1, 0.15, 0.1, 0.12, 0.13, 0.14]),
      ["flat", "d2"],
    );
    check(
      "2段目: 2コース凹み 0.05 では足りない",
      f([0.1, 0.15, 0.1, 0.12, 0.13, 0.14], 2),
      ["flat"],
    );
    check(
      "2段目: 2コース凹み 0.08 ちょうど",
      f([0.1, 0.18, 0.1, 0.12, 0.13, 0.14], 2),
      ["d2"],
    );
    check("1段目: イン凹み 0.21−0.16", f([0.21, 0.16, 0.17, 0.18, 0.19, 0.2]), [
      "flat",
      "d1",
    ]);
    check(
      "2段目: イン凹み 0.05 では足りない",
      f([0.21, 0.16, 0.17, 0.18, 0.19, 0.2], 2),
      ["flat"],
    );
    check(
      "1段目: カド一撃 0.03 ちょうど",
      f([0.13, 0.13, 0.13, 0.1, 0.14, 0.14]),
      ["flat", "wall", "kado"],
    );
    check(
      "2段目: カド一撃 0.03 では足りない",
      f([0.13, 0.13, 0.13, 0.1, 0.14, 0.14], 2),
      ["flat", "wall"],
    );
    check(
      "2段目: カド一撃 0.05 ちょうど",
      f([0.15, 0.15, 0.15, 0.1, 0.16, 0.16], 2),
      ["flat", "wall", "kado"],
    );
    check(
      "1段目: ダッシュ勢先行 和の差 0.15 ちょうど",
      f([0.2, 0.2, 0.2, 0.15, 0.15, 0.15]),
      ["flat", "wall", "kado", "dash"],
    );
    check(
      "2段目: ダッシュ勢先行 0.15 では足りない（0.24 要る）",
      f([0.2, 0.2, 0.2, 0.15, 0.15, 0.15], 2),
      ["flat", "wall", "kado"],
    );
    check(
      "2段目: ダッシュ勢先行 0.24 ちょうど",
      f([0.23, 0.23, 0.23, 0.15, 0.15, 0.15], 2),
      ["wall", "kado", "dash"],
    );
    check("2段目: カド受け凹み 0.08", f([0.1, 0.1, 0.18, 0.1, 0.12, 0.12], 2), [
      "d3",
    ]);
    check(
      "横一線は段で変わらない（幅 0.06 ちょうど）",
      f([0.1, 0.16, 0.12, 0.13, 0.14, 0.15], 2),
      ["flat"],
    );
    check(
      "1艇でも欠ければすべて false",
      f([0.1, null, 0.1, 0.1, 0.1, 0.1], 2),
      [],
    );
  },

  count(m, check) {
    const c = (type, input, rows = ROWS) => {
      const r = m.countPastRate(rows, type, input);
      return [r.n, r.count, r.excluded];
    };
    // 着順
    check(
      "着順 1点 1-3-2",
      c("order", { first: 1, second: [3], third: [2], nagashi: false }),
      [12, 1, []],
    );
    check(
      "着順 流し 1-3,4-2,3,4（4点）",
      c("order", { first: 1, second: [3, 4], third: [2, 3, 4], nagashi: true }),
      [12, 3, []],
    );
    check(
      "着順の点数（同じ艇を含む組は数えない）",
      m.orderPoints({
        first: 1,
        second: [3, 4],
        third: [2, 3, 4],
        nagashi: true,
      }),
      4,
    );
    check(
      "着順の点数 1着と同じ艇は数えない",
      m.orderPoints({ first: 1, second: [1, 2], third: [1, 3], nagashi: true }),
      1,
    );
    check(
      "着順の内訳（件数の多い順、同数は組の昇順、上位4組）",
      m.countPastRate(ROWS, "order", {
        first: 1,
        second: [2, 3, 4, 5],
        third: [2, 3, 4],
        nagashi: true,
      }).breakdown,
      {
        items: [
          { combo: "1-2-3", count: 1 },
          { combo: "1-2-4", count: 1 },
          { combo: "1-3-2", count: 1 },
          { combo: "1-3-4", count: 1 },
        ],
        more: true,
      },
    );
    check(
      "着順 1点は内訳なし",
      m.countPastRate(ROWS, "order", {
        first: 1,
        second: [2],
        third: [3],
        nagashi: false,
      }).breakdown,
      null,
    );
    // 1号艇
    check("1号艇 1着", c("boat1", { outcome: "win" }), [12, 6, []]);
    check("1号艇 残る", c("boat1", { outcome: "top3" }), [12, 11, []]);
    check("1号艇 飛ぶ", c("boat1", { outcome: "out" }), [12, 1, []]);
    // 展開
    check(
      "展開 3号艇のまくり（決まり手が無い行を除く）",
      c("tenkai", { boat: 3, technique: "makuri" }),
      [11, 2, [{ reason: "technique", count: 1 }]],
    );
    check(
      "展開の2着の内訳（0件は省く、多い順・同数は艇番順）",
      m.countPastRate(ROWS, "tenkai", { boat: 1, technique: "nige" }).breakdown,
      {
        items: [
          { boat: 3, count: 2 },
          { boat: 2, count: 1 },
          { boat: 4, count: 1 },
          { boat: 5, count: 1 },
        ],
        more: false,
      },
    );
    // 進入
    check(
      "進入 4号艇 3コース以内",
      c("entry", { boat: 4, target: "within3" }),
      [12, 1, []],
    );
    check(
      "進入 4号艇 4コース以内",
      c("entry", { boat: 4, target: "within4" }),
      [12, 11, []],
    );
    check("進入 4号艇 枠なり", c("entry", { boat: 4, target: "waku" }), [
      12,
      10,
      [],
    ]);
    check(
      "進入 5号艇 枠なり（その艇のコースが null の行を除く）",
      c("entry", { boat: 5, target: "waku" }),
      [11, 9, [{ reason: "course", count: 1 }]],
    );
    check(
      "進入 course_by_boat が配列ごと null の行を除く",
      c("entry", { boat: 3, target: "waku" }, [row({ cb: null }), row()]),
      [1, 1, [{ reason: "course", count: 1 }]],
    );
    // 配当の帯（1,000 ちょうどは中穴、10,000 ちょうどは万舟）
    check("配当 堅い", c("payout", { band: "low" }), [
      11,
      1,
      [{ reason: "payout", count: 1 }],
    ]);
    check("配当 中穴", c("payout", { band: "mid" }), [
      11,
      6,
      [{ reason: "payout", count: 1 }],
    ]);
    check("配当 万舟", c("payout", { band: "high" }), [
      11,
      4,
      [{ reason: "payout", count: 1 }],
    ]);
    // スリット
    const slitRows = [
      row({ st: [0.1, 0.15, 0.1, 0.12, 0.13, 0.14] }), // d2（1段目のみ）
      row({ st: [0.1, 0.18, 0.1, 0.12, 0.13, 0.14] }), // d2（両段）
      row({ st: [0.2, 0.2, 0.2, 0.15, 0.15, 0.15] }), // wall・kado・dash（1段目）
      row({ st: [0.15, 0.15, null, 0.15, 0.15, 0.15] }), // 要素の null（同じコースに2艇など）
      row({ st: null }), // 配列ごと null（守り）
    ];
    check(
      "スリット 2コース凹み 1段目",
      c("slit", { mode: "pattern", patterns: ["d2"], level: 1 }, slitRows),
      [3, 2, [{ reason: "st", count: 2 }]],
    );
    check(
      "スリット 2コース凹み 2段目",
      c("slit", { mode: "pattern", patterns: ["d2"], level: 2 }, slitRows),
      [3, 1, [{ reason: "st", count: 2 }]],
    );
    check(
      "スリット 2形 AND（カド一撃＋ダッシュ勢先行）",
      c(
        "slit",
        { mode: "pattern", patterns: ["kado", "dash"], level: 1 },
        slitRows,
      ),
      [3, 1, [{ reason: "st", count: 2 }]],
    );
    // 自分で作る: S − 6×c_k ≥ 30 で出る、6×c_k − S ≥ 30 で凹む
    const customRows = [
      row({ st: [0.2, 0.15, 0.15, 0.1, 0.15, 0.15] }), // S=90。1コース 6×20−90=30 で凹む、4コース 90−60=30 で出る
      row({ st: [0.19, 0.15, 0.15, 0.09, 0.15, 0.15] }), // S=88。1コース 114−88=26 凹まない、4コース 88−54=34 出る
    ];
    check(
      "自分で作る 1コース凹む・4コース出る",
      c("slit", { mode: "custom", courses: [-1, 0, 0, 1, 0, 0] }, customRows),
      [2, 1, []],
    );
    check(
      "自分で作る 4コース出るだけ",
      c("slit", { mode: "custom", courses: [0, 0, 0, 1, 0, 0] }, customRows),
      [2, 2, []],
    );
    // N=0
    // 浮動小数で割れる組: 0.29 と 0.23×5 は整数なら 6×29−144=30 ちょうど（浮動小数だと 29.99…）
    check(
      "自分で作る 30 ちょうど（整数で比べる）",
      c("slit", { mode: "custom", courses: [-1, 0, 0, 0, 0, 0] }, [
        row({ st: [0.29, 0.23, 0.23, 0.23, 0.23, 0.23] }),
      ]),
      [1, 1, []],
    );
    check(
      "N=0（展開で決まり手が全部 null）",
      c("tenkai", { boat: 1, technique: "nige" }, [row({ tech: null })]),
      [0, 0, [{ reason: "technique", count: 1 }]],
    );
    // 決着
    check(
      "決着 1-3-2（着順1点と同じ数え方）",
      [
        m.decisionCount(ROWS, [1, 3, 2]).count,
        m.decisionCount(ROWS, [1, 3, 2]).n,
      ],
      [1, 12],
    );
    // 同時に起きない形（押した後に残る2形の組で決める）
    check(
      "同時に起きない: 内3艇そろうを選んだとき（1段目）",
      m.incompatibleForms(["wall"], 1),
      ["d2", "d3", "d1"],
    );
    check(
      "同時に起きない: 2段目は横一線と凹み・ダッシュ勢先行も",
      m.incompatibleForms(["flat"], 2),
      ["d2", "d3", "d1", "dash"],
    );
    check(
      "同時に起きない: 1段目の横一線は全部押せる",
      m.incompatibleForms(["flat"], 1),
      [],
    );
    check(
      "同時に起きない: 2形のときは新しい方と組む（内3艇→カド一撃の後は2コース凹みを押せる）",
      m.incompatibleForms(["wall", "kado"], 1),
      [],
    );
    check(
      "同時に起きない: 2形のときは新しい方と組む（カド一撃→内3艇）",
      m.incompatibleForms(["kado", "wall"], 1),
      ["d2", "d3", "d1"],
    );
    check("選択中の形は押せる（外すため）", m.incompatibleForms(["d2"], 1), [
      "wall",
      "d3",
      "d1",
    ]);
    check(
      "2段目に切り替えられない組（横一線＋イン凹み）",
      m.levelBlocked(["flat", "d1"]),
      true,
    );
    check(
      "2段目に切り替えられる組（カド一撃＋ダッシュ勢先行）",
      m.levelBlocked(["kado", "dash"]),
      false,
    );
  },

  layer(m, check) {
    check(
      "切り詰め: n_returned < n_total",
      m.isTruncated({ n_total: 7286, n_returned: 2000 }),
      true,
    );
    check(
      "切り詰めなし: n_returned = n_total",
      m.isTruncated({ n_total: 1234, n_returned: 1234 }),
      false,
    );
    check(
      "上限の値に依存しない（1,000件に下げても判定できる）",
      m.isTruncated({ n_total: 1500, n_returned: 1000 }),
      true,
    );
    const ok = { status: "ok", race_id: "2026-10-14-01-01", rows: [row()] };
    check(
      "使える layer",
      m.usableLayer({ status: "ready", data: ok }, "2026-10-14-01-01"),
      true,
    );
    check(
      "race_id が違う（前のレースの data が残っている）",
      m.usableLayer({ status: "loading", data: ok }, "2026-10-14-01-02"),
      false,
    );
    check(
      "ready でも race_id が違えば使わない",
      m.usableLayer({ status: "ready", data: ok }, "2026-10-14-01-02"),
      false,
    );
    check(
      "読み込み中は使わない",
      m.usableLayer({ status: "loading", data: ok }, "2026-10-14-01-01"),
      false,
    );
    for (const s of ["not_saved", "empty_layer", "absent"])
      check(
        `status=${s} は使わない`,
        m.usableLayer(
          { status: "ready", data: { status: s } },
          "2026-10-14-01-01",
        ),
        false,
      );
    check(
      "rows が0行は使わない",
      m.usableLayer(
        { status: "ready", data: { ...ok, rows: [] } },
        "2026-10-14-01-01",
      ),
      false,
    );
    check(
      "v16 公開前のレースは取得しない",
      m.hasLayerDate("2026-09-30-01-01"),
      false,
    );
    check(
      "公開日以降は取得する",
      m.hasLayerDate(`${m.LAYER_FIRST_DATE}-01-01`),
      true,
    );
    check("raceId が読めなければ取得しない", m.hasLayerDate("bad"), false);
    // layer の中身の印
    const base = {
      run_id: "r1",
      race_id: "2026-10-14-01-01",
      conditions: { b1_class: "A1", gap_band: 2, top_boat: 1, round: null, grade_g1plus: false },
      n_total: 4,
      n_returned: 4,
      pool_from: "2019-04-01",
      pool_cutoff: "2026-10-13",
      rows: [row({ rank: [1, 2, 3] }), row({ rank: [1, 3, 2] }), row({ rank: [2, 1, 3] }), row({ rank: [3, 1, 2] })],
    };
    const k = m.layerKey(base);
    check("印は16進8桁", /^[0-9a-f]{8}$/.test(k), true);
    check("run_id が違っても行が同じなら同じ印", m.layerKey({ ...base, run_id: "r2" }), k);
    const mid = base.rows.map((r, i) => (i === 2 ? { ...r, rank2: 4 } : r));
    check("先頭と末尾が同じで中の行だけ違えば違う印", m.layerKey({ ...base, rows: mid }) !== k, true);
    const st = base.rows.map((r, i) => (i === 1 ? { ...r, st_by_course: [0.15, 0.15, 0.15, 0.15, 0.15, 0.16] } : r));
    check("中の行の ST が1つ違えば違う印", m.layerKey({ ...base, rows: st }) !== k, true);
    check("条件が違えば違う印", m.layerKey({ ...base, conditions: { ...base.conditions, gap_band: 3 } }) !== k, true);
    check("n_total が違えば違う印", m.layerKey({ ...base, n_total: 5 }) !== k, true);
  },

  label(m, check) {
    const nag = { first: 1, second: [2, 3], third: [2, 3, 4], nagashi: true };
    check(
      "流し 15% ちょうどで定番",
      m.rateLabel({ n: 20, count: 3 }, "order", nag),
      "standard",
    );
    check(
      "流し 15% 未満は無印",
      m.rateLabel({ n: 1000, count: 149 }, "order", nag),
      null,
    );
    check(
      "流し 5% ちょうどは無印",
      m.rateLabel({ n: 20, count: 1 }, "order", nag),
      null,
    );
    check(
      "流し 5% 未満でレア",
      m.rateLabel({ n: 1000, count: 49 }, "order", nag),
      "rare",
    );
    check(
      "N=0 はラベルなし",
      m.rateLabel({ n: 0, count: 0 }, "order", nag),
      null,
    );
    const one = { first: 1, second: [2], third: [3], nagashi: false };
    check(
      "着順1点はレアを出さない",
      m.rateLabel({ n: 1000, count: 10 }, "order", one),
      null,
    );
    check(
      "1号艇は定番を出さない",
      m.rateLabel({ n: 100, count: 60 }, "boat1", { outcome: "win" }),
      null,
    );
    check(
      "配当の帯は出さない",
      m.rateLabel({ n: 100, count: 60 }, "payout", { band: "mid" }),
      null,
    );
    check(
      "自分で作るは出さない",
      m.rateLabel({ n: 100, count: 1 }, "slit", {
        mode: "custom",
        courses: [1, 0, 0, 0, 0, 0],
      }),
      null,
    );
    check(
      "スリットの形は出す",
      m.rateLabel({ n: 100, count: 1 }, "slit", {
        mode: "pattern",
        patterns: ["d1"],
        level: 1,
      }),
      "rare",
    );
    check(
      "展開は出す",
      m.rateLabel({ n: 100, count: 20 }, "tenkai", {
        boat: 1,
        technique: "nige",
      }),
      "standard",
    );
    check(
      "進入は出す",
      m.rateLabel({ n: 100, count: 80 }, "entry", { boat: 4, target: "waku" }),
      "standard",
    );
    check(
      "注記の線（展開）",
      m.thresholdNote("tenkai", { boat: 1, technique: "nige" }),
      { standard: 15, rare: 5 },
    );
    check(
      "注記の線（1号艇は出さない）",
      m.thresholdNote("boat1", { outcome: "win" }),
      null,
    );
    check(
      "小分け",
      [
        m.subtypeOf("order", nag),
        m.subtypeOf("order", one),
        m.subtypeOf("slit", { mode: "custom" }),
        m.subtypeOf("entry", {}),
      ],
      ["nagashi", "single", "custom", "entry"],
    );
  },

  storage(m, check) {
    const mem = () => {
      const d = new Map();
      return {
        getItem: (k) => (d.has(k) ? d.get(k) : null),
        setItem: (k, v) => d.set(k, String(v)),
        removeItem: (k) => d.delete(k),
        _d: d,
      };
    };
    const NOW = new Date("2026-10-14T03:00:00Z");
    const DEADLINE = new Date("2026-10-14T05:00:00Z");
    const entry = (over = {}) => ({
      raceId: "2026-10-14-01-01",
      type: "boat1",
      input: { outcome: "win" },
      savedAt: NOW.toISOString(),
      snapshot: { runId: "r1", poolCutoff: "2026-10-13", layerKey: "k1" },
      result: { n: 100, count: 50, excluded: [], label: null, truncated: true },
      ...over,
    });
    const s = mem();
    check(
      "保存できる",
      m.saveEntry(entry(), {
        deadline: DEADLINE,
        finished: false,
        now: NOW,
        storage: s,
      }),
      true,
    );
    check(
      "キーは boatai-user:past-rate-check:v1",
      [...s._d.keys()],
      ["boatai-user:past-rate-check:v1"],
    );
    m.saveEntry(entry({ input: { outcome: "out" } }), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s,
    });
    check(
      "同じレース・同じ型は1件に置き換わる",
      m.loadEntries({ storage: s, now: NOW }).map((e) => e.input.outcome),
      ["out"],
    );
    m.saveEntry(entry({ type: "payout", input: { band: "high" } }), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s,
    });
    check(
      "型が違えば両方残る",
      m.loadEntries({ storage: s, now: NOW }).length,
      2,
    );
    check(
      "締切以降は保存しない",
      m.saveEntry(
        entry({ type: "tenkai", input: { boat: 1, technique: "nige" } }),
        { deadline: DEADLINE, finished: false, now: DEADLINE, storage: s },
      ),
      false,
    );
    check(
      "締切不明で確定済みなら保存しない",
      m.saveEntry(
        entry({ type: "entry", input: { boat: 4, target: "waku" } }),
        { deadline: null, finished: true, now: NOW, storage: s },
      ),
      false,
    );
    check(
      "締切不明で未確定なら保存する",
      m.saveEntry(
        entry({ type: "entry", input: { boat: 4, target: "waku" } }),
        { deadline: null, finished: false, now: NOW, storage: s },
      ),
      true,
    );
    // 30日
    const later = new Date(NOW.getTime() + 31 * 86400000);
    check(
      "30日を過ぎた Entry は読み込みで消える",
      m.loadEntries({ storage: s, now: later }).length,
      0,
    );
    check(
      "消えたことが保存にも反映される",
      JSON.parse(s.getItem("boatai-user:past-rate-check:v1")).entries.length,
      0,
    );
    const d29 = new Date(NOW.getTime() + 29 * 86400000);
    const s2 = mem();
    m.saveEntry(entry(), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s2,
    });
    check("29日なら残る", m.loadEntries({ storage: s2, now: d29 }).length, 1);
    // 上限1,000件（savedAt の古いものから消す）
    const s3 = mem();
    // raceId を変えて重ならない1,000件（boat1、savedAt は古い順）
    const big = Array.from({ length: 1000 }, (_, i) =>
      entry({
        raceId: `2026-10-${String((i % 28) + 1).padStart(2, "0")}-${String((Math.floor(i / 28) % 24) + 1).padStart(2, "0")}-${String(Math.floor(i / 672) + 1).padStart(2, "0")}`,
        savedAt: new Date(NOW.getTime() - (1000 - i) * 1000).toISOString(),
      }),
    );
    s3.setItem(
      "boatai-user:past-rate-check:v1",
      JSON.stringify({ v: 1, entries: big }),
    );
    m.saveEntry(entry({ raceId: "2026-10-14-24-12" }), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s3,
    });
    const after = m.loadEntries({ storage: s3, now: NOW });
    check("上限1,000件", after.length, 1000);
    check(
      "いちばん古いものが消える",
      after.some((e) => e.savedAt === big[0].savedAt),
      false,
    );
    // 壊れた値
    const s4 = mem();
    s4.setItem("boatai-user:past-rate-check:v1", "{not json");
    check(
      "JSON でなければ空として扱う",
      m.loadEntries({ storage: s4, now: NOW }),
      [],
    );
    check(
      "壊れた値は作り直す",
      JSON.parse(s4.getItem("boatai-user:past-rate-check:v1")),
      { v: 1, entries: [] },
    );
    s4.setItem(
      "boatai-user:past-rate-check:v1",
      JSON.stringify({ v: 2, entries: [entry()] }),
    );
    check("v が違えば空", m.loadEntries({ storage: s4, now: NOW }), []);
    s4.setItem(
      "boatai-user:past-rate-check:v1",
      JSON.stringify({
        v: 1,
        entries: [
          entry(),
          entry({ type: "x" }),
          entry({ snapshot: { runId: 1, layerKey: "k1" } }),
          entry({ snapshot: { runId: "r1" } }),
          entry({ result: { n: 1, count: 0, excluded: [], label: null } }),
          entry({ savedAt: "きのう" }),
          entry({ type: "order", input: { outcome: "win" } }),
          entry({
            type: "slit",
            input: { mode: "pattern", patterns: ["zz"], level: 1 },
          }),
        ],
      }),
    );
    check(
      "形の違う Entry だけ捨てる",
      m.loadEntries({ storage: s4, now: NOW }).length,
      1,
    );
    // 例外
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    check(
      "getItem が投げても空",
      m.loadEntries({ storage: throwing, now: NOW }),
      [],
    );
    check(
      "setItem が投げたら保存しない（例外を外へ出さない）",
      m.saveEntry(entry(), {
        deadline: DEADLINE,
        finished: false,
        now: NOW,
        storage: throwing,
      }),
      false,
    );
    // データキャッシュの全削除の後も残る（boatai: で始めない・値がキャッシュの形でない）
    const s5 = mem();
    m.saveEntry(entry(), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s5,
    });
    const key = [...s5._d.keys()][0];
    const parsed = JSON.parse(s5.getItem(key));
    check(
      "clearCache の対象外（接頭辞と値の形）",
      [key.startsWith("boatai:"), "timestamp" in parsed && "data" in parsed],
      [false, false],
    );
    // 振り返り
    const s6 = mem();
    m.saveEntry(entry({ type: "payout", input: { band: "high" } }), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s6,
    });
    m.saveEntry(
      entry({
        type: "order",
        input: { first: 1, second: [2], third: [3], nagashi: false },
      }),
      { deadline: DEADLINE, finished: false, now: NOW, storage: s6 },
    );
    m.saveEntry(entry({ raceId: "2026-10-14-01-02" }), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s6,
    });
    check(
      "振り返りはそのレースだけ、型の順",
      m
        .entriesForRace("2026-10-14-01-01", {
          deadline: DEADLINE,
          storage: s6,
          now: NOW,
        })
        .map((e) => e.type),
      ["order", "payout"],
    );
    const late = mem();
    late.setItem(
      "boatai-user:past-rate-check:v1",
      JSON.stringify({
        v: 1,
        entries: [entry({ savedAt: DEADLINE.toISOString() })],
      }),
    );
    check(
      "savedAt が締切以降の Entry は振り返りに出さない",
      m.entriesForRace("2026-10-14-01-01", {
        deadline: DEADLINE,
        storage: late,
        now: NOW,
      }),
      [],
    );
    check(
      "layer の印の照合（どれか1つでも違えば変わった、run_id は見ない）",
      [
        m.layerChanged([entry()], "k1"),
        m.layerChanged(
          [entry(), entry({ snapshot: { runId: "r1", poolCutoff: "x", layerKey: "k0" } })],
          "k1",
        ),
        // run_id が違っても中身の印が同じなら「変わった」にしない（締切前の作り直し、T0-3）
        m.layerChanged([entry({ snapshot: { runId: "r2", poolCutoff: "x", layerKey: "k1" } })], "k1"),
      ],
      [false, true, false],
    );
  },
  format(m, check) {
    // t は「キー|変数」を返す仮の関数（文言ではなく、どのキーを使ったかを見る）
    const t = (k, o) => (o ? `${k}|${JSON.stringify(o)}` : k);
    check(
      "振り返り: 分母0は空の文（null% にしない）",
      m.savedMainText({ n: 0, count: 0, excluded: [], label: null, truncated: true }, t),
      "aiPredictionTab.pastRate.empty",
    );
    check(
      "振り返り: 分母があれば主文（保存した truncated で前置きを決める）",
      m.savedMainText({ n: 1234, count: 30, excluded: [], label: null, truncated: false }, t),
      'aiPredictionTab.pastRate.main|{"prefix":"aiPredictionTab.pastRate.prefixAll","n":"1,234","count":"30","pct":"2.4"}',
    );
    check("割合は四捨五入で小数1桁", [m.pctText({ n: 2000, count: 412 }), m.pctText({ n: 8, count: 1 }), m.pctText({ n: 0, count: 0 })], ["20.6", "12.5", null]);
    check("着順の組の書き方", m.orderComboText({ first: 1, second: [4, 3], third: [4, 2, 3] }), "1-3,4-2,3,4");
  },
};

// ---------------------------------------------------------------------------
// 変異検証: 要を1つずつ壊したコピーで、同じ検証が失敗すること
// ---------------------------------------------------------------------------
const MUTANTS = [
  ["scenario", "2段目の凹みの線を1段目のままにする", "dent: 8", "dent: 5"],
  [
    "count",
    "ST を整数にせず浮動小数のまま比べる",
    "const c = st.map(stCent);",
    "const c = st.map((v) => v * 100);",
  ],
  ["count", "配当の帯の境界を「以下」にする", "p < 1000", "p <= 1000"],
  [
    "count",
    "決まり手の無い行を不一致に数える（分母に入れる）",
    "if (r.winning_technique == null) return SKIP;",
    "if (r.winning_technique == null) return false;",
  ],
  [
    "count",
    "同時に起きない形を古い方と組む",
    "selected[selected.length - 1]",
    "selected[0]",
  ],
  [
    "count",
    "着順の点数で1着と同じ艇を数える",
    "b !== a && c !== a && c !== b",
    "c !== b",
  ],
  [
    "layer",
    "切り詰めを上限の値で判定する",
    "layer.n_returned < layer.n_total",
    "layer.n_returned >= 2000",
  ],
  ["layer", "race_id を照合しない", "state.data.race_id === raceId", "true"],
  [
    "layer",
    "印を先頭と末尾の行だけで作る",
    "layer.rows.map((r) => ROW_COLS.map((k) => r[k] ?? null)),",
    "[layer.rows[0], layer.rows[layer.rows.length - 1]].map((r) => ROW_COLS.map((k) => r[k] ?? null)),",
  ],
  [
    "label",
    "線を丸めた後の割合で判定する（15%ちょうどの扱いを変える）",
    "count * 100 >= LINES.standard * n",
    "count * 100 > LINES.standard * n",
  ],
  ["label", "1号艇にもラベルを出す", "boat1: NONE,", "boat1: BOTH,"],
  ["format", "分母0でも主文を出す", "result.n > 0 ?", "true ?"],
  ["storage", "30日を過ぎても消さない", "KEEP_DAYS = 30", "KEEP_DAYS = 3000"],
  [
    "storage",
    "締切以降も保存する",
    "if (deadline && now >= deadline) return false;",
    "",
  ],
  [
    "storage",
    "書く直前に読み直さない（置き換えが効かない）",
    "const kept = read(storage, now).filter(",
    "const kept = [].filter(",
  ],
];

const MUTANT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "past-rate-mutants-"));

async function loadMutant(index, target, from, to) {
  const srcPath = path.join(ROOT, TARGETS[target]);
  const source = fs.readFileSync(srcPath, "utf8");
  if (!source.includes(from))
    throw new Error(
      `変異の対象が見つかりません（${TARGETS[target]}）: ${from.slice(0, 60)}`,
    );
  const mutated = source
    .replace(from, to)
    .replace(/from "(\.{1,2}\/[^"]+)"/g, (_, spec) => {
      const href = pathToFileURL(
        path.resolve(path.dirname(srcPath), spec),
      ).href;
      return `from "${href}"`;
    });
  const file = path.join(MUTANT_DIR, `m${index}-${target}.mjs`);
  fs.writeFileSync(file, mutated);
  return import(pathToFileURL(file).href);
}

let failures = 0;
const quiet = console.error;
for (const [target, suite] of Object.entries(SUITES)) {
  console.log(`\n## ${TARGETS[target]}`);
  const mod = await import(
    pathToFileURL(path.join(ROOT, TARGETS[target])).href
  );
  suite(mod, (label, actual, expected) => {
    const a = show(actual);
    const e = show(expected);
    if (a === e) console.log(`✅ ${label}`);
    else {
      failures++;
      console.error(`❌ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
  });
}

console.log("\n## 変異検証");
for (const [i, [target, name, from, to]] of MUTANTS.entries()) {
  let killed = false;
  let detail = "検出されなかった（この変異を入れても検証が通る）";
  try {
    const mod = await loadMutant(i, target, from, to);
    let failed = 0;
    console.error = () => {}; // 保存の失敗の console.error を変異検証では黙らせる
    try {
      SUITES[target](mod, (_label, actual, expected) => {
        if (show(actual) !== show(expected)) failed++;
      });
    } catch {
      failed++;
    } finally {
      console.error = quiet;
    }
    killed = failed > 0;
  } catch (error) {
    detail = error.message;
  }
  if (killed) console.log(`✅ 変異検証（${target}）: 「${name}」を検出できる`);
  else {
    failures++;
    console.error(`❌ 変異検証（${target}）: 「${name}」\n  ${detail}`);
  }
}

fs.rmSync(MUTANT_DIR, { recursive: true, force: true });
console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
