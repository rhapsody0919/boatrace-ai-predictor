/**
 * アナロジー・ファインダーのレースごとの寄与度（BOA-271 FR-1b、ADR-0083）の JS が、学習側の Python と同じ値を出すことを、
 * 小さな固定モデルと DB の行の形の固定データ（scripts/ml/analogy/testdata/treeshap-parity/、make_treeshap_testdata.py が作る）で検証する。
 * 実DBに触らない。本番の版ごとの検査は、学習ジョブが同じ treeshap-parity.js を本番のモデルと固定データで呼ぶ。
 *
 * 1. 固定データで一致する（特徴量は完全一致、TreeSHAP は最大差 < 1e-9、SHAP の合計＝生スコア）。
 *    固定データにはカテゴリ分岐（学習に出ない値・負の値・欠損）、欠損の向き（NaN・None）、直前情報の列の分岐、
 *    無風（風向が空で風速0）・風向が空で風速>0・風速が空・未知の天候・展示タイムの同値と欠け・数値の文字列が入っている
 * 2. 検査が素通りしない: 期待値を1e-8ずらす・展示タイムを1件変える・平均を float64 で取ると、不一致になる
 * 3. CLI の終了コード: 一致 0、不一致 1、入力の不備 2（学習ジョブはこれで版の切り替えを止める）
 * 4. 直前情報8列の約束（features.py と同じ）: 無風・風向が空の扱い、同値の順位は min、欠損は平均と順位から除く
 * 5. テーマ集計: シェアの合計1、中心化した艇ごとの値の合計0、モデルに無い列のグループは出さない、テーマに無い列は失敗
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  aggregateRaceContribution,
  boatMostRaisedBy,
} from "../../src/utils/analogyRaceContribution.js";
import {
  buildLiveFeatures,
  meanFloat32,
  windComponents,
} from "../../src/utils/analogyRaceFeatures.js";
import { ParityInputError, checkParity, checkParityDir } from "../ml/analogy/treeshap-parity.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "scripts/ml/analogy/testdata/treeshap-parity");
const CLI = join(ROOT, "scripts/ml/analogy/treeshap-parity.js");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};
const readGz = (p) => JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));
const load = () => {
  const meta = JSON.parse(
    readFileSync(join(DIR, "per_race_meta.json"), "utf8"),
  );
  return {
    meta,
    dumps: {
      win: readGz(join(DIR, meta.models.win.file)),
      win_racecard: readGz(join(DIR, meta.models.win_racecard.file)),
    },
    fixture: readGz(join(DIR, "parity_fixture.json.gz")),
  };
};

// 1. 固定データで一致する
const base = checkParityDir(DIR);
check(
  `固定データ ${base.races}R で JS と Python が一致する（SHAP の最大差 win ${base.models.win.max_abs_contrib_diff}、win_racecard ${base.models.win_racecard.max_abs_contrib_diff}）`,
  base.ok && base.races > 0 && base.models.win.boats === base.races * 6,
);

// 2. 検査が素通りしない
{
  const d = load();
  d.fixture.races[3].expected.win.contrib[2][5] += 1e-8;
  const r = checkParity(d);
  check(
    "SHAP の期待値を 1e-8 ずらすと不一致になる",
    !r.ok && r.models.win.max_abs_contrib_diff >= 1e-9,
  );
}
{
  const d = load();
  const ex = d.fixture.races[5].live_raw.exhibition[0];
  ex.exhibition_time = Number(ex.exhibition_time) + 0.01;
  const r = checkParity(d);
  check(
    "展示タイムを1件 0.01 変えると特徴量の不一致になる",
    !r.ok && r.models.win.feature_mismatches > 0,
  );
}
{
  // 平均を float64 で取る誤り（ADR-0083 決定5 で避けたもの）を、固定データの期待値が見分けられること
  const d = load();
  let differs = 0;
  for (const race of d.fixture.races) {
    const live = buildLiveFeatures({
      boatNumbers: [1, 2, 3, 4, 5, 6],
      exhibition: race.live_raw.exhibition,
      conditions: race.live_raw.conditions,
    });
    const exh = live.map((l) => l.exh_time).filter((v) => !Number.isNaN(v));
    const mean64 = exh.reduce((a, b) => a + b, 0) / exh.length;
    const col = d.meta.models.win.feature_names.indexOf("exh_time_diff");
    live.forEach((l, i) => {
      const wrong = Math.fround(l.exh_time - mean64);
      const expected = race.expected.win.features[i][col];
      if (expected !== null && wrong !== expected) differs += 1;
    });
  }
  check(
    `平均を float64 で取ると、固定データの差の列が ${differs} 艇で食い違う（検査が見分けられる）`,
    differs > 0,
  );
}

{
  // 展示タイムの欠けた艇（JS は NaN）の最後の列を落としても、欠損と同じ扱いで素通りしないこと
  const d = load();
  const race =
    d.fixture.races.find((r) =>
      r.expected.win.features.some((row) => row.at(-1) === null),
    ) ?? d.fixture.races[0];
  race.expected.win.features[0].pop();
  let threw = false;
  try {
    checkParity(d);
  } catch (e) {
    threw = e instanceof ParityInputError;
  }
  check("expected.features の列が欠けていれば入力の不備として失敗する", threw);
}

// 3. CLI の終了コード
const exitCode = (dir) => {
  try {
    execFileSync(process.execPath, [CLI, dir], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status;
  }
};
{
  check("CLI: 一致なら終了コード0", exitCode(DIR) === 0);
  const tmp = mkdtempSync(join(tmpdir(), "treeshap-parity-"));
  try {
    cpSync(DIR, tmp, { recursive: true });
    const d = load();
    d.fixture.races[0].expected.win_racecard.contrib[0][0] += 1e-6;
    rmSync(join(tmp, "parity_fixture.json.gz"));
    writeFileSync(join(tmp, "parity_fixture.json"), JSON.stringify(d.fixture));
    check(
      "CLI: 不一致なら終了コード1（.json の固定データも読む）",
      exitCode(tmp) === 1,
    );
    rmSync(join(tmp, "parity_fixture.json"));
    check("CLI: 固定データが無ければ終了コード2", exitCode(tmp) === 2);
    const meta = JSON.parse(
      readFileSync(join(DIR, "per_race_meta.json"), "utf8"),
    );
    writeFileSync(join(tmp, "parity_fixture.json"), JSON.stringify(d.fixture));
    writeFileSync(
      join(tmp, "per_race_meta.json"),
      JSON.stringify({ ...meta, dtype: "float64" }),
    );
    check("CLI: dtype が float32 でなければ終了コード2", exitCode(tmp) === 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 4. 直前情報8列の約束
{
  check(
    "無風: 風向が空で風速0 → 0",
    JSON.stringify(windComponents(null, 0)) === '{"wind_x":0,"wind_y":0}',
  );
  check(
    "無風: 風向が「無風」→ 0",
    JSON.stringify(windComponents("無風", null)) === '{"wind_x":0,"wind_y":0}',
  );
  check("空文字の風向は空と同じ", windComponents("", "0.0").wind_x === 0);
  const w = windComponents(null, 3);
  check(
    "風向が空で風速>0 → NaN",
    Number.isNaN(w.wind_x) && Number.isNaN(w.wind_y),
  );
  check("風速が空 → NaN", Number.isNaN(windComponents("北", null).wind_y));
  check(
    "北の風速2 → wind_y=2・wind_x=0",
    windComponents("北", 2).wind_y === 2 &&
      windComponents("北", 2).wind_x === 0,
  );

  const live = buildLiveFeatures({
    boatNumbers: [1, 2, 3, 4, 5, 6],
    exhibition: [
      { boat_number: 1, exhibition_time: 6.7 },
      { boat_number: 2, exhibition_time: "6.70" },
      { boat_number: 3, exhibition_time: 6.65 },
      { boat_number: 4, exhibition_time: null },
      { boat_number: 6, exhibition_time: 6.8 },
    ],
    conditions: {
      weather: "雨",
      wind_direction: "東",
      wind_speed: "4.0",
      wave_height: 5,
    },
  });
  check(
    "同値の順位は min、欠損は順位も差も NaN",
    JSON.stringify(live.map((l) => l.exh_time_rank)) ===
      "[2,2,1,null,null,4]" &&
      Number.isNaN(live[3].exh_time_diff) &&
      Number.isNaN(live[4].exh_time),
  );
  const mean = meanFloat32([6.7, 6.7, 6.65, 6.8].map(Math.fround));
  check(
    "差は欠損を除いた float32 の平均から",
    live[0].exh_time_diff === Math.fround(Math.fround(6.7) - mean),
  );
  check(
    "天候・風速・波高は全艇同じ値（float32）",
    live.every(
      (l) => l.weather_code === 2 && l.wind_speed === 4 && l.wave_height === 5,
    ),
  );
  let threw = false;
  try {
    buildLiveFeatures({ boatNumbers: [2, 1], exhibition: [], conditions: {} });
  } catch {
    threw = true;
  }
  check(
    "艇番が昇順でなければ失敗する（平均の足し順が pandas と変わるため）",
    threw,
  );
}

// 5. テーマ集計
{
  const themes = [
    {
      key: "a",
      groups: [
        { key: "a1", features: ["x"] },
        { key: "a2", features: ["y"] },
      ],
    },
    {
      key: "b",
      groups: [
        { key: "b1", features: ["z"] },
        { key: "b2", features: ["live"] },
      ],
    },
  ];
  const featureNames = ["x", "y", "z"];
  const contribs = [
    [0.3, -0.1, 0.2, -1],
    [0.1, 0.1, 0.0, -1],
    [-0.4, 0.0, -0.2, -1],
  ];
  const r = aggregateRaceContribution({
    featureNames,
    contribs,
    boatNumbers: [1, 2, 3],
    themes,
  });
  const shareSum = r.theme_shares.a + r.theme_shares.b;
  check("テーマのシェアの合計は1", Math.abs(shareSum - 1) < 1e-12);
  // 中心化: x の平均0 → |0.3|+|0.1|+|0.4|=0.8、y の平均0 → 0.2、z の平均0 → 0.4。a=1.0/1.4
  check(
    "シェアは中心化した |SHAP| の和の比",
    Math.abs(r.theme_shares.a - 1.0 / 1.4) < 1e-12,
  );
  const sumA = r.boats.reduce((s, b) => s + b.themes.a, 0);
  check("中心化した艇ごとの値の合計は0", Math.abs(sumA) < 1e-12);
  check(
    "モデルに列が無いグループは出さない",
    !("b2" in r.boats[0].groups) && "b1" in r.boats[0].groups,
  );
  check(
    "グループが最も押し上げた艇",
    boatMostRaisedBy(r.boats, "b1")?.boat_number === 1,
  );
  check(
    "どの艇も押し上げていなければ null",
    boatMostRaisedBy(
      r.boats.map((b) => ({ ...b, groups: { b1: -Math.abs(b.groups.b1) } })),
      "b1",
    ) === null,
  );
  let threw = false;
  try {
    aggregateRaceContribution({
      featureNames: ["x", "w"],
      contribs: [
        [1, 2, 0],
        [0, 1, 0],
      ],
      boatNumbers: [1, 2],
      themes,
    });
  } catch {
    threw = true;
  }
  check("どのテーマにも無い列があれば失敗する（黙って落とさない）", threw);

  // 固定データの本物の SHAP でも、シェアの合計が1になる
  const { meta, fixture } = load();
  const race = fixture.races[0];
  const agg = aggregateRaceContribution({
    featureNames: meta.models.win.feature_names,
    contribs: race.expected.win.contrib,
    boatNumbers: [1, 2, 3, 4, 5, 6],
    themes: meta.themes,
  });
  check(
    "固定データの win でテーマ6つのシェアの合計が1",
    Object.keys(agg.theme_shares).length === meta.themes.length &&
      Math.abs(Object.values(agg.theme_shares).reduce((a, b) => a + b, 0) - 1) <
        1e-12,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
