#!/usr/bin/env node
/**
 * verify-race-notices-parser.js - FR-1（レース特記事項、BOA-318/319/320）の
 * パーサー（scripts/daily/scrape-race-information.js）の回帰テスト。
 *
 * 実際に公式サイト（boatrace.jp）から取得したrace/informationページのHTMLを
 * フィクスチャとして使い、想定通りに抽出できるか検証する。
 * - no-notices.html: jcd=01 hd=20260910（2026-09-15取得、3区分とも
 *   「※ 現在、お知らせはありません。」の通常状態）
 * - with-notices.html: jcd=12 hd=20171224（2026-09-15、検索エンジンのインデックス
 *   経由で発見・取得した実データ。3区分とも実際の通知行を含む唯一確認できた実例）
 */
import fs from "node:fs";
import { _internal } from "../daily/scrape-race-information.js";

const FIXTURE_DIR = new URL(
  "../lib/__fixtures__/raceNotices/",
  import.meta.url,
);

function loadFixture(name) {
  return fs.readFileSync(new URL(`${name}.html`, FIXTURE_DIR), "utf8");
}

let failures = 0;
function check(label, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  const pass = actualJson === expectedJson;
  if (!pass) {
    failures++;
    console.error(
      `❌ ${label}\n  expected: ${expectedJson}\n  actual:   ${actualJson}`,
    );
  } else {
    console.log(`✅ ${label}`);
  }
}

// --- resolveRaceDate: 年またぎの日付復元 ---
check(
  "resolveRaceDate: 通常（同年12月）",
  _internal.resolveRaceDate("12/19", "20171224"),
  "2017-12-19",
);
check(
  "resolveRaceDate: 年またぎ（1月hd×12月行→前年）",
  _internal.resolveRaceDate("12/30", "20260102"),
  "2025-12-30",
);
check(
  "resolveRaceDate: 不正な形式はnull",
  _internal.resolveRaceDate("abc", "20260910"),
  null,
);

// --- normalizeRacerName ---
check(
  "normalizeRacerName: 全角スペース除去",
  _internal.normalizeRacerName("岡崎　　恭裕"),
  "岡崎恭裕",
);

// --- parseAccidentRow ---
check(
  "parseAccidentRow: 減点あり",
  _internal.parseAccidentRow([
    "12/19",
    "10R",
    "岡崎　　恭裕",
    "落水失格（選手責任）",
    "減点5点",
  ]),
  {
    dateText: "12/19",
    racerName: "岡崎　　恭裕",
    detailText: "落水失格（選手責任） 減点5点",
    structuredData: {
      raceNo: 10,
      violation: "落水失格（選手責任）",
      penaltyText: "減点5点",
      penaltyPoints: 5,
    },
  },
);
check(
  "parseAccidentRow: 処置なし（減点無し）",
  _internal.parseAccidentRow([
    "12/24",
    "11R",
    "新田　　雄史",
    "待機行動違反",
    "処置なし",
  ]),
  {
    dateText: "12/24",
    racerName: "新田　　雄史",
    detailText: "待機行動違反 処置なし",
    structuredData: {
      raceNo: 11,
      violation: "待機行動違反",
      penaltyText: "処置なし",
      penaltyPoints: null,
    },
  },
);

// --- parseEquipmentChangeRow ---
check(
  "parseEquipmentChangeRow: ボート変更",
  _internal.parseEquipmentChangeRow([
    "12/19",
    "岡崎　　恭裕",
    "26→69（ボート変更）",
    "2日目より使用",
  ]),
  {
    dateText: "12/19",
    racerName: "岡崎　　恭裕",
    detailText: "26→69（ボート変更） 2日目より使用",
    structuredData: {
      equipmentType: "boat",
      oldNumber: 26,
      newNumber: 69,
      effectiveFrom: "2日目より使用",
    },
  },
);

// --- parseAbsenceRow ---
check(
  "parseAbsenceRow: 帰郷（私傷病のため）",
  _internal.parseAbsenceRow(["12/22", "江口　　晃生", "帰郷（私傷病のため）"]),
  {
    dateText: "12/22",
    racerName: "江口　　晃生",
    detailText: "帰郷（私傷病のため）",
    structuredData: {
      type: "帰郷",
      subReason: "私傷病のため",
      rawText: "帰郷（私傷病のため）",
    },
  },
);

// --- parseInformationHtml: 実HTMLフィクスチャ ---
const noNoticesResult = _internal.parseInformationHtml(
  loadFixture("no-notices"),
  "20260910",
);
check(
  "parseInformationHtml (no-notices): reasonはnull",
  noNoticesResult.reason,
  null,
);
check(
  "parseInformationHtml (no-notices): notesは空配列",
  noNoticesResult.notes,
  [],
);

const withNoticesResult = _internal.parseInformationHtml(
  loadFixture("with-notices"),
  "20171224",
);
check(
  "parseInformationHtml (with-notices): reasonはnull",
  withNoticesResult.reason,
  null,
);
check(
  "parseInformationHtml (with-notices): 通知件数（事故5+機材2+欠場2=9件）",
  withNoticesResult.notes?.length,
  9,
);
check(
  "parseInformationHtml (with-notices): 区分ごとの内訳",
  {
    accident: withNoticesResult.notes.filter((n) => n.category === "accident")
      .length,
    equipment_change: withNoticesResult.notes.filter(
      (n) => n.category === "equipment_change",
    ).length,
    absence: withNoticesResult.notes.filter((n) => n.category === "absence")
      .length,
  },
  { accident: 5, equipment_change: 2, absence: 2 },
);
check(
  "parseInformationHtml (with-notices): 1件目（事故、日付復元含む）",
  withNoticesResult.notes[0],
  {
    category: "accident",
    raceDate: "2017-12-19",
    racerName: "岡崎　　恭裕",
    detailText: "落水失格（選手責任） 減点5点",
    structuredData: {
      raceNo: 10,
      violation: "落水失格（選手責任）",
      penaltyText: "減点5点",
      penaltyPoints: 5,
    },
  },
);
check(
  "parseInformationHtml (with-notices): 欠場・帰郷の最終行",
  withNoticesResult.notes.find(
    (n) => n.category === "absence" && n.racerName === "江口　　晃生",
  ),
  {
    category: "absence",
    raceDate: "2017-12-22",
    racerName: "江口　　晃生",
    detailText: "帰郷（私傷病のため）",
    structuredData: {
      type: "帰郷",
      subReason: "私傷病のため",
      rawText: "帰郷（私傷病のため）",
    },
  },
);

// 未知の見出し構成（構造変化）を検知できることを合成HTMLで確認
const brokenHtml = `<div class="title7"><h3 class="title7_title"><span class="title7_mainLabel">事故・内規違反・減点</span></h3></div><div class="table1"><table><tbody><tr><td class="is-p10-0">※ 現在、お知らせはありません。</td></tr></tbody></table></div>`;
const brokenResult = _internal.parseInformationHtml(brokenHtml, "20260910");
check(
  "parseInformationHtml: 見出しが1つしかない場合はunexpected_section_count",
  brokenResult.reason,
  "unexpected_section_count",
);

const noHeadingHtml = `<div class="somethingElse">構造が変わったページ</div>`;
const noHeadingResult = _internal.parseInformationHtml(
  noHeadingHtml,
  "20260910",
);
check(
  "parseInformationHtml: 見出し自体が無い場合はnotice_section_not_found",
  noHeadingResult.reason,
  "notice_section_not_found",
);
check(
  "parseInformationHtml: 見出し無しの場合notesはnull",
  noHeadingResult.notes,
  null,
);

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
