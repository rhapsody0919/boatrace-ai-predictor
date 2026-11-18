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
import { row } from "./verifyData/past-rate-count-fixtures.js";
import { countSuite } from "./verifyData/past-rate-count-count.js";
import { storageSuite } from "./verifyData/past-rate-count-storage.js";

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

  count: countSuite,

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

  storage: storageSuite,
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
  ["count", "着順の組の2着を並べ替えない", "[...second].sort((x, y) => x - y)", "[...second]"],
  ["count", "着順の組の3着を並べ替えない", "[...third].sort((x, y) => x - y)", "[...third]"],
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
// 仕様が未定の入力は観測だけ行い、SUITES・変異検証・failures には含めない。
const KNOWN_GAPS = [
  { input: { first: 2, second: [1, 1], third: [3] }, spec: "欄内の重複の扱いは未定（画面では足し外し）" },
  { input: { first: "1", second: [1], third: [2] }, spec: "1着が文字列のときの同一艇判定は未定" },
  { input: undefined, spec: "入力がundefinedのときの扱いは未定" },
];
const countModule = await import(pathToFileURL(path.join(ROOT, TARGETS.count)).href);
console.log(`\n## KNOWN_GAPS（${KNOWN_GAPS.length}件、合否判定の対象外）`);
for (const { input, spec } of KNOWN_GAPS) {
  let current;
  try {
    current = { combos: countModule.orderCombos(input), points: countModule.orderPoints(input) };
  } catch (error) {
    current = { exception: error.name };
  }
  console.log(`- 入力: ${show(input) ?? "undefined"} / 仕様: ${spec} / 今の値: ${show(current)}`);
}
console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
