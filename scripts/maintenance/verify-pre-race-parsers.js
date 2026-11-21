/**
 * verify-pre-race-parsers.js - 出走表・直前情報の全項目パーサー・行の組み立て・DDL案・書き込み経路の検証
 * （docs/design/pre-race-full-fields/plan.md）。DBにも取得先にも接続しない（フィクスチャとインメモリのクライアントだけ）。
 *
 * 確認すること:
 *   (a) 全項目の解析: 実ページ（フィクスチャ。出走表6件、直前情報5件）で、選手の登録体重・支部/出身地・F数・L数・
 *       欠場の表示・締切予定時刻・距離・ラベル、展示進入（スタート展示の行順）・展示STのF表記・前走の着順の生表記・
 *       部品交換・気象が、公式ページの表示どおりに取れる
 *   (b) 旧解析との互換（出走表10件・直前情報5件と気象だけの6ページ）: 旧実装（凍結。__fixtures__/raceInfo/legacyRaceListParser.js・__fixtures__/beforeinfo/
 *       legacyExhibitionParser.js）と、既存の列の値が同じ（全フィクスチャ+気象だけの6ページ）
 *   (c) 行の組み立て: 旧形式（081・082未適用）の行が、旧実装の行と同じ。拡張の行は、旧形式の行に新しい列だけを加える
 *   (d) 書き込み経路: A1（update-race-info.js）・A2（scrape-exhibition-data.js）が、081・082の未適用のDBで旧実装と同じ列だけを
 *       書いて壊れず、適用済みのDBで新しい列も書く。再実行は書き込み0件（変更の無い行は書かない）。確認の通信エラーは旧形式で書く。
 *       締切予定時刻が races.start_time と違うレースだけ start_time を更新する
 *   (e) DDL案とコードの整合: 081・082が追加する列・CHECKの値が、コードが書く列・値と一致する
 *   (f) 変異検証: パーサー・行の組み立てを壊した版で、上の検証が失敗する
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as realListParser from "../lib/raceListParser.js";
import * as realBeforeParser from "../lib/beforeInfoParser.js";
import * as realRows from "../lib/preRaceRows.js";







import { BEFORE_FILES, BEFORE_CASES, runPreRaceParsersScenes1 } from "./verifyData/pre-race-parsers-scenes-1.js";
import {
  NEW_ENTRY_KEYS,
  NEW_CONDITION_KEYS,
  NEW_EXHIBITION_KEYS,
  ALL_NEW_COLUMNS,
  runPreRaceParsersScenes2,
} from "./verifyData/pre-race-parsers-scenes-2.js";
import { runPreRaceParsersScenes3 } from "./verifyData/pre-race-parsers-scenes-3.js";
import { runPreRaceParsersScenes4, runPreRaceParsersScenes5 } from "./verifyData/pre-race-parsers-scenes-4.js";
import {
  runPreRaceParsersScenes6,
  runPreRaceParsersScenes7,
  runPreRaceParsersScenes8,
} from "./verifyData/pre-race-parsers-scenes-5.js";

// 検証対象のコードが出す警告・進捗のログで出力が埋まらないよう、検証中は無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__");
const readFixture = (dir, name) =>
  fs.readFileSync(path.join(FIXTURES, dir, name), "utf8");
const listFixtures = (dir, filter = () => true) =>
  fs
    .readdirSync(path.join(FIXTURES, dir))
    .filter((f) => f.endsWith(".html") && filter(f));

// ---------------------------------------------------------------------------
// フィクスチャの期待値（公式ページの表示から、2026-09-21に手で確認したもの）
// ---------------------------------------------------------------------------
const LIST_FILES = {
  absent: "racelist-2026-09-16-23-12-absent.html",
  stabilizer: "racelist-2026-09-21-10-04-stabilizer-1200m.html",
  dash: "racelist-2026-06-02-05-01-avgst-dash.html",
  boatChanged: "racelist-2026-09-21-16-07-boat-changed-no-marker.html",
  l1: "racelist-2026-06-19-02-04-l1.html",
  preliminary: "racelist-preliminary.html",
};
const LIST_CASES = [
  {
    file: LIST_FILES.absent,
    meta: {
      raceTitle: "唐津うまかもんカップ",
      raceStage: "ドリーム",
      seriesDay: 1,
      totalDays: 5,
      distanceM: 1800,
      labels: [],
    },
    deadlines:
      "08:44,09:10,09:36,10:02,10:28,10:59,11:35,12:05,12:33,13:05,13:39,14:21",
    is_absent: [true, false, false, false, false, false],
    weight_kg: [55.2, 55.1, 52.2, 52.9, 52.5, 55.6],
    branch: ["福岡", "愛知", "大阪", "兵庫", "東京", "兵庫"],
    hometown: ["福岡", "愛知", "大阪", "兵庫", "千葉", "兵庫"],
    f_count: [0, 1, 0, 0, 0, 0],
    l_count: [0, 0, 0, 0, 0, 0],
    avg_st: [0.13, 0.15, 0.17, 0.14, 0.15, 0.14],
  },
  {
    file: LIST_FILES.stabilizer,
    meta: {
      raceTitle: "絶好調者三国ダービー",
      raceStage: "みくにあさ推し",
      seriesDay: 2,
      totalDays: 6,
      distanceM: 1200,
      labels: [{ text: "安定板使用", type: "is-type1" }],
    },
    deadlines:
      "08:32,08:58,09:24,09:50,10:18,10:50,11:19,11:51,12:25,13:00,13:31,14:09",
    is_absent: [false, false, false, false, false, false],
    weight_kg: [55.5, 52.2, 52.4, 52.3, 52.5, 52.6],
    branch: ["静岡", "東京", "群馬", "滋賀", "佐賀", "福岡"],
    hometown: ["静岡", "茨城", "長野", "滋賀", "佐賀", "福岡"],
    f_count: [0, 1, 0, 1, 1, 0],
    l_count: [0, 0, 0, 0, 0, 0],
    avg_st: [0.15, 0.18, 0.19, 0.17, 0.19, 0.17],
  },
  {
    // 平均STが「-」（集計期間内にデータなし）の選手。当地未経験は 0.00（NULLではない）
    file: LIST_FILES.dash,
    meta: {
      raceTitle: "オールレディースリップルカップ",
      raceStage: "予選",
      seriesDay: 4,
      totalDays: 6,
      distanceM: 1800,
      labels: [],
    },
    deadlines:
      "11:55,12:23,12:52,13:21,13:51,14:20,14:56,15:26,16:04,16:41,17:11,17:43",
    is_absent: [false, false, false, false, false, false],
    weight_kg: [47.6, 49.3, 46, 52.2, 46, 55.2],
    branch: ["岡山", "東京", "岡山", "埼玉", "群馬", "愛知"],
    hometown: ["岡山", "千葉", "岡山", "北海道", "栃木", "愛知"],
    f_count: [0, 0, 0, 0, 0, 0],
    l_count: [0, 0, 0, 0, 0, 0],
    avg_st: [0.2, 0.17, 0.15, 0.19, 0.21, null],
    local_win_rate: [3.88, 3.98, 0, 1.25, 2.44, 0],
  },
  {
    // ボート変更（5号艇: 30→42）のあったページ。赤の表示は無い
    file: LIST_FILES.boatChanged,
    meta: {
      raceTitle: "日刊スポーツ杯・ニッカン・コム杯",
      raceStage: "一般",
      seriesDay: 5,
      totalDays: 6,
      distanceM: 1800,
      labels: [],
    },
    deadlines:
      "10:54,11:25,11:55,12:23,12:54,13:23,14:00,14:32,15:05,15:40,16:12,16:50",
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52, 56.2, 55, 53.5, 52.3, 52.3],
    branch: ["大阪", "長崎", "山口", "長崎", "東京", "徳島"],
    hometown: ["大阪", "長崎", "山口", "長崎", "東京", "徳島"],
    f_count: [0, 0, 1, 1, 0, 0],
    l_count: [0, 0, 0, 0, 0, 0],
    avg_st: [0.18, 0.16, 0.15, 0.16, 0.15, 0.15],
    boat_number_id: [24, 63, 55, 13, 42, 75],
  },
  {
    // L数が1の選手（5号艇。L1の表記の実例）。F1の選手（1・6号艇）も
    file: LIST_FILES.l1,
    meta: {
      raceTitle: "ヴィーナスシリーズ第６戦戸田中央メディックス埼玉杯",
      raceStage: "予選",
      seriesDay: 2,
      totalDays: 6,
      distanceM: 1800,
      labels: [],
    },
    deadlines:
      "10:47,11:16,11:45,12:14,12:44,13:14,13:45,14:16,14:48,15:21,15:55,16:30",
    is_absent: [false, false, false, false, false, false],
    weight_kg: [50.1, 49.8, 47.6, 47, 47.1, 44],
    branch: ["三重", "静岡", "岡山", "山口", "埼玉", "三重"],
    hometown: ["三重", "静岡", "岡山", "山口", "埼玉", "三重"],
    f_count: [1, 0, 0, 0, 0, 1],
    l_count: [0, 0, 0, 0, 1, 0],
    avg_st: [0.24, 0.19, 0.24, 0.16, 0.18, 0.17],
  },
  {
    // 既存のフィクスチャ（大村 2026-09-07 1R。安定板使用のラベル）
    file: LIST_FILES.preliminary,
    meta: {
      raceTitle: "開設７４周年記念　海の王者決定戦",
      raceStage: "予選",
      seriesDay: 1,
      totalDays: 6,
      distanceM: 1800,
      labels: [{ text: "安定板使用", type: "is-type1" }],
    },
    deadlines:
      "15:15,15:45,16:15,16:50,17:19,17:46,18:14,18:43,19:14,19:47,20:16,20:45",
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52, 54, 52, 52.2, 53.6, 52],
    branch: ["長崎", "佐賀", "広島", "岡山", "静岡", "愛知"],
    hometown: ["長崎", "佐賀", "広島", "岡山", "静岡", "愛知"],
    f_count: [0, 0, 0, 1, 0, 0],
    l_count: [0, 0, 0, 0, 0, 0],
    avg_st: [0.15, 0.16, 0.14, 0.17, 0.12, 0.14],
  },
];

// ---- 後半の場面（verifyData/pre-race-parsers-scenes-1.js・pre-race-parsers-scenes-2.js・pre-race-parsers-scenes-3.js・pre-race-parsers-scenes-4.js） ----
runPreRaceParsersScenes1({ printOut, check, show, same, readFixture, LIST_FILES, LIST_CASES });
runPreRaceParsersScenes2({ check, same, readFixture, listFixtures });
await runPreRaceParsersScenes3({ check, show, same, readFixture, LIST_FILES });
await runPreRaceParsersScenes4({ check, show, same, readFixture });

// ---------------------------------------------------------------------------
// (e) DDL案とコードの整合
// ---------------------------------------------------------------------------
{
  const strip = (sql) => sql.replace(/--[^\n]*/g, "");
  const s081 = strip(
    fs.readFileSync(
      path.join(ROOT, "docs/db-migration/081_race_entries_racelist_fields.sql"),
      "utf8",
    ),
  );
  const s082 = strip(
    fs.readFileSync(
      path.join(
        ROOT,
        "docs/db-migration/082_exhibition_data_beforeinfo_fields.sql",
      ),
      "utf8",
    ),
  );
  /** ALTER TABLE <table> の ADD COLUMN の列名を集める */
  const addedColumns = (sql) => {
    const out = {};
    for (const m of sql.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) {
      const cols = [...m[2].matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map(
        (x) => x[1],
      );
      if (cols.length > 0) out[m[1]] = [...(out[m[1]] ?? []), ...cols];
    }
    return out;
  };
  const ddl = { ...addedColumns(s081), ...addedColumns(s082) };
  for (const [table, columns] of Object.entries(ALL_NEW_COLUMNS)) {
    check(
      `DDL案とコードの整合: ${table} の追加列（DDL）が、判定の対象・書く列と一致する`,
      same([...(ddl[table] ?? [])].sort(), [...columns].sort()),
      `${show(ddl[table])} vs ${show(columns)}`,
    );
  }
  // コードが書く新しい列 = 拡張の行の新しい列
  {
    const page = realListParser.parseRaceListPage(
      readFixture("raceInfo", LIST_FILES.absent),
    );
    const legacyKeys = Object.keys(
      realRows.buildRaceEntryRows("R", page.entries)[0],
    );
    const extKeys = Object.keys(
      realRows.buildRaceEntryRows("R", page.entries, { extended: true })[0],
    ).filter((k) => !legacyKeys.includes(k));
    const cond = realRows.buildRaceConditionRow("R", page.meta, {
      extended: true,
    });
    const before = realBeforeParser.parseBeforeInfoPage(
      readFixture("beforeinfo", BEFORE_FILES.absent),
    );
    const exhLegacy = Object.keys(
      realRows.buildExhibitionRows("R", before.boats)[0],
    );
    const exhExt = Object.keys(
      realRows.buildExhibitionRows("R", before.boats, { extended: true })[0],
    ).filter((k) => !exhLegacy.includes(k));
    check(
      "DDL案とコードの整合: 拡張の行が加える列が、判定の対象の列と同じ",
      same([...extKeys].sort(), [...NEW_ENTRY_KEYS].sort()) &&
        NEW_CONDITION_KEYS.every((k) => k in cond) &&
        same([...exhExt].sort(), [...NEW_EXHIBITION_KEYS].sort()),
    );
  }
  // CHECKの値: F/L・コース1〜6・数の下限
  check(
    "DDL案とコードの整合: CHECK（start_flag IN ('F','L')・コース1〜6・F数/L数>=0・距離>0）が、DDL案にある",
    /start_flag IN \('F', 'L'\)/.test(s082) &&
      /exhibition_course BETWEEN 1 AND 6/.test(s082) &&
      /f_count >= 0/.test(s081) &&
      /l_count >= 0/.test(s081) &&
      /race_distance_m > 0/.test(s081),
  );
  {
    const flags = new Set();
    const courses = new Set();
    for (const c of BEFORE_CASES) {
      const page = realBeforeParser.parseBeforeInfoPage(
        readFixture("beforeinfo", c.file),
      );
      for (const b of page.boats) {
        if (b.start_flag) flags.add(b.start_flag);
        if (b.exhibition_course) courses.add(b.exhibition_course);
      }
    }
    check(
      "DDL案とコードの整合: パーサーが出す start_flag は F・L のみ、展示進入は 1〜6",
      [...flags].every((f) => f === "F" || f === "L") &&
        [...courses].every((c) => c >= 1 && c <= 6),
    );
  }
  check(
    "DDL案: 新しいテーブルは作らない（RLS・GRANTの変更なし。列の追加だけ）",
    !/CREATE TABLE/i.test(s081) && !/CREATE TABLE/i.test(s082),
  );
}

// ---------------------------------------------------------------------------
// (f) 変異検証: 壊した版で、評価が失敗する
// ---------------------------------------------------------------------------
const MUTANT_DIR = path.join(ROOT, "scripts/lib");
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
async function withMutant(fileName, replacements, run) {
  const source = fs.readFileSync(path.join(MUTANT_DIR, fileName), "utf8");
  let mutated = source;
  for (const [from, to] of replacements) {
    if (!mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 50)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmp = path.join(
    MUTANT_DIR,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await run(await import(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- 後半の場面（verifyData/pre-race-parsers-scenes-4.js・pre-race-parsers-scenes-5.js） ----
runPreRaceParsersScenes5({ check, show, same, readFixture });
await runPreRaceParsersScenes6({ printOut, check, readFixture, withMutant });
// DDLの変異: 追加列を1つ落とすと、コードとの整合の検証が失敗する
{
  const s081 = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/081_race_entries_racelist_fields.sql"),
    "utf8",
  );
  const mutated = s081.replace(
    "  ADD COLUMN IF NOT EXISTS l_count   smallint,\n",
    "",
  );
  const count = (sql) =>
    [
      ...sql
        .replace(/--[^\n]*/g, "")
        .matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g),
    ].length;
  check(
    "変異検証: DDL案から追加列を1つ落とすと、列の数が変わり整合の検証が失敗する",
    count(s081) === 8 && count(mutated) === 7,
  );
}

// ---- 後半の場面（verifyData/pre-race-parsers-scenes-5.js） ----
await runPreRaceParsersScenes7({ printOut, check, readFixture, withMutant });
if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/pre-race-parsers-scenes-5.js） ----
runPreRaceParsersScenes8({ printOut, check, readFixture, withMutant });
