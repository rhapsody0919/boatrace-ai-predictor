/**
 * verify-race-stage-parsing.js - BOA-226のレースステージ抽出
 * （scripts/daily/update-race-info.jsのscrapeRaceStage）の回帰テスト。
 * 実際に公式サイト（boatrace.jp）から取得したracelistページのHTMLを
 * フィクスチャとして使い、想定通りの文字列が抽出できるか検証する
 * （大村G1最終日12R=優勝戦、初日1R=予選、福岡の通常レース=カタメン１予選、
 * いずれも2026-09-14に実データで確認済み）。
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import { _internal } from "../daily/update-race-info.js";

const FIXTURE_DIR = new URL("../lib/__fixtures__/raceInfo/", import.meta.url);

function loadFixture(name) {
  const html = fs.readFileSync(new URL(`${name}.html`, FIXTURE_DIR), "utf8");
  return cheerio.load(html);
}

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) {
    failures++;
    console.error(`❌ ${label}: expected "${expected}", got "${actual}"`);
  } else {
    console.log(`✅ ${label}`);
  }
}

check(
  "大村G1最終日12R（優勝戦）",
  _internal.scrapeRaceStage(loadFixture("racelist-championship")),
  "優勝戦",
);
check(
  "大村G1初日1R（予選）",
  _internal.scrapeRaceStage(loadFixture("racelist-preliminary")),
  "予選",
);
check(
  "福岡の通常レース（カタメン１予選）",
  _internal.scrapeRaceStage(loadFixture("racelist-ippan")),
  "カタメン１予選",
);

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
