#!/usr/bin/env node
/**
 * verify-accident-rate.js — 選手の今期の事故率（目安、BOA-327）を固定する。
 *
 * 1. src/utils/accidentRate.js の純関数
 *    - 今期の期間（5/1・11/1 の境目、to は表示中のレースの日）
 *    - 公式の配点（F・L1 20、優勝戦の F・L1 30、S2 15、S1・K1 10、選手責任外 0）
 *    - 2025-05-01 以降の期だけ、期内2本目以降の F に +10（優勝戦なら +20）。F は race_id 順に数える
 *    - 事故率は小数第2位で切り捨て（40÷57=0.7018 は 0.70 で、超えではない。2025-2期の実測で B1）
 *    - 「あと何点」= ceil(0.71×出走) − 事故点（0未満は0）
 *    - 目印: 超え・ライン付近（事故点1点以上で、あと20点以内）。出走30走未満は行に出さない
 *    - 期待値には、2026-10-03 の本番データを data-accuracy-verifier が独立に組み直して一致を確かめた値を使う
 * 2. docs/db-migration/126 の RPC を PGlite（インメモリの Postgres）で実行し、出走回数の数え方
 *    （01〜06・F・L1・K1・S1・S2。S0・L0・K0・00 は数えない）、事故の走の一覧、期間（to の日を含めない）、
 *    匿名への EXECUTE を確かめる
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCIDENT_BADGE_MIN_STARTS,
  computeAccidentStats,
  currentPeriodRange,
} from "../../src/utils/accidentRate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inc = (code, race_id, stage = "予選") => ({ race_id, code, stage });
const NOW = currentPeriodRange("2026-10-03");

// 1. 期間
check(
  "今期の期間: 5〜10月は5/1から、11〜12月は11/1から、1〜4月は前年の11/1から。to はレースの日",
  same(NOW, { from: "2026-05-01", to: "2026-10-03" }) &&
    same(currentPeriodRange("2026-11-01"), {
      from: "2026-11-01",
      to: "2026-11-01",
    }) &&
    same(currentPeriodRange("2027-04-30"), {
      from: "2026-11-01",
      to: "2027-04-30",
    }) &&
    same(currentPeriodRange("2026-05-01"), {
      from: "2026-05-01",
      to: "2026-05-01",
    }),
);

// 2. 本番の実例（2026-10-03 びわこ8R ほか。data-accuracy-verifier で独立に一致を確認した値）
const takayama = computeAccidentStats(
  {
    starts: 64,
    incidents: [
      inc("S1", "2026-05-11-23-02"),
      inc("F", "2026-06-11-03-10"),
      inc("S1", "2026-09-02-24-04"),
    ],
  },
  NOW,
);
check(
  "5242（高山弘斗）: 出走64・F1・失格2 → 事故点40・0.62・あと6点・ライン付近（行に出す）",
  takayama.points === 40 &&
    takayama.rate === 0.62 &&
    takayama.need === 6 &&
    takayama.status === "near" &&
    takayama.showBadge === true,
  JSON.stringify(takayama),
);
const torimoto = computeAccidentStats(
  {
    starts: 38,
    incidents: [inc("F", "2026-05-30-11-03"), inc("S1", "2026-07-01-01-01")],
  },
  NOW,
);
check(
  "5430（鳥本智史）: 出走38・F1・失格1 → 事故点30・0.78・超え（行に出す）",
  torimoto.points === 30 &&
    torimoto.rate === 0.78 &&
    torimoto.status === "over" &&
    torimoto.need === 0 &&
    torimoto.showBadge === true,
  JSON.stringify(torimoto),
);
const s4641 = computeAccidentStats(
  {
    starts: 31,
    incidents: [
      inc("F", "2026-05-11-20-01"),
      inc("F", "2026-05-27-17-08"),
      inc("S1", "2026-06-01-01-01"),
    ],
  },
  NOW,
);
check(
  "4641: 出走31・F2・失格1 → 2本目のFに+10で事故点60・1.93",
  s4641.points === 60 && s4641.rate === 1.93,
  JSON.stringify(s4641),
);

// 3. 優勝戦
const s3621 = computeAccidentStats(
  {
    starts: 100,
    incidents: [
      inc("F", "2026-06-08-21-12", "優勝戦"),
      inc("F", "2026-05-23-01-05", "予選"),
    ],
  },
  NOW,
);
check(
  "3621: 通常のF（1本目20）＋優勝戦のF（2本目 30+20）＝70。並びが逆でも race_id 順に数える",
  s3621.points === 70,
  String(s3621.points),
);
check(
  "優勝戦の判定: 準優勝戦・準々優勝戦・準優進出戦のFは優勝戦の配点にしない。会場の接頭（ＭＤ優勝戦）は優勝戦",
  computeAccidentStats(
    { starts: 50, incidents: [inc("F", "a", "準優勝戦")] },
    NOW,
  ).points === 20 &&
    computeAccidentStats(
      { starts: 50, incidents: [inc("F", "a", "準々優勝戦")] },
      NOW,
    ).points === 20 &&
    computeAccidentStats(
      { starts: 50, incidents: [inc("F", "a", "準優進出戦")] },
      NOW,
    ).points === 20 &&
    computeAccidentStats(
      { starts: 50, incidents: [inc("F", "a", "ＭＤ優勝戦")] },
      NOW,
    ).points === 30 &&
    computeAccidentStats(
      { starts: 50, incidents: [inc("L1", "a", "優勝戦")] },
      NOW,
    ).points === 30,
);
check(
  "配点: S2（妨害失格）15・S1/K1 10・L1 20",
  computeAccidentStats(
    {
      starts: 100,
      incidents: [
        inc("S2", "a"),
        inc("S1", "b"),
        inc("K1", "c"),
        inc("L1", "d"),
      ],
    },
    NOW,
  ).points === 55,
);

// 4. 改正前の期は2本目以降のFに加点しない
check(
  "2025-05-01 より前に始まった期（2024-11-01〜）は、2本目のFに加点しない",
  computeAccidentStats(
    { starts: 60, incidents: [inc("F", "a"), inc("F", "b")] },
    { from: "2024-11-01", to: "2025-03-01" },
  ).points === 40 &&
    computeAccidentStats(
      { starts: 60, incidents: [inc("F", "a"), inc("F", "b")] },
      { from: "2025-05-01", to: "2025-09-01" },
    ).points === 50,
);

// 5. 切り捨てと境目
const s5470 = computeAccidentStats(
  {
    starts: 57,
    incidents: [inc("F", "a"), inc("S1", "b"), inc("K1", "c")],
  },
  NOW,
);
check(
  "5470: 40÷57=0.7018 は小数第2位で切り捨てて 0.70。超えではなく、あと1点（2025-2期に同じ比の2人がB1の実測）",
  s5470.rate === 0.7 && s5470.status === "near" && s5470.need === 1,
  JSON.stringify(s5470),
);
check(
  "出走0: 事故率は null、目印なし",
  (() => {
    const z = computeAccidentStats({ starts: 0, incidents: [] }, NOW);
    return z.rate === null && z.status === null && z.showBadge === false;
  })(),
);
check(
  "事故点0の選手は「ライン付近」にしない（出走8走で、Fを1本切れば超える選手でも）",
  computeAccidentStats({ starts: 8, incidents: [] }, NOW).status === null,
);
check(
  `行の目印は出走${ACCIDENT_BADGE_MIN_STARTS}走以上だけ（F1本の28走は超えだが行には出さない。開いた欄用の status は付ける）`,
  (() => {
    const a = computeAccidentStats(
      { starts: 28, incidents: [inc("F", "a")] },
      NOW,
    );
    const b = computeAccidentStats(
      { starts: 30, incidents: [inc("F", "a"), inc("S1", "b")] },
      NOW,
    );
    return (
      a.status === "over" &&
      a.settled === false &&
      a.showBadge === false &&
      b.status === "over" &&
      b.settled === true &&
      b.showBadge === true
    );
  })(),
);
// Fの無い選手（失格5回＝事故点50）。次の1走のF（20点）は出走にも数えるので、(50+20)÷(出走+1) で判定する。
// 出走97: 70÷98=0.714 で超える → ライン付近。出走98: 70÷99=0.707 は切り捨てて0.70 → 超えないのでライン付近にしない
const fiveS = ["a", "b", "c", "d", "e"].map((id) => inc("S1", id));
const at97 = computeAccidentStats({ starts: 97, incidents: fiveS }, NOW);
const at98 = computeAccidentStats({ starts: 98, incidents: fiveS }, NOW);
check(
  "ライン付近の判定は、次の1走も出走に数える（Fの無い選手: 出走97はライン付近、出走98は付けない）",
  at97.status === "near" && at98.status === null && at98.need === 20,
  JSON.stringify({ at97, at98 }),
);
// 蜂須瑞生（2026-10-04 本番）: F1・出走70・事故点20。次のF（30点）でも 50÷71=0.704 → 0.70 で超えない
const hachisu = computeAccidentStats(
  { starts: 70, incidents: [inc("F", "a")] },
  NOW,
);
check(
  "F1・出走70・事故点20（あと30点）は、次のFでも 50÷71=0.704 で超えないのでライン付近にしない（ファン評価3周目）",
  hachisu.need === 30 && hachisu.status === null && hachisu.showBadge === false,
  JSON.stringify(hachisu),
);

// 今期すでにFを切っている選手は、次のFが30点（2本目以降の加点）。河内一馬（2026-10-05 本番）: F1・失格1で
// 事故点30・出走76 → あと24点。次のFで (30+30)÷76=0.78 になり超えるので「ライン付近」にする（ファン評価2周目）
const kawachi = computeAccidentStats(
  { starts: 76, incidents: [inc("F", "a"), inc("S1", "b")] },
  NOW,
);
check(
  "F持ちの選手は、あと30点以内なら「ライン付近」（次のFは2本目以降の加点込みで30点）",
  kawachi.points === 30 &&
    kawachi.need === 24 &&
    kawachi.status === "near" &&
    kawachi.showBadge === true,
  JSON.stringify(kawachi),
);
check(
  "改正前の期は、F持ちでも次のFは20点（あと21点ならライン付近にしない）",
  (() => {
    const r = computeAccidentStats(
      {
        starts: 100,
        incidents: [
          inc("F", "a"),
          inc("S1", "b"),
          inc("S1", "c"),
          inc("S1", "d"),
        ],
      },
      { from: "2024-11-01", to: "2025-03-01" },
    );
    return r.points === 50 && r.need === 21 && r.status === null;
  })(),
);

// 6. RPC（PGlite）
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch (e) {
  console.error(`@electric-sql/pglite を読み込めません: ${e.message}`);
  process.exit(1);
}
const migration = fs.readFileSync(
  path.join(ROOT, "docs/db-migration/126_get_racer_accident_records.sql"),
  "utf8",
);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE race_entries (race_id varchar(20), boat_number smallint, racer_id integer);
CREATE TABLE race_start_timings (race_id varchar(20), boat_number smallint, official_finish_code text);
CREATE TABLE race_conditions (race_id varchar(20), race_stage varchar(30));
GRANT SELECT ON race_entries, race_start_timings, race_conditions TO anon, authenticated;
`);
const rows = [
  // racer 1: 着順4走（01〜06）＋F（優勝戦）＋S0（責任外）＋L0＋K0＋00＋S1＋K1＋L1＋S2
  ["2026-05-02-01-01", 1, 1, "01", "予選"],
  ["2026-05-02-01-02", 1, 1, "06", "予選"],
  ["2026-05-03-01-01", 2, 1, "03", "予選"],
  ["2026-05-03-01-02", 2, 1, "02", "予選"],
  ["2026-05-04-01-12", 3, 1, "F", "優勝戦"],
  ["2026-05-05-01-01", 1, 1, "S0", "予選"],
  ["2026-05-05-01-02", 1, 1, "L0", "予選"],
  ["2026-05-05-01-03", 1, 1, "K0", "予選"],
  ["2026-05-05-01-04", 1, 1, "00", "予選"],
  ["2026-05-06-01-01", 1, 1, "S1", "予選"],
  ["2026-05-06-01-02", 1, 1, "K1", "予選"],
  ["2026-05-06-01-03", 1, 1, "L1", "予選"],
  ["2026-05-06-01-04", 1, 1, "S2", null],
  // 期間外（前期・表示中のレースの日）は数えない
  ["2026-04-30-01-01", 1, 1, "F", "予選"],
  ["2026-10-03-01-01", 1, 1, "F", "予選"],
  // racer 2: 事故なし
  ["2026-05-02-01-01", 2, 2, "01", "予選"],
  // 別の選手（引数に含めない）
  ["2026-05-02-01-01", 3, 9, "F", "予選"],
];
for (const [rid, boat, racer, code, stage] of rows) {
  await db.query("INSERT INTO race_entries VALUES ($1, $2, $3)", [
    rid,
    boat,
    racer,
  ]);
  await db.query("INSERT INTO race_start_timings VALUES ($1, $2, $3)", [
    rid,
    boat,
    code,
  ]);
  await db.query(
    "INSERT INTO race_conditions SELECT $1::varchar, $2::varchar WHERE NOT EXISTS (SELECT 1 FROM race_conditions WHERE race_id = $1::varchar)",
    [rid, stage],
  );
}
await db.exec(migration);
await db.exec("SET ROLE anon");
const res = await db.query(
  "SELECT racer_id, starts, incidents FROM get_racer_accident_records(ARRAY[1, 2], '2026-05-01', '2026-10-03') ORDER BY racer_id",
);
await db.exec("RESET ROLE");
const r1 = res.rows.find((r) => r.racer_id === 1);
const r2 = res.rows.find((r) => r.racer_id === 2);
check(
  "RPC: 匿名から呼べ、引数の選手だけを返す",
  res.rows.length === 2 && !res.rows.some((r) => r.racer_id === 9),
  JSON.stringify(res.rows.map((r) => r.racer_id)),
);
check(
  "RPC: 出走回数は 01〜06・F・L1・K1・S1・S2（4+1+4=9）。S0・L0・K0・00 と期間外は数えない",
  r1?.starts === 9,
  String(r1?.starts),
);
check(
  "RPC: 事故の走は F・S1・K1・L1・S2 の5件を race_id 順に、レース種別つきで返す",
  same(
    (r1?.incidents ?? []).map((i) => [i.code, i.stage]),
    [
      ["F", "優勝戦"],
      ["S1", "予選"],
      ["K1", "予選"],
      ["L1", "予選"],
      ["S2", null],
    ],
  ),
  JSON.stringify(r1?.incidents),
);
check(
  "RPC: 事故の無い選手は incidents が空配列",
  r2?.starts === 1 && same(r2?.incidents, []),
  JSON.stringify(r2),
);
check(
  "RPC の行をそのまま computeAccidentStats に渡せる（racer 1: 優勝戦F30＋S1 10＋K1 10＋L1 20＋S2 15＝85）",
  computeAccidentStats(r1, NOW).points === 85,
  String(computeAccidentStats(r1, NOW).points),
);
await db.close();

if (failures > 0) {
  console.log(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全件成功");
