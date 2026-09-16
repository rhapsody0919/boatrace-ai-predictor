#!/usr/bin/env node
/**
 * 進入コース別選手成績パーサー（BOA-293）のフィクスチャベース回帰テスト。
 * 実データ（2026-09-16、常滑・徳山・三国・唐津から取得したHTML）を
 * __fixtures__ に保存し、parseEntryCourseHtml() の出力を固定値と比較する。
 *
 * - tokoname: 通常ケース（女子戦アイコン付き選手名の除去を含む）
 * - tokuyama: ヘッダーニュース欄に「次節開催」の文言が出現するが、本文の
 *   進入コーステーブル自体は正常に取得できる必要がある（誤検知防止の回帰）
 * - mikuni: 非開催期間（テーブル自体が存在せず no_active_meet を返す）
 * - karatsu: table自体のclass名が他会場と異なる（com-table01 vs par-table01）
 *   場合でも、クラス名ではなく見出しテキストで解決できることの確認
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEntryCourseHtml } from "../lib/venueEntryCourseStats/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(
  __dirname,
  "../lib/venueEntryCourseStats/__fixtures__",
);

let failures = 0;

function check(label, actual, expected) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}`);
    console.error(`  expected: ${expectedStr}`);
    console.error(`  actual:   ${actualStr}`);
  }
}

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

function main() {
  // 通常ケース: 常滑（女子戦アイコン付き選手名）
  const tokoname = parseEntryCourseHtml(loadFixture("tokoname.html"));
  check("tokoname: reason", tokoname.reason, null);
  check("tokoname: 総行数（6枠×6進入コース）", tokoname.data?.length, 36);
  check("tokoname: 枠数", new Set(tokoname.data?.map((r) => r.waku)).size, 6);
  check(
    "tokoname: 1枠目の選手名（imgタグ除去済み）",
    tokoname.data?.[0]?.racerNameRaw,
    "山口　真喜子",
  );
  check("tokoname: 1枠1コース目の値", tokoname.data?.[0], {
    waku: 1,
    racerNameRaw: "山口　真喜子",
    entryCourse: 1,
    entryRate: 18.9,
    avgSt: 0.16,
    placeRates: [52.5, 20, 12.5, 10, 5, 0],
  });
  check("tokoname: 集計期間", tokoname.statsPeriod, {
    start: "2025-09-01",
    end: "2026-08-01",
  });

  // 徳山: ヘッダーニュース欄に「次節開催」の文言があるが、本文テーブルは正常
  const tokuyama = parseEntryCourseHtml(loadFixture("tokuyama.html"));
  check(
    "tokuyama: reason（ニュース欄の「次節開催」誤検知なし）",
    tokuyama.reason,
    null,
  );
  check("tokuyama: 総行数", tokuyama.data?.length, 36);

  // 三国: 非開催期間（テーブル自体が存在しない）
  const mikuni = parseEntryCourseHtml(loadFixture("mikuni.html"));
  check("mikuni: reason", mikuni.reason, "no_active_meet");
  check("mikuni: data", mikuni.data, null);

  // 唐津: テーブルのclass名が常滑と異なる（com-table01 vs par-table01）
  const karatsu = parseEntryCourseHtml(loadFixture("karatsu.html"));
  check(
    "karatsu: reason（class名の違いに依存しない解決）",
    karatsu.reason,
    null,
  );
  check("karatsu: 総行数", karatsu.data?.length, 36);
  check(
    "karatsu: 1枠目の選手名",
    karatsu.data?.[0]?.racerNameRaw,
    "芝田　　浩治",
  );

  console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
