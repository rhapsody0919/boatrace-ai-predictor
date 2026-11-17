/**
 * verify-series-points-stage-rules.js の場面のデータ（種別の実データ・節の出走表・バッジと表示の場合分け）。verify ではない。
 */
import { pickLatestPretestByRacer } from "../../../src/utils/pretestRows.js";

// 節名（Ｗ優勝戦の割れ方の試験）
export const W_TITLE = "第２０回マンスリーＢＯＡＴＲＡＣＥ杯　男女Ｗ優勝戦";
export const TAMA_TITLE = "男女Ｗ優勝戦第２回ファイティングボートガイド杯";

// ---- 1. 配点区分 -----------------------------------------------------------
// 実データの表記（左）と、そのときの区分（右）。件数は棚卸しの「予選期間内」
export const CLASSIFY_CASES = [
  // 勝ち上がり戦（算入しない）
  ["優勝戦", "excluded"],
  ["準優勝戦", "excluded"],
  ["準々優勝戦", "excluded"], // 実データ4件
  ["準々決勝戦", "excluded"], // BOA-771: 2026-01-23 江戸川G1の9〜12R
  ["準決勝戦", "excluded"],
  ["準優進出戦", "excluded"], // 実データ39件
  ["ツッキー優勝戦", "excluded"],
  ["団体・優勝戦", "excluded"],
  // ドリーム戦（12/10/9/7/6/5）。公式の得点率一覧と一致済み
  ["ドリーム戦", "dream"],
  ["ドリーム", "dream"],
  ["ドリームレース", "dream"],
  ["１ｓｔドリーム", "dream"],
  ["予選ドリーム戦", "dream"],
  // 「ＤＲ」はドリーム戦の略（全角。桐生・びわこ・津ほか多数）
  ["桐生ＤＲ戦女子", "dream"],
  ["ツッキーＤＲ戦", "dream"],
  ["プリンセスＤＲ", "dream"],
  ["三重選抜ＤＲ戦", "dream"], // 選抜とDRの両方を含む → ドリーム優先
  // 特選・特賞・選抜（11/9/7/5/3/2）
  ["予選特選", "tokusen"], // 予選期間内 1466件
  ["予選特賞", "tokusen"], // 予選期間内 2233件
  ["予選特選男子", "tokusen"],
  ["一般特選", "tokusen"],
  ["桐生特選", "tokusen"],
  ["戸田特賞", "tokusen"],
  ["ＢＴＳ名張特賞", "tokusen"],
  ["選抜戦", "tokusen"],
  ["記者選抜戦", "tokusen"], // 予選期間内 139件
  ["予選選抜", "tokusen"],
  ["特別選抜戦", "tokusen"],
  // 通常配点（会場固有のシリーズ名。特別配点と判定する根拠が無い）
  ["予選", "normal"],
  ["一般", "normal"],
  ["一般戦", "normal"],
  ["サンライズＸ戦", "normal"],
  ["ドラドキ３", "normal"], // 「ドリーム」でも「DR」でもない
  ["ドラドキ目玉", "normal"],
  ["ＤＤ目玉女子", "normal"],
  ["かけうどん６", "normal"],
  ["５ールドレース", "normal"],
  ["予選特別Ａ戦", "normal"], // 「特別」は加点しない（実測で改善しなかった）
  ["", "normal"],
  [null, "normal"],
];

// ---- 3. 得点率の計算 -------------------------------------------------------
// ドリーム戦1着(12) + 予選2着(8) + 予選特選1着(11) = 31点 / 3走 = 10.33
export const RECORDS = [
  {
    raceId: "2026-09-22-20-12",
    raceStage: "ドリーム戦",
    boatNumber: 1,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  {
    raceId: "2026-09-23-20-05",
    raceStage: "予選",
    boatNumber: 2,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  {
    raceId: "2026-09-25-20-11",
    raceStage: "予選特選",
    boatNumber: 3,
    rank1: 3,
    rank2: 2,
    rank3: 1,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  // 予選終了後の一般戦（算入しない）
  {
    raceId: "2026-09-26-20-01",
    raceStage: "一般戦",
    boatNumber: 1,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
];

export const TAMAGAWA_W = [
  { race_id: "2026-03-20-05-01", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-02", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-03", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-04", race_stage: "予選", race_title: TAMA_TITLE },
  // 側の中を繋ぐ予選（実際の節でも、同じ側の選手は節を通して何度も顔を合わせる）
  { race_id: "2026-03-21-05-01", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-21-05-02", race_stage: "予選", race_title: TAMA_TITLE },
  {
    race_id: "2026-03-24-05-03",
    race_stage: "Ｗ準優戦前半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-05",
    race_stage: "Ｗ準優戦前半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-09",
    race_stage: "Ｗ準優戦後半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-11",
    race_stage: "Ｗ準優戦後半",
    race_title: TAMA_TITLE,
  },
  { race_id: "2026-03-25-05-01", race_stage: "一般", race_title: TAMA_TITLE },
  { race_id: "2026-03-25-05-12", race_stage: "優勝戦", race_title: TAMA_TITLE },
];

// ---- 順位はシリーズの中だけで振る ------------------------------------------------
// `seriesRacerIds` を渡すと、その選手だけを母集団にする。渡さなければ従来どおり
export const W_ENTRIES = [
  {
    raceId: "2026-09-20-01-01",
    racerId: 1001,
    playerName: "男A",
    raceStage: "予選男子",
    rank1: 1,
  },
  {
    raceId: "2026-09-20-01-01",
    racerId: 1002,
    playerName: "男B",
    raceStage: "予選男子",
    rank1: 1,
  },
  {
    raceId: "2026-09-20-01-02",
    racerId: 2001,
    playerName: "女A",
    raceStage: "予選女子",
    rank1: 2,
  },
  {
    raceId: "2026-09-20-01-02",
    racerId: 2002,
    playerName: "女B",
    raceStage: "予選女子",
    rank1: 2,
  },
];

// BOA-1120: バッジの全フィールド・優勝戦判定・表の種別表示を固定する。
export const FINAL_BADGE = {
  emoji: "🏆",
  i18nKey: "raceStage.final",
  color: "#b91c1c",
};

export const SEMIFINAL_BADGE = {
  emoji: "🥈",
  i18nKey: "raceStage.semifinal",
  color: "#c2410c",
};

export const BADGE_CASES = [
  ...[
    "優勝戦",
    "ツッキー優勝戦",
    "ＭＤ優勝戦",
    "決勝戦",
    "王将位決定戦",
    "ファイナル",
    "県内選手権優",
    "ゴールド優勝",
  ].map((stage) => [stage, true, FINAL_BADGE]),
  ...["準優勝戦", "Ｗ準優戦前半", "準決勝戦", "セミファイナル"].map((stage) => [
    stage,
    false,
    SEMIFINAL_BADGE,
  ]),
  ...[
    "準々優勝戦",
    "準優進出戦",
    "ファイナル進出戦",
    "ファイナル選抜",
    "予選",
    "一般",
    "",
    null,
    undefined,
  ].map((stage) => [stage, false, undefined]),
];

// NOT NULL の日付・整数の列から来ない入力。仕様は未定なので assert しない。
export const PRETEST_KNOWN_GAPS = [
  {
    input: [
      { racer_id: 1, race_date: null, t: "n" },
      { racer_id: 1, race_date: "2026-10-20", t: "d" },
    ],
    specification: "日付が null の扱いは未定（現在は null の行が最新になる）",
  },
  {
    input: [
      { racer_id: 1, t: "u" },
      { racer_id: 1, race_date: "2026-10-20", t: "d" },
    ],
    specification:
      "日付が undefined の扱いは未定（現在は欠けた行が最新になる）",
  },
  {
    input: [
      { racer_id: "1", race_date: "2026-10-23" },
      { racer_id: 1, race_date: "2026-10-20" },
    ],
    specification: "文字列と数の選手IDの扱いは未定（現在は別の選手になる）",
  },
].map((gap) => ({
  ...gap,
  current: [...pickLatestPretestByRacer(gap.input).entries()],
}));

export const LABEL_CASES = [
  ["予選特賞", "ja", { text: "予選特賞", isOfficial: true }],
  [
    "予選特賞",
    "en",
    { text: "T(raceStage.qualifierSpecial)", isOfficial: false },
  ],
  [
    "予選特賞",
    "zh",
    { text: "T(raceStage.qualifierSpecial)", isOfficial: false },
  ],
  ["一般", "ko", { text: "T(raceStage.general)", isOfficial: false }],
  ["優勝戦", "en", { text: "T(raceStage.final)", isOfficial: false }],
  [
    "準優進出戦",
    "en",
    { text: "T(raceStage.semifinalQualifier)", isOfficial: false },
  ],
  ["ＤＲ", "en", { text: "T(raceStage.dream)", isOfficial: false }],
  ["朝からセンプル", "en", { text: "朝からセンプル", isOfficial: true }],
  ["朝からセンプル", "ja", { text: "朝からセンプル", isOfficial: true }],
  ["", "en", null],
  [null, "en", null],
  [undefined, "ja", null],
];

// ---- 2. 算入範囲（予選の締め） ----------------------------------------------
// 若松G1（2026-09-22〜27）。4日目までが予選で、5日目に一般戦＋準優、
// 最終日に特別選抜戦＋優勝戦。予選の締めは4日目12R
export const WAKAMATSU = [
  ...Array.from({ length: 11 }, (_, i) => ({
    race_id: `2026-09-22-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  { race_id: "2026-09-22-20-12", race_stage: "ドリーム戦" },
  ...Array.from({ length: 12 }, (_, i) => ({
    race_id: `2026-09-25-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    race_id: `2026-09-26-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "一般戦",
  })),
  { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-12", race_stage: "一般戦" },
  { race_id: "2026-09-27-20-10", race_stage: "特別選抜戦" },
  { race_id: "2026-09-27-20-12", race_stage: "優勝戦" },
];

export const TAMAGAWA_RACERS = new Map([
  ["2026-03-20-05-01", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-03-20-05-02", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-03-20-05-03", [1007, 1008, 1009, 1010, 1011, 1012]],
  ["2026-03-20-05-04", [2007, 2008, 2009, 2010, 2011, 2012]],
  ["2026-03-21-05-01", [1001, 1002, 1003, 1007, 1008, 1009]],
  ["2026-03-21-05-02", [2001, 2002, 2003, 2007, 2008, 2009]],
  // **Ｗ準優戦は同じ12名が顔ぶれを組み替えて2回走るヒート**（実データがこの形）。
  // 前半・後半のそれぞれに両方の側が入っており、「前半＝男子／後半＝女子」では
  // ない。本数×6で数えると 4本×6 = 24枠になるが、実際に走るのは12名
  ["2026-03-24-05-03", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-03-24-05-05", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-03-24-05-09", [1007, 1008, 1009, 1010, 1011, 1012]],
  ["2026-03-24-05-11", [2007, 2008, 2009, 2010, 2011, 2012]],
  // 最終日の消化レース。**両方の側が同居する**（実データと同じ形）
  ["2026-03-25-05-01", [1001, 2001, 1002, 2002, 1003, 2003]],
  ["2026-03-25-05-12", [1001, 1002, 1003, 1004, 1005, 1006]],
]);

// 丸亀の一般戦（2026-03-02〜05）。1R〜5Rが「予選」で、6R以降は会場固有名。
// 予選の締めは2日目5Rだが、同じ日の6R〜10Rも番組上は予選なので算入する
// （旧実装では丸ごと落ちていた。BOA-457）
export const MARUGAME = [
  ...[1, 2, 3, 4, 5].map((r) => ({
    race_id: `2026-03-03-15-${String(r).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  { race_id: "2026-03-03-15-06", race_stage: "かけうどん６" },
  { race_id: "2026-03-03-15-09", race_stage: "ウチまる特賞" },
  { race_id: "2026-03-03-15-10", race_stage: "蒼月まるる特賞" },
  { race_id: "2026-03-03-15-11", race_stage: "一般選抜" },
  { race_id: "2026-03-03-15-12", race_stage: "一般選抜" },
  { race_id: "2026-03-04-15-01", race_stage: "一般" },
  { race_id: "2026-03-04-15-09", race_stage: "準優勝戦" },
];

export const KIRYU_RACERS = new Map([
  // 男子（予選男子・準優08・優勝11）
  ["2026-09-20-01-01", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-09-21-01-01", [1001, 1002, 1003, 1007, 1008, 1009]],
  ["2026-09-24-01-08", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-09-25-01-11", [1001, 1002, 1003, 1004, 1005, 1006]],
  // 女子（予選女子・準優10・優勝12）
  ["2026-09-20-01-02", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-09-21-01-02", [2001, 2002, 2003, 2007, 2008, 2009]],
  ["2026-09-24-01-10", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-09-25-01-12", [2001, 2002, 2003, 2004, 2005, 2006]],
]);

export const KIRYU_W = [
  { race_id: "2026-09-20-01-01", race_stage: "予選男子", race_title: W_TITLE },
  { race_id: "2026-09-20-01-02", race_stage: "予選女子", race_title: W_TITLE },
  { race_id: "2026-09-21-01-01", race_stage: "予選男子", race_title: W_TITLE },
  { race_id: "2026-09-21-01-02", race_stage: "予選女子", race_title: W_TITLE },
  { race_id: "2026-09-24-01-08", race_stage: "準優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-24-01-10", race_stage: "準優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-25-01-11", race_stage: "優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-25-01-12", race_stage: "優勝戦", race_title: W_TITLE },
];

// 蒲郡の一般戦。5日目に「準優進出戦」4個、6日目に「準優勝戦」3個。
// 準優の枠は18で、42（7個×6）ではない
export const GAMAGORI = [
  { race_id: "2026-02-13-07-09", race_stage: "予選特賞" },
  { race_id: "2026-02-13-07-10", race_stage: "一般特賞" },
  { race_id: "2026-02-13-07-11", race_stage: "一般特選" },
  { race_id: "2026-02-14-07-08", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-09", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-10", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-11", race_stage: "準優進出戦" },
  { race_id: "2026-02-15-07-09", race_stage: "準優勝戦" },
  { race_id: "2026-02-15-07-10", race_stage: "準優勝戦" },
  { race_id: "2026-02-15-07-11", race_stage: "準優勝戦" },
];
