/**
 * verify-venue-motor-stats-parsers.js - BOA-264のパーサーが正しく動作するかを
 * 保存済みの実データHTMLフィクスチャ（scripts/lib/venueMotorStats/__fixtures__/）
 * に対して検証する回帰テスト。
 *
 * 会場公式サイトのHTML構造は今後も変わりうるため、パーサーのロジック自体に
 * 手を入れた際にデグレを機械的に検知する目的で、実際に確認した値を期待値として
 * ハードコードしている（フィクスチャ取得日時点の実データ、値そのものは日々変わる
 * ため「その日のスナップショットに対して正しくパースできているか」の検証）。
 *
 * 会場公式サイトの構造変化そのものを本番環境で継続的に検知する仕組みはBOA-285で
 * 別途整備する（本スクリプトはローカルの固定フィクスチャに対する回帰テストのみ）。
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import { parseGenericMotorTable } from "../lib/venueMotorStats/parsers/genericTable.js";

const FIXTURE_DIR = new URL(
  "../lib/venueMotorStats/__fixtures__/",
  import.meta.url,
);

function loadFixture(name) {
  const html = fs.readFileSync(new URL(`${name}.html`, FIXTURE_DIR), "utf8");
  return cheerio.load(html);
}

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(
      `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`✅ ${label}`);
  }
}

// ①福岡フル型
{
  const $ = loadFixture("fukuoka");
  const { data } = parseGenericMotorTable($);
  const m43 = data.find((d) => d.motorNumber === 43);
  check("福岡 43号機 節数", m43.meetCount, 11);
  check("福岡 43号機 出走回数", m43.raceCount, 104);
  check("福岡 43号機 優出回数", m43.finalCount, 6);
  check("福岡 43号機 優勝回数", m43.championshipCount, 0);
  check("福岡 43号機 最高タイム(秒)", m43.bestTime, 108.5);
  check("福岡 全体件数(65)", data.length, 65);
}

// ①福岡フル型（算出期間が個別・稀に空行あり）
{
  const $ = loadFixture("biwako");
  const { data } = parseGenericMotorTable($);
  const m12 = data.find((d) => d.motorNumber === 12);
  check("びわこ 12号機 節数", m12.meetCount, 12);
  check("びわこ 12号機 出走回数", m12.raceCount, 102);
  check("びわこ 12号機 算出期間開始", m12.statsPeriodStart, "2026-04-08");
  check("びわこ 12号機 算出期間終了", m12.statsPeriodEnd, "2026-08-31");
  check("びわこ 全体件数(62)", data.length, 62);
}

// ②下関/motordata型（節数・事故率なし、平均展示タイムあり）
{
  const $ = loadFixture("shimonoseki");
  const { data } = parseGenericMotorTable($);
  const m17 = data.find((d) => d.motorNumber === 17);
  check("下関 17号機 節数(取得不可のためnull)", m17.meetCount, null);
  check("下関 17号機 出走回数", m17.raceCount, 89);
  check("下関 17号機 平均展示タイム", m17.avgExhibitionTime, 6.82);
}

// ②下関/motordata型・列順が異なる会場（芦屋: No/前節評価列が先頭に追加）
{
  const $ = loadFixture("ashiya");
  const { data } = parseGenericMotorTable($);
  const m56 = data.find((d) => d.motorNumber === 56);
  check("芦屋 56号機 出走回数（列順が違っても正しく取得）", m56.raceCount, 93);
  check("芦屋 56号機 2連対率", m56.top2Rate, 48.39);
}

// ②下関/motordata型（残り会場、下関と同一列構成であることの確認）
{
  const $ = loadFixture("wakamatsu");
  const { data } = parseGenericMotorTable($);
  const m49 = data.find((d) => d.motorNumber === 49);
  check("若松 49号機 出走回数", m49.raceCount, 171);
  check("若松 49号機 優勝回数", m49.championshipCount, 3);
}
{
  const $ = loadFixture("tamagawa");
  const { data } = parseGenericMotorTable($);
  const m32 = data.find((d) => d.motorNumber === 32);
  check("多摩川 32号機 出走回数", m32.raceCount, 105);
  check("多摩川 32号機 平均展示タイム", m32.avgExhibitionTime, 6.73);
}
{
  const $ = loadFixture("naruto");
  const { data } = parseGenericMotorTable($);
  const m82 = data.find((d) => d.motorNumber === 82);
  check("鳴門 82号機 出走回数", m82.raceCount, 78);
  check("鳴門 82号機 2連対率", m82.top2Rate, 61.54);
}

// ③簡易ランキング型（出走回数列自体が無い）
{
  const $ = loadFixture("kiryu");
  const { data } = parseGenericMotorTable($);
  const m27 = data.find((d) => d.motorNumber === 27);
  check("桐生 27号機 出走回数（列が無いためnull）", m27.raceCount, null);
  check("桐生 27号機 優出回数", m27.finalCount, 8);
  check("桐生 27号機 優勝回数", m27.championshipCount, 3);
}

// ③簡易ランキング型（残り会場）
{
  const $ = loadFixture("tokoname");
  const { data } = parseGenericMotorTable($);
  const m14 = data.find((d) => d.motorNumber === 14);
  check("常滑 14号機 優出回数", m14.finalCount, 6);
  check("常滑 14号機 優勝回数", m14.championshipCount, 2);
}
{
  const $ = loadFixture("mikuni");
  const { data } = parseGenericMotorTable($);
  const m35 = data.find((d) => d.motorNumber === 35);
  check("三国 35号機 優出回数", m35.finalCount, 2);
  check("三国 35号機 2連対率", m35.top2Rate, 47.01);
}
{
  const $ = loadFixture("amagasaki");
  const { data } = parseGenericMotorTable($);
  const m23 = data.find((d) => d.motorNumber === 23);
  check("尼崎 23号機 優出回数", m23.finalCount, 3);
  check("尼崎 23号機 優勝回数", m23.championshipCount, 1);
}

// ④asp/htmlmade型（見出し語が「優勝回数」ではなく「優勝」等の略記）
{
  const $ = loadFixture("kojima");
  const { data } = parseGenericMotorTable($);
  const m20 = data.find((d) => d.motorNumber === 20);
  check("児島 20号機 出走回数（略記見出しでも取得できる）", m20.raceCount, 211);
  check("児島 20号機 最高タイム(秒)", m20.bestTime, 106.4);
  check(
    "児島 全モーターがユニーク（凡例行の混入なし）",
    new Set(data.map((d) => d.motorNumber)).size,
    data.length,
  );
}

// ⑦大村（完全独自CMS、1モーター2行構成: 主要13列 + 4/5/6着のみの3列継続行）
{
  const $ = loadFixture("omura");
  const { data } = parseGenericMotorTable($);
  const m41 = data.find((d) => d.motorNumber === 41);
  check("大村 41号機 出走回数", m41.raceCount, 75);
  check("大村 41号機 算出期間開始", m41.statsPeriodStart, "2026-05-24");
  check("大村 41号機 最高タイム(秒)", m41.bestTime, 109.3);
  check(
    "大村 全モーターがユニーク（4/5/6着継続行が混入していない）",
    new Set(data.map((d) => d.motorNumber)).size,
    data.length,
  );
}

// ③簡易ランキング型・見出し表記が「2連率」（対の字が無い）会場
{
  const $ = loadFixture("tsu");
  const { data } = parseGenericMotorTable($);
  const m44 = data.find((d) => d.motorNumber === 44);
  check("津 44号機 2連率（「2連率」表記でも取得できる）", m44.top2Rate, 45.59);
  check(
    "津 全モーターがユニーク（セル内ネストテーブルに巻き込まれていない）",
    new Set(data.map((d) => d.motorNumber)).size,
    data.length,
  );
}

// 現在データが公開されていない会場（新モーター切替期間中）は「見つからない」と
// 正しく判定できることを確認する（誤ったデータを拾わないことの確認）
{
  const $ = loadFixture("karatsu");
  const { data, reason } = parseGenericMotorTable($);
  check("唐津（切替期間中でデータ無し）", data, null);
  check("唐津 失敗理由", reason, "motor_stats_table_not_found");
}

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
