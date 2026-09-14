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

// 実フィクスチャは全て単語1つのステージ名のみのため、複数語のステージ名
// （例: 「N日目 準優勝戦」）が来た場合に先頭語だけを誤って切り出さないことを
// 合成HTMLで検証する（末尾の距離表記を除去する実装であることの回帰確認）
{
  const $ = cheerio.load(
    '<h3 class="title16_titleDetail__add2020">5日目\u3000準優勝戦\u3000\u3000\u30001800m</h3>',
  );
  check(
    "複数語のステージ名（合成データ、末尾の距離表記だけを除去）",
    _internal.scrapeRaceStage($),
    "5日目\u3000準優勝戦",
  );
}

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
