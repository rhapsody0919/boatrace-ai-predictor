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
import * as cheerio from "cheerio";
import * as realListParser from "../lib/raceListParser.js";
import * as realBeforeParser from "../lib/beforeInfoParser.js";
import * as realRows from "../lib/preRaceRows.js";
import {
  PRE_RACE_SCHEMA_TARGETS,
  clearPreRaceSchemaCache,
  detectPreRaceSchema,
} from "../lib/preRaceSchema.js";
import {
  legacyScrapeRaceMeta,
  legacyScrapeRacers,
} from "../lib/__fixtures__/raceInfo/legacyRaceListParser.js";
import { legacyScrapeExhibitionData } from "../lib/__fixtures__/beforeinfo/legacyExhibitionParser.js";
import { run as runRaceInfo } from "../daily/update-race-info.js";
import {
  scrapeAndUpsertRaces,
  scrapeExhibitionData,
} from "../daily/scrape-exhibition-data.js";

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

const BEFORE_FILES = {
  fFlag: "beforeinfo-2026-09-19-02-09-f-exhibition.html",
  absent: "beforeinfo-2026-09-16-23-12-absent.html",
  parts: "beforeinfo-2026-09-20-12-01-parts-f.html",
  pre: "beforeinfo-2026-09-21-10-08-before-exhibition.html",
  stabilizer: "beforeinfo-2026-09-21-10-04-stabilizer-1200m.html",
};
const N = null;
const BEFORE_CASES = [
  {
    // 戸田 2026-09-19 9R: スタート展示の並びが 1,2,3,4,6,5（5号艇が6コース）、2号艇が展示でF.01、プロペラ新
    file: BEFORE_FILES.fFlag,
    distanceM: 1800,
    labels: [],
    order: [1, 2, 3, 4, 6, 5],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [51.5, 47, 59.1, 51.5, 49.9, 52],
    exhibition_time: [6.61, 6.72, 6.77, 6.73, 6.76, 6.81],
    tilt: [0, -0.5, -0.5, -0.5, 0, -0.5],
    propeller_text: [N, "新", N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0.5, 0, 0, 0.5, 0, 0],
    prev_race_no: [3, N, 5, 4, 2, N],
    prev_entry_course: [2, N, 6, 4, 6, N],
    prev_start_timing: [0.18, N, 0.12, 0.17, 0.08, N],
    prev_finish_mark: ["5", N, "5", "3", "6", N],
    prev_finish_rank: [5, N, 5, 3, 6, N],
    exhibition_course: [1, 2, 3, 4, 6, 5],
    start_timing: [0.13, 0.01, 0.05, 0.07, 0.09, 0.17],
    start_flag: [N, "F", N, N, N, N],
    conditions: {
      weather: "雨",
      airTemp: 23,
      windVelocity: 0,
      observedRace: 8,
    },
  },
  {
    // 唐津 2026-09-16 12R: 1号艇が欠場（is-miss）。スタート展示は5行で、コースは繰り上がる
    file: BEFORE_FILES.absent,
    distanceM: 1800,
    labels: [],
    order: [2, 3, 4, 5, 6],
    published: true,
    is_absent: [true, false, false, false, false, false],
    weight_kg: [55.2, 55.1, 52.2, 52.9, 52.5, 55.6],
    exhibition_time: [N, 6.93, 6.88, 6.91, 6.96, 6.99],
    tilt: [N, -0.5, -0.5, -0.5, -0.5, -0.5],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [8, 7, 5, 4, 6, 2],
    prev_entry_course: [4, 3, 5, 1, 2, 3],
    prev_start_timing: [0.17, 0.09, 0.13, 0.21, 0.11, 0.15],
    prev_finish_mark: ["4", "2", "4", "1", "2", "4"],
    prev_finish_rank: [4, 2, 4, 1, 2, 4],
    exhibition_course: [N, 1, 2, 3, 4, 5],
    start_timing: [N, 0.01, 0.07, 0.13, 0.02, 0.01],
    start_flag: [N, "F", N, N, N, N],
    conditions: {
      weather: "晴",
      airTemp: 27,
      windVelocity: 6,
      observedRace: 11,
    },
  },
  {
    // 住之江 2026-09-20 1R: 5号艇の部品交換（電気・キャブ）、5号艇が展示でF.03、気象は「20:34現在」
    file: BEFORE_FILES.parts,
    distanceM: 1800,
    labels: [],
    order: [1, 2, 3, 4, 5, 6],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52.8, 54.2, 54.7, 55, 52, 58.6],
    exhibition_time: [6.98, 7.07, 7.04, 7.06, 7.11, 6.99],
    tilt: [-0.5, -0.5, 0, -0.5, -0.5, -0.5],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], ["電気", "キャブ"], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [N, N, N, N, N, N],
    prev_entry_course: [N, N, N, N, N, N],
    prev_start_timing: [N, N, N, N, N, N],
    prev_finish_mark: [N, N, N, N, N, N],
    prev_finish_rank: [N, N, N, N, N, N],
    exhibition_course: [1, 2, 3, 4, 5, 6],
    start_timing: [0.12, 0.1, 0.1, 0.08, 0.03, 0.1],
    start_flag: [N, N, N, N, "F", N],
    conditions: {
      weather: "晴",
      airTemp: 26,
      windVelocity: 4,
      observedTime: "20:34",
    },
  },
  {
    // 三国 2026-09-21 8R: 展示航走前。展示タイム・スタート展示は無い。体重・調整重量・前走成績は既にある
    file: BEFORE_FILES.pre,
    distanceM: 1200,
    labels: [],
    order: [],
    published: false,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52, 52, 52, 50.5, 52, 52.8],
    exhibition_time: [N, N, N, N, N, N],
    tilt: [N, N, N, N, N, N],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 1.5, 0, 0],
    prev_race_no: [N, N, 1, 2, N, N],
    prev_entry_course: [N, N, 1, 3, N, N],
    prev_start_timing: [N, N, 0.23, 0.25, N, N],
    prev_finish_mark: [N, N, "2", "6", N, N],
    prev_finish_rank: [N, N, 2, 6, N, N],
    exhibition_course: [N, N, N, N, N, N],
    start_timing: [N, N, N, N, N, N],
    start_flag: [N, N, N, N, N, N],
    conditions: { weather: "曇り", windVelocity: 10, observedRace: 4 },
  },
  {
    // 三国 2026-09-21 4R: 安定板使用のラベル・距離1200m
    file: BEFORE_FILES.stabilizer,
    distanceM: 1200,
    labels: ["安定板使用"],
    order: [1, 2, 3, 4, 5, 6],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [55.5, 52.2, 52.4, 52.3, 52.5, 52.6],
    exhibition_time: [7, 7.03, 6.94, 7.07, 6.94, 6.96],
    tilt: [0, 0, 0, -0.5, 0, 0],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [N, N, N, N, N, N],
    prev_entry_course: [N, N, N, N, N, N],
    prev_start_timing: [N, N, N, N, N, N],
    prev_finish_mark: [N, N, N, N, N, N],
    prev_finish_rank: [N, N, N, N, N, N],
    exhibition_course: [1, 2, 3, 4, 5, 6],
    start_timing: [0.04, 0.07, 0.03, 0.12, 0.27, 0.09],
    start_flag: [N, N, N, N, N, N],
    conditions: { weather: "曇り", windVelocity: 7, observedRace: 3 },
  },
];

// ---------------------------------------------------------------------------
// (a)(c)(e) を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
/**
 * @param {{parseRaceListPage: Function, parseBeforeInfoPage: Function, buildRaceEntryRows: Function,
 *   buildRaceConditionRow: Function, buildExhibitionRows: Function, planDeadlineUpdates: Function}} m
 * @returns {string[]} 失敗した項目のラベル
 */
function evaluate(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };

  for (const c of LIST_CASES) {
    const name = c.file.replace("racelist-", "").replace(".html", "");
    const page = m.parseRaceListPage(readFixture("raceInfo", c.file));
    const col = (key) => page.entries.map((e) => e[key]);
    expect(`${name}: 選手が6人`, page.entries.length === 6);
    expect(
      `${name}: 開催名・ステージ・日目・総日数・距離・ラベル`,
      same(
        {
          raceTitle: page.meta.raceTitle,
          raceStage: page.meta.raceStage,
          seriesDay: page.meta.seriesDay,
          totalDays: page.meta.totalDays,
          distanceM: page.meta.distanceM,
          labels: page.meta.labels,
        },
        c.meta,
      ),
    );
    expect(
      `${name}: 締切予定時刻（12レース分）`,
      page.deadlines.map((d) => d.time).join(",") === c.deadlines &&
        same(
          page.deadlines.map((d) => d.race_number),
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        ),
    );
    for (const key of [
      "is_absent",
      "weight_kg",
      "branch",
      "hometown",
      "f_count",
      "l_count",
      "avg_st",
      "local_win_rate",
      "boat_number_id",
    ]) {
      if (c[key]) expect(`${name}: ${key}`, same(col(key), c[key]));
    }
    expect(`${name}: 解析の異常なし`, page.anomalies.length === 0);

    // 行の組み立て（旧形式は新しい列を含めず、拡張は加える）
    const legacyRows = m.buildRaceEntryRows("R", page.entries);
    const extendedRows = m.buildRaceEntryRows("R", page.entries, {
      extended: true,
    });
    expect(
      `${name}: 旧形式の行は新しい列を含まない`,
      legacyRows.every((r) => !("weight_kg" in r) && !("is_absent" in r)),
    );
    expect(
      `${name}: 拡張の行は、旧形式の行に新しい列だけを加える`,
      extendedRows.every(
        (r, i) =>
          same(
            Object.fromEntries(
              Object.entries(r).filter(([k]) => k in legacyRows[i]),
            ),
            legacyRows[i],
          ) &&
          same(
            Object.keys(r)
              .filter((k) => !(k in legacyRows[i]))
              .sort(),
            [
              "branch",
              "f_count",
              "hometown",
              "is_absent",
              "l_count",
              "weight_kg",
            ],
          ),
      ),
    );
    const condRow = m.buildRaceConditionRow("R", page.meta, { extended: true });
    expect(
      `${name}: race_conditions の行に距離・ラベル`,
      condRow.race_distance_m === c.meta.distanceM &&
        same(
          condRow.race_labels,
          c.meta.labels.map((l) => l.text),
        ),
    );
    expect(
      `${name}: 旧形式の race_conditions の行は距離・ラベルを含まない`,
      !("race_distance_m" in m.buildRaceConditionRow("R", page.meta)) &&
        !("race_labels" in m.buildRaceConditionRow("R", page.meta)),
    );
  }

  for (const c of BEFORE_CASES) {
    const name = c.file.replace("beforeinfo-", "").replace(".html", "");
    const page = m.parseBeforeInfoPage(readFixture("beforeinfo", c.file));
    const col = (key) => page.boats.map((b) => b[key]);
    expect(`${name}: 6艇`, page.boats.length === 6);
    expect(
      `${name}: 距離・ラベル`,
      page.distanceM === c.distanceM && same(page.labels, c.labels),
    );
    expect(
      `${name}: スタート展示の並び（コース順）と公開状態`,
      same(page.start_exhibition.order, c.order) &&
        page.start_exhibition.published === c.published,
    );
    for (const key of [
      "is_absent",
      "weight_kg",
      "exhibition_time",
      "tilt",
      "propeller_text",
      "parts_changed",
      "adjustment_weight",
      "prev_race_no",
      "prev_entry_course",
      "prev_start_timing",
      "prev_finish_mark",
      "prev_finish_rank",
      "exhibition_course",
      "start_timing",
      "start_flag",
    ]) {
      expect(`${name}: ${key}`, same(col(key), c[key]));
    }
    for (const [key, value] of Object.entries(c.conditions)) {
      expect(`${name}: 気象 ${key}`, page.conditions?.[key] === value);
    }
    expect(`${name}: 解析の異常なし`, page.anomalies.length === 0);

    const legacy = m.buildExhibitionRows("R", page.boats);
    const extended = m.buildExhibitionRows("R", page.boats, { extended: true });
    const hasValue = (b) => b.exhibition_time != null || b.start_timing != null;
    expect(
      `${name}: 旧形式の行は、展示タイム・STのある艇だけ`,
      same(
        legacy.map((r) => r.boat_number),
        page.boats.filter(hasValue).map((b) => b.boat_number),
      ),
    );
    expect(
      `${name}: 拡張の行は、欠場艇も含む`,
      same(
        extended.map((r) => r.boat_number),
        page.boats
          .filter((b) => hasValue(b) || b.is_absent)
          .map((b) => b.boat_number),
      ),
    );
    expect(
      `${name}: 拡張の行の新しい列`,
      extended.every((r) => {
        const b = page.boats.find((x) => x.boat_number === r.boat_number);
        return (
          r.exhibition_course === b.exhibition_course &&
          r.start_flag === b.start_flag &&
          r.prev_finish_mark === b.prev_finish_mark &&
          r.is_absent === b.is_absent
        );
      }) &&
        legacy.every(
          (r) =>
            !("exhibition_course" in r) &&
            !("is_absent" in r) &&
            !("prev_finish_mark" in r),
        ),
    );
  }

  // 合成: 実ページで未観測の表記（L数が1以上・展示STのL表記・モーター・ボートの赤表示の疑い）。
  // 実ページの1件を書き換えたもの（フィクスチャではなく、その場で作る）
  {
    const html = readFixture("raceInfo", LIST_FILES.absent).replace(
      /L0(\s*<br\s*\/?>\s*0\.15)/,
      "L2$1",
    );
    const page = m.parseRaceListPage(html);
    expect(
      "合成: L数が2以上の表記（L2）を読む",
      same(
        page.entries.map((e) => e.l_count),
        [0, 2, 0, 0, 0, 0],
      ),
    );
  }
  {
    const $ = cheerio.load(readFixture("raceInfo", LIST_FILES.boatChanged));
    $(".table1 tbody.is-fs12")
      .eq(4)
      .find("td.is-lineH2")
      .eq(4)
      .addClass("is-fColor1");
    const page = m.parseRaceListPage($.html());
    expect(
      "合成: モーター・ボートのセルに赤の表示（is-fColor1）が現れたら anomalies に記録する",
      page.anomalies.length === 1 &&
        page.anomalies[0].startsWith("motor_boat_marker:is-fColor1"),
    );
  }
  {
    const html = readFixture("beforeinfo", BEFORE_FILES.stabilizer)
      .replace(
        /<span class="table1_boatImage1Time">\.04<\/span>/,
        '<span class="table1_boatImage1Time">L.05</span>',
      )
      .replace(
        /<span class="table1_boatImage1Time">\.07<\/span>/,
        '<span class="table1_boatImage1Time">L</span>',
      );
    const page = m.parseBeforeInfoPage(html);
    expect(
      "合成: 展示STのL表記（L.05・数字なしのL）",
      same(
        page.boats.slice(0, 2).map((b) => [b.start_timing, b.start_flag]),
        [
          [0.05, "L"],
          [N, "L"],
        ],
      ),
    );
  }
  {
    const empty = m.parseRaceListPage("<html><body></body></html>");
    const emptyBefore = m.parseBeforeInfoPage("<html><body></body></html>");
    expect(
      "空のページは、例外を投げず、選手・艇・締切時刻が空",
      empty.entries.length === 0 &&
        empty.deadlines.length === 0 &&
        emptyBefore.boats.length === 0 &&
        emptyBefore.start_exhibition.published === false,
    );
  }

  // 締切予定時刻の追従
  {
    const at = (hm) => new Date(`2026-09-16T${hm}:00+09:00`);
    const schedule = ["12:04", "12:33"].map((hm, i) => ({
      race_id: `2026-09-16-23-${String(i + 8).padStart(2, "0")}`,
      venue_code: 23,
      race_no: i + 8,
      start_time: at(hm),
    }));
    schedule.push({
      race_id: "2026-09-16-05-08",
      venue_code: 5,
      race_no: 8,
      start_time: at("12:00"),
    });
    const deadlines = [
      { race_number: 8, time: "12:05" },
      { race_number: 9, time: "12:33" },
    ];
    const plan = m.planDeadlineUpdates(schedule, 23, deadlines);
    expect(
      "締切予定時刻: 違うレースだけ更新（同じ値・他会場は対象外）",
      same(plan.updates, [
        {
          race_id: "2026-09-16-23-08",
          start_time: "12:05:00",
          previous: "12:04",
        },
      ]),
    );
    const far = m.planDeadlineUpdates(schedule, 23, [
      { race_number: 8, time: "20:05" },
      { race_number: 9, time: null },
    ]);
    expect(
      "締切予定時刻: 大きく動く値（別の日・誤読の恐れ）と、空の時刻は更新しない",
      far.updates.length === 0 &&
        same(
          far.skipped.map((s) => s.reason),
          ["shift_too_large", "no_time"],
        ),
    );
  }

  return failed;
}

const realModules = {
  parseRaceListPage: realListParser.parseRaceListPage,
  parseBeforeInfoPage: realBeforeParser.parseBeforeInfoPage,
  buildRaceEntryRows: realRows.buildRaceEntryRows,
  buildRaceConditionRow: realRows.buildRaceConditionRow,
  buildExhibitionRows: realRows.buildExhibitionRows,
  planDeadlineUpdates: realRows.planDeadlineUpdates,
};

// ---------------------------------------------------------------------------
// (a)(c) 実装の評価
// ---------------------------------------------------------------------------
{
  const failed = evaluate(realModules);
  check(
    `全項目の解析・行の組み立て: 実ページ（出走表${LIST_CASES.length}件・直前情報${BEFORE_CASES.length}件）と合成の全項目が期待どおり`,
    failed.length === 0,
    failed.join(" / "),
  );
}

// ---------------------------------------------------------------------------
// (b) 旧解析との互換
// ---------------------------------------------------------------------------
{
  const mismatches = [];
  const listFiles = listFixtures("raceInfo");
  for (const file of listFiles) {
    const html = readFixture("raceInfo", file);
    const $ = cheerio.load(html);
    const legacyRacers = legacyScrapeRacers($);
    const legacyMeta = legacyScrapeRaceMeta($);
    const page = realListParser.parseRaceListPage(html);
    const camel = page.entries.map((e) => ({
      boatNumber: e.boat_number,
      racerId: e.racer_id,
      playerName: e.player_name,
      grade: e.grade,
      age: e.age,
      winRate: e.win_rate,
      localWinRate: e.local_win_rate,
      global2Rate: e.global_2rate,
      local2Rate: e.local_2rate,
      global3Rate: e.global_3rate,
      local3Rate: e.local_3rate,
      motorNumber: e.motor_number,
      motor2Rate: e.motor_2rate,
      motor3Rate: e.motor_3rate,
      boatNumberId: e.boat_number_id,
      boat2Rate: e.boat_2rate,
      boat3Rate: e.boat_3rate,
    }));
    if (!same(camel, legacyRacers)) mismatches.push(`${file}: 選手`);
    const meta = {
      raceGrade: page.meta.raceGrade,
      raceTitle: page.meta.raceTitle,
      raceStage: page.meta.raceStage,
      seriesDay: page.meta.seriesDay,
      isFinalDay: page.meta.isFinalDay,
    };
    if (!same(meta, legacyMeta)) mismatches.push(`${file}: メタ`);
    // 旧実装の update-race-info.js の行の組み立て（凍結）と、旧形式の行が同じ
    const legacyRows = legacyRacers.map((racer) => ({
      race_id: "R",
      boat_number: racer.boatNumber,
      racer_id: racer.racerId,
      player_name: racer.playerName,
      grade: racer.grade,
      age: racer.age,
      win_rate: racer.winRate,
      local_win_rate: racer.localWinRate,
      global_2rate: racer.global2Rate,
      local_2rate: racer.local2Rate,
      global_3rate: racer.global3Rate,
      local_3rate: racer.local3Rate,
      motor_number: racer.motorNumber,
      motor_2rate: racer.motor2Rate,
      motor_3rate: racer.motor3Rate,
      boat_number_id: racer.boatNumberId,
      boat_2rate: racer.boat2Rate,
      boat_3rate: racer.boat3Rate,
    }));
    if (!same(realRows.buildRaceEntryRows("R", page.entries), legacyRows)) {
      mismatches.push(`${file}: race_entries の行`);
    }
    const legacyCondition = {
      race_id: "R",
      series_day: legacyMeta.seriesDay,
      is_final_day: legacyMeta.isFinalDay,
      race_title: legacyMeta.raceTitle,
      race_stage: legacyMeta.raceStage,
    };
    if (
      !same(realRows.buildRaceConditionRow("R", page.meta), legacyCondition)
    ) {
      mismatches.push(`${file}: race_conditions の行`);
    }
  }
  check(
    `出走表の旧解析との互換: 旧実装（凍結）と、選手・メタ・race_entries/race_conditions の行が同じ（${listFiles.length}件）`,
    mismatches.length === 0,
    mismatches.join(" / "),
  );
}
{
  const mismatches = [];
  const files = [
    ...listFixtures("beforeinfo").map((f) => ["beforeinfo", f]),
    ...listFixtures("weather", (f) => f.startsWith("beforeinfo-")).map((f) => [
      "weather",
      f,
    ]),
  ];
  const NEW_KEYS = [
    "exhibitionCourse",
    "startFlag",
    "prevFinishMark",
    "isAbsent",
  ];
  for (const [dir, file] of files) {
    const html = readFixture(dir, file);
    const legacy = legacyScrapeExhibitionData(cheerio.load(html));
    const now = scrapeExhibitionData(cheerio.load(html));
    const stripped = {
      ...now,
      data: now.data
        ? now.data.map((e) =>
            Object.fromEntries(
              Object.entries(e).filter(([k]) => !NEW_KEYS.includes(k)),
            ),
          )
        : now.data,
    };
    if (!same(stripped, legacy)) mismatches.push(`${dir}/${file}`);
    // 旧実装の scrape-exhibition-data.js の行の組み立て（凍結）と、旧形式の行が同じ
    if (legacy.data) {
      const legacyRows = [];
      for (const ex of legacy.data) {
        if (ex.exhibitionTime != null || ex.startTiming != null) {
          legacyRows.push({
            race_id: "R",
            boat_number: ex.boatNumber,
            exhibition_time: ex.exhibitionTime,
            start_timing: ex.startTiming,
            tilt: ex.tilt,
            propeller_change: ex.propellerChange,
            parts_changed: ex.partsChanged,
            adjustment_weight: ex.adjustmentWeight,
            today_weight: ex.todayWeight,
            prev_race_no: ex.prevRaceNo,
            prev_entry_course: ex.prevEntryCourse,
            prev_start_timing: ex.prevStartTiming,
            prev_finish_rank: ex.prevFinishRank,
          });
        }
      }
      const page = realBeforeParser.parseBeforeInfoPage(html);
      if (!same(realRows.buildExhibitionRows("R", page.boats), legacyRows)) {
        mismatches.push(`${dir}/${file}: exhibition_data の行`);
      }
    }
  }
  check(
    `直前情報の旧解析との互換: 旧実装（凍結）と、展示データ・理由・exhibition_data の行が同じ（${files.length}件。気象だけの6ページを含む）`,
    mismatches.length === 0,
    mismatches.join(" / "),
  );
}

// ---------------------------------------------------------------------------
// (d) 書き込み経路
// ---------------------------------------------------------------------------
const LEGACY_ENTRY_KEYS = [
  "race_id",
  "boat_number",
  "racer_id",
  "player_name",
  "grade",
  "age",
  "win_rate",
  "local_win_rate",
  "global_2rate",
  "local_2rate",
  "global_3rate",
  "local_3rate",
  "motor_number",
  "motor_2rate",
  "motor_3rate",
  "boat_number_id",
  "boat_2rate",
  "boat_3rate",
];
const NEW_ENTRY_KEYS = PRE_RACE_SCHEMA_TARGETS.raceEntries.columns;
const NEW_CONDITION_KEYS = PRE_RACE_SCHEMA_TARGETS.raceConditions.columns;
const NEW_EXHIBITION_KEYS = PRE_RACE_SCHEMA_TARGETS.exhibition.columns;
const ALL_NEW_COLUMNS = {
  race_entries: NEW_ENTRY_KEYS,
  race_conditions: NEW_CONDITION_KEYS,
  exhibition_data: NEW_EXHIBITION_KEYS,
};

/**
 * Supabaseクライアントの差し替え（インメモリ）。missing に、テーブルごとの「未適用の列」を入れると、その列を含む
 * 書き込み・selectが、PostgRESTと同じ形のエラーで失敗する（マイグレーション未適用のDBの再現）。
 * throwOnProbe=true なら、適用状況の確認（select(...).limit(0)）が例外になる（通信エラーの再現）。
 */
function createDb({ tables = {}, missing = {}, throwOnProbe = false } = {}) {
  const state = {
    tables: JSON.parse(JSON.stringify(tables)),
    upserts: [],
    updates: [],
  };
  const missingIn = (table, cols) =>
    cols.find((c) => (missing[table] ?? []).includes(c));
  const selectError = (table, col) => ({
    code: "42703",
    message: `column ${table}.${col} does not exist`,
  });
  const client = {
    state,
    from(table) {
      state.tables[table] ??= [];
      return {
        select(columns) {
          const cols = columns.split(",").map((c) => c.trim());
          return {
            limit() {
              if (throwOnProbe) throw new Error("fetch failed");
              const bad = missingIn(table, cols);
              return Promise.resolve(
                bad
                  ? { data: null, error: selectError(table, bad) }
                  : { data: [], error: null },
              );
            },
            in(column, ids) {
              const bad = missingIn(table, cols);
              if (bad) {
                return Promise.resolve({
                  data: null,
                  error: selectError(table, bad),
                });
              }
              const rows = state.tables[table].filter((r) =>
                ids.includes(r[column]),
              );
              return Promise.resolve({
                data: rows.map((r) =>
                  Object.fromEntries(
                    cols.filter((c) => c in r).map((c) => [c, r[c]]),
                  ),
                ),
                error: null,
              });
            },
          };
        },
        upsert(rows, { onConflict }) {
          for (const row of rows) {
            const bad = missingIn(table, Object.keys(row));
            if (bad) {
              return Promise.resolve({
                error: {
                  code: "PGRST204",
                  message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
                },
              });
            }
          }
          state.upserts.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
          const keys = onConflict.split(",");
          for (const row of rows) {
            const existing = state.tables[table].find((r) =>
              keys.every((k) => r[k] === row[k]),
            );
            if (existing)
              Object.assign(existing, JSON.parse(JSON.stringify(row)));
            else state.tables[table].push(JSON.parse(JSON.stringify(row)));
          }
          return Promise.resolve({ error: null });
        },
        update(values) {
          return {
            eq(column, value) {
              state.updates.push({ table, values, column, value });
              for (const r of state.tables[table]) {
                if (r[column] === value) Object.assign(r, values);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return client;
}

/** globalThis.fetch を、URL に応じたHTMLを返すものに差し替える（実行後に戻す） */
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const body = handler(String(url));
    if (body === null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    return await fn(requested);
  } finally {
    globalThis.fetch = original;
  }
}

const jstDate = (hm) => new Date(`2026-09-16T${hm}:00+09:00`);
const hmOf = (date) => realRows.formatJstHm(date);

// --- A1（update-race-info.js） ---
{
  const listHtml = readFixture("raceInfo", LIST_FILES.absent);
  const beforeHtml = readFixture("beforeinfo", BEFORE_FILES.absent);
  const fixtureTimes = realListParser
    .parseRaceListPage(listHtml)
    .deadlines.map((d) => d.time);
  const RACE_IDS = fixtureTimes.map(
    (_, i) => `2026-09-16-23-${String(i + 1).padStart(2, "0")}`,
  );

  /** DBの状態（races の start_time）から、getRaceSchedule() と同じ形のスケジュールを作る。12Rは発走60分前 */
  const buildSchedule = (db, nowMs) =>
    db.state.tables.races.map((r, i) => ({
      race_id: r.race_id,
      venue_code: 23,
      race_no: i + 1,
      start_time:
        i === 11
          ? new Date(nowMs + 60 * 60 * 1000)
          : jstDate(r.start_time.slice(0, 5)),
    }));
  const seedRaces = (nowMs) =>
    RACE_IDS.map((race_id, i) => ({
      race_id,
      // 朝の値。8Rだけ、公式の締切予定時刻（12:05）と1分違う（12:04）
      start_time:
        i === 11
          ? `${hmOf(new Date(nowMs + 60 * 60 * 1000))}:00`
          : `${i === 7 ? "12:04" : fixtureTimes[i]}:00`,
      cancellation_status: null,
      cancellation_check_streak: 0,
      race_grade: "ippan",
    }));

  /** 出走表のHTMLは、締切予定時刻の行を「12Rは今から60分後、8Rだけ公式が朝より1分遅い」に書き換える */
  const nowMs = Date.now();
  const listWithDeadlines = (() => {
    const $ = cheerio.load(listHtml);
    const times = fixtureTimes.map((t, i) =>
      i === 11 ? hmOf(new Date(nowMs + 60 * 60 * 1000)) : t,
    );
    $(".table1")
      .filter((_, el) =>
        $(el).find("tbody td").first().text().includes("締切予定時刻"),
      )
      .find("tbody tr")
      .first()
      .find("td")
      .slice(1)
      .each((i, td) => $(td).text(times[i]));
    return $.html();
  })();

  const handler = (url) =>
    url.includes("/racelist?")
      ? listWithDeadlines
      : url.includes("/beforeinfo?")
        ? beforeHtml
        : null;

  const keysOf = (db, table) =>
    db.state.upserts
      .filter((u) => u.table === table)
      .flatMap((u) => u.rows.map((r) => Object.keys(r)));
  const runA1 = (db, options = {}) =>
    withFetch(handler, () =>
      runRaceInfo(buildSchedule(db, nowMs), "2026-09-16", {
        client: db,
        ...options,
      }),
    );

  // 未適用（081なし）: 旧実装と同じ列だけを書き、壊れない
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      missing: {
        race_entries: NEW_ENTRY_KEYS,
        race_conditions: NEW_CONDITION_KEYS,
      },
    });
    const result = await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    const allowed = new Set([...LEGACY_ENTRY_KEYS, "updated_at"]);
    check(
      "A1（081未適用）: race_entries に旧実装と同じ列だけを書く（新しい列を含めない）",
      result.updated === true &&
        entryKeys.length === 6 &&
        entryKeys.every((keys) => keys.every((k) => allowed.has(k))),
      show(entryKeys[0]),
    );
    check(
      "A1（081未適用）: race_conditions に距離・ラベルを含めない",
      keysOf(db, "race_conditions").every(
        (keys) => !keys.some((k) => NEW_CONDITION_KEYS.includes(k)),
      ) && keysOf(db, "race_conditions").length > 0,
    );
    check(
      "A1（081未適用）: 締切予定時刻が違うレース（8R: 12:04→12:05）だけ races.start_time を更新する",
      same(
        db.state.updates.filter(
          (u) => u.table === "races" && "start_time" in u.values,
        ),
        [
          {
            table: "races",
            values: { start_time: "12:05:00" },
            column: "race_id",
            value: "2026-09-16-23-08",
          },
        ],
      ) && result.deadlineUpdates === 1,
      show(db.state.updates),
    );
    // 再実行: 変更なし → 書き込み0件
    const before = db.state.upserts.length;
    const beforeUpdates = db.state.updates.length;
    await runA1(db);
    check(
      "A1（081未適用）: 再実行は書き込み0件（変更の無い行は書かない。start_time も更新済み）",
      db.state.upserts.length === before &&
        db.state.updates.length === beforeUpdates,
      `upserts +${db.state.upserts.length - before}`,
    );
  }

  // 適用済み: 新しい列も書く。再実行は0件
  {
    const db = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db);
    const entryRows = db.state.upserts
      .filter((u) => u.table === "race_entries")
      .flatMap((u) => u.rows);
    check(
      "A1（081適用済み）: race_entries に登録体重・支部・出身地・F数・L数・欠場を書く",
      entryRows.length === 6 &&
        NEW_ENTRY_KEYS.every((k) => entryRows.every((r) => k in r)) &&
        same(
          entryRows.map((r) => [
            r.weight_kg,
            r.branch,
            r.hometown,
            r.f_count,
            r.l_count,
            r.is_absent,
          ]),
          [
            [55.2, "福岡", "福岡", 0, 0, true],
            [55.1, "愛知", "愛知", 1, 0, false],
            [52.2, "大阪", "大阪", 0, 0, false],
            [52.9, "兵庫", "兵庫", 0, 0, false],
            [52.5, "東京", "千葉", 0, 0, false],
            [55.6, "兵庫", "兵庫", 0, 0, false],
          ],
        ),
      show(entryRows[0]),
    );
    const cond = db.state.upserts
      .filter((u) => u.table === "race_conditions")
      .flatMap((u) => u.rows);
    check(
      "A1（081適用済み）: race_conditions に距離・ラベルを書く（ラベルなしは空配列）",
      cond.length === 1 &&
        cond[0].race_distance_m === 1800 &&
        same(cond[0].race_labels, []),
      show(cond[0]),
    );
    const before = db.state.upserts.length;
    await runA1(db);
    check(
      "A1（081適用済み）: 再実行は書き込み0件（配列・数値の比較も変更なしと判定する）",
      db.state.upserts.length === before,
      `upserts +${db.state.upserts.length - before}`,
    );
  }

  // 片方だけ適用（race_conditions の列のみ未適用）
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      missing: { race_conditions: NEW_CONDITION_KEYS },
    });
    await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    check(
      "A1（race_entries の列だけ適用済み）: race_entries は新しい列を書き、race_conditions は書かない",
      entryKeys.every((keys) =>
        NEW_ENTRY_KEYS.every((k) => keys.includes(k)),
      ) &&
        keysOf(db, "race_conditions").every(
          (keys) => !keys.some((k) => NEW_CONDITION_KEYS.includes(k)),
        ),
    );
  }

  // 適用状況の確認が通信エラー → 旧形式で書く（安全側）
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      throwOnProbe: true,
    });
    await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    check(
      "A1: 適用状況の確認が失敗したときは、旧形式で書く（安全側）",
      entryKeys.length === 6 &&
        entryKeys.every((keys) =>
          keys.every((k) => !NEW_ENTRY_KEYS.includes(k)),
        ),
    );
  }

  // dry-run・syncDeadlines=false
  {
    const db = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db, { dryRun: true });
    check(
      "A1: dry-run は、DBへ書き込まない（upsert・update とも0件）",
      db.state.upserts.length === 0 && db.state.updates.length === 0,
    );
    const db2 = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db2, { syncDeadlines: false });
    check(
      "A1: syncDeadlines=false は、start_time を更新しない",
      db2.state.updates.every((u) => !("start_time" in u.values)),
    );
  }
}

// --- A2（scrape-exhibition-data.js） ---
{
  const RACE_ID = "2026-09-16-23-12";
  const target = [
    {
      race_id: RACE_ID,
      venue_code: 23,
      race_no: 12,
      start_time: jstDate("14:21"),
    },
  ];
  const beforeFor = (file) => readFixture("beforeinfo", file);
  const runA2 = (db, file) =>
    withFetch(
      (url) => (url.includes("/beforeinfo?") ? beforeFor(file) : null),
      () => scrapeAndUpsertRaces(target, "2026-09-16", { client: db }),
    );
  const exhibitionRows = (db) =>
    db.state.upserts
      .filter((u) => u.table === "exhibition_data")
      .flatMap((u) => u.rows);
  const LEGACY_EXH_KEYS = [
    "race_id",
    "boat_number",
    "exhibition_time",
    "start_timing",
    "tilt",
    "propeller_change",
    "parts_changed",
    "adjustment_weight",
    "today_weight",
    "prev_race_no",
    "prev_entry_course",
    "prev_start_timing",
    "prev_finish_rank",
    "updated_at",
  ];

  {
    const db = createDb({ missing: { exhibition_data: NEW_EXHIBITION_KEYS } });
    const result = await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2（082未適用）: 旧実装と同じ列だけを書く（展示タイム・STのある5艇。欠場艇の行は書かない）",
      result.updated === true &&
        rows.length === 5 &&
        rows.every((r) =>
          Object.keys(r).every((k) => LEGACY_EXH_KEYS.includes(k)),
        ),
      show(rows[0]),
    );
    const before = db.state.upserts.length;
    await runA2(db, BEFORE_FILES.absent);
    check(
      "A2（082未適用）: 再実行は書き込み0件",
      db.state.upserts.length === before,
    );
  }
  {
    const db = createDb();
    await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2（082適用済み）: 展示進入・展示STのF・前走の着順の生表記・欠場を書く（欠場艇の行も書く）",
      rows.length === 6 &&
        NEW_EXHIBITION_KEYS.every((k) => rows.every((r) => k in r)) &&
        same(
          rows.map((r) => [
            r.boat_number,
            r.exhibition_course,
            r.start_flag,
            r.is_absent,
          ]),
          [
            [1, null, null, true],
            [2, 1, "F", false],
            [3, 2, null, false],
            [4, 3, null, false],
            [5, 4, null, false],
            [6, 5, null, false],
          ],
        ) &&
        rows[0].exhibition_time === null &&
        rows[0].today_weight === 55.2 &&
        rows[0].prev_finish_mark === "4",
      show(rows[0]),
    );
    const before = db.state.upserts.length;
    await runA2(db, BEFORE_FILES.absent);
    check(
      "A2（082適用済み）: 再実行は書き込み0件",
      db.state.upserts.length === before,
    );
  }
  {
    const db = createDb();
    const result = await runA2(db, BEFORE_FILES.pre);
    check(
      "A2（082適用済み）: 展示航走前のページは、旧実装と同じく書き込まない（欠場でない艇の行は作らない）",
      result.updated === false && exhibitionRows(db).length === 0,
    );
  }
  {
    const db = createDb({ throwOnProbe: true });
    await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2: 適用状況の確認が失敗したときは、旧形式で書く（安全側）",
      rows.length === 5 &&
        rows.every((r) =>
          Object.keys(r).every((k) => LEGACY_EXH_KEYS.includes(k)),
        ),
    );
  }
}

// --- 適用状況の判定 ---
{
  const db = createDb({
    missing: { race_entries: NEW_ENTRY_KEYS, exhibition_data: ["is_absent"] },
  });
  const detected = await detectPreRaceSchema(db, { warn: () => {} });
  check(
    "適用状況の判定: 列が無いテーブルは false、揃っているテーブルは true（1列でも欠ければ false）",
    same(detected, {
      raceEntries: false,
      raceConditions: true,
      exhibition: false,
    }),
    show(detected),
  );
  clearPreRaceSchemaCache(db);
}

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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await run(await import(`${tmp}?t=${Date.now()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const LIST = "raceListParser.js";
const BEFORE = "beforeInfoParser.js";
const ROWS = "preRaceRows.js";
const mutants = [
  [
    "欠場の表示（is-miss）を読まない（出走表）",
    LIST,
    [['is_absent: $tbody.hasClass("is-miss"),', "is_absent: false,"]],
    "list",
  ],
  [
    "F数を、L数の欄から読む",
    LIST,
    [
      [
        "f_count: f ? parseInt(f[1], 10) : null,",
        "f_count: l ? parseInt(l[1], 10) : null,",
      ],
    ],
    "list",
  ],
  [
    "登録体重を読まない",
    LIST,
    [
      [
        "weight_kg: weightMatch ? parseFloat(weightMatch[1]) : null,",
        "weight_kg: null,",
      ],
    ],
    "list",
  ],
  [
    "支部と出身地を逆にする",
    LIST,
    [
      [
        "branch: areaMatch ? areaMatch[1].trim() : null,",
        "branch: areaMatch ? areaMatch[2].trim() : null,",
      ],
    ],
    "list",
  ],
  [
    "締切予定時刻を1レースずらす",
    LIST,
    [["time: times[i] ?? null,", "time: times[i + 1] ?? null,"]],
    "list",
  ],
  [
    "レースラベルを読まない",
    LIST,
    [
      [
        '.title16_titleLabels__add2020 .label2")',
        '.title16_titleLabels__add2020 .nolabel")',
      ],
    ],
    "list",
  ],
  [
    "距離を常に1800mにする",
    LIST,
    [
      [
        "distanceM: distance ? parseInt(distance[1], 10) : null,",
        "distanceM: 1800,",
      ],
    ],
    "list",
  ],
  [
    "「-」（データなし）を0にする（平均STが0.00になる）",
    LIST,
    [
      [
        "  return Number.isNaN(v) ? null : v;",
        "  return Number.isNaN(v) ? 0 : v;",
      ],
    ],
    "list",
  ],
  [
    "未知のモーター・ボートの赤表示を記録しない",
    LIST,
    [["if (/^is-fColor/.test(c)) {", "if (false) {"]],
    "list",
  ],
  [
    "展示進入を、艇番にする（行順を読まない）",
    BEFORE,
    [["course: index + 1,", "course: boatNumber,"]],
    "before",
  ],
  [
    "展示STのF/L表記を読まない",
    BEFORE,
    [
      [
        'const flag = t.startsWith("F") ? "F" : t.startsWith("L") ? "L" : null;',
        "const flag = null;",
      ],
    ],
    "before",
  ],
  [
    "欠場の表示（is-miss）を読まない（直前情報）",
    BEFORE,
    [['is_absent: $tbody.hasClass("is-miss"),', "is_absent: false,"]],
    "before",
  ],
  [
    "前走の着順の生表記を捨てる",
    BEFORE,
    [["prev_finish_mark: prevFinishText || null,", "prev_finish_mark: null,"]],
    "before",
  ],
  [
    "前走の着順の全角を半角にしない",
    BEFORE,
    [['    .normalize("NFKC")\n', ""]],
    "before",
  ],
  [
    "拡張の直前情報の行から、欠場艇を落とす",
    ROWS,
    [["(extended && b.is_absent),", "false,"]],
    "rows",
  ],
  [
    "拡張の直前情報の行に、展示進入を入れない",
    ROWS,
    [["            exhibition_course: b.exhibition_course,\n", ""]],
    "rows",
  ],
  [
    "拡張の race_conditions の行に、ラベルを入れない",
    ROWS,
    [["race_labels: meta.labels.map((label) => label.text),", ""]],
    "rows",
  ],
  [
    "旧形式の出走表の行に、常に新しい列を入れる",
    ROWS,
    [
      [
        "...(extended\n      ? {\n          weight_kg: e.weight_kg,",
        "...(true\n      ? {\n          weight_kg: e.weight_kg,",
      ],
    ],
    "rows",
  ],
  [
    "締切予定時刻の更新の上限（大きく動く値）を無くす",
    ROWS,
    [
      [
        "if (Math.abs(h * 60 + m - (ch * 60 + cm)) > maxShiftMin) {",
        "if (false) {",
      ],
    ],
    "rows",
  ],
  [
    "締切予定時刻が同じでも更新する",
    ROWS,
    [["if (time === current) continue;", ""]],
    "rows",
  ],
];
for (const [label, file, replacements, kind] of mutants) {
  const failed = await withMutant(file, replacements, (mod) =>
    evaluate(
      kind === "list"
        ? { ...realModules, parseRaceListPage: mod.parseRaceListPage }
        : kind === "before"
          ? { ...realModules, parseBeforeInfoPage: mod.parseBeforeInfoPage }
          : {
              ...realModules,
              buildRaceEntryRows: mod.buildRaceEntryRows,
              buildRaceConditionRow: mod.buildRaceConditionRow,
              buildExhibitionRows: mod.buildExhibitionRows,
              planDeadlineUpdates: mod.planDeadlineUpdates,
            },
    ),
  );
  check(
    `変異検証: 「${label}」で検証が失敗する（${failed.length}項目が失敗）`,
    failed.length > 0,
  );
}
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
// 書き込み経路の変異: 適用状況を確認せず、常に新しい列を書く版は、未適用のDBで失敗する
{
  const db = createDb({ missing: { exhibition_data: NEW_EXHIBITION_KEYS } });
  const page = realBeforeParser.parseBeforeInfoPage(
    readFixture("beforeinfo", BEFORE_FILES.absent),
  );
  const rows = realRows.buildExhibitionRows("R", page.boats, {
    extended: true,
  });
  const { error } = await db.from("exhibition_data").upsert(rows, {
    onConflict: "race_id,boat_number",
  });
  check(
    "変異検証: 未適用のDBに拡張の行を確認なしで書くと、書き込みがエラーになる（適用状況の確認が必要な理由）",
    Boolean(error),
  );
}

// ---------------------------------------------------------------------------
console.log = printOut;
if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}
printOut("\n✅ 全て合格");
