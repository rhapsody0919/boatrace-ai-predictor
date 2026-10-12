#!/usr/bin/env node
/**
 * 日中の照合（verify-bot-html-parity.js、ADR 0089「監視」）の関数 scripts/lib/botHtmlParity.js を、
 * 本番の HTML と人の DOM を1回保存したフィクスチャ（scripts/lib/__fixtures__/bot-html-parity/、2026-10-12）で確かめる。
 * ネットワークにもブラウザにも繋がない。
 *
 * 守るもの:
 * 1. 同じなら通る: 本番のボット向け HTML（/・/venue/1・/venue/2）と、同じ時点の人の DOM で、無いものが0件
 * 2. 人の DOM に無い文言・リンク・title を1つ足したボット HTML で落ちる（足したものだけが一覧に出る）
 * 3. 最終更新の時刻: CDN の差（2分）は通り、許容を超える差・前置きの違いは落ちる
 * 4. 取り違え: 人の UA にボット向け HTML が返った応答を "bot" と見分ける（SPA の外枠は "spa"）
 * 5. 開催中の会場の選び方（中止だけの会場を飛ばす・place_cd の順・レースの URL）と中央値
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyHtml,
  evaluateSnapshotStatus,
  extractBotItems,
  findMissing,
  median,
  pickOpenVenues,
} from "../lib/botHtmlParity.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FIX = path.join(repoRoot, "scripts/lib/__fixtures__/bot-html-parity");
const readFix = (name) => readFileSync(path.join(FIX, name), "utf8");
const ORIGIN = "https://www.boat-ai.jp";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const pages = [
  { name: "top", path: "/" },
  { name: "venue-1", path: "/venue/1" },
  { name: "venue-2", path: "/venue/2" },
];

// ---- 1. 同じなら通る ----
for (const p of pages) {
  const botHtml = readFix(`${p.name}.bot.html`);
  const human = JSON.parse(readFix(`${p.name}.human-dom.json`));
  const bot = extractBotItems(botHtml);
  check(`${p.path}: 本文の文字列を取り出せる`, bot.texts.length > 5, true);
  check(
    `${p.path}: canonical を取り出せる`,
    bot.head.canonical,
    `${ORIGIN}${p.path}`,
  );
  check(
    `${p.path}: 本番の HTML と人の DOM で無いものは0件`,
    findMissing(bot, human, ORIGIN),
    [],
  );
}

// 取り出す文字列が実際に見出し・会場名・締切時刻・リンクを含む（取り出しが空振りしていない）
{
  const top = extractBotItems(readFix("top.bot.html"));
  check(
    "/: 見出しを含む",
    top.texts.some((t) => t.startsWith("🏁 本日開催中のレース")),
    true,
  );
  check(
    "/: 会場名（開催なしの会場も）を含む",
    ["桐生", "平和島"].every((n) => top.texts.includes(n)),
    true,
  );
  check("/: 会場ページへのリンクを含む", top.hrefs.includes("/venue/1"), true);
  const v1 = extractBotItems(readFix("venue-1.bot.html"));
  check(
    "/venue/1: 締切時刻の見出しを含む",
    v1.texts.includes("締切予定時刻"),
    true,
  );
  check("/venue/1: レース番号を含む", v1.texts.includes("12R"), true);
  check(
    "/venue/1: レース詳細へのリンクを含む",
    v1.hrefs.includes("/race/2026-10-12-01-01"),
    true,
  );
}

// ---- 2. 人の DOM に無いものを1つ足すと落ちる ----
{
  const botHtml = readFix("venue-1.bot.html");
  const human = JSON.parse(readFix("venue-1.human-dom.json"));
  const extraText = "ボットにだけ出す文言";
  const withText = botHtml.replace(
    "</ol>",
    `<li><span>${extraText}</span></li>\n</ol>`,
  );
  check(
    "文言を1つ足すと、その文言だけが無いものに出る",
    findMissing(extractBotItems(withText), human, ORIGIN),
    [{ kind: "text", value: extraText }],
  );

  const withLink = botHtml.replace(
    "</ol>",
    '<li><a href="/race/2026-10-12-01-13">詳細を見る</a></li>\n</ol>',
  );
  check(
    "リンク先を1つ足すと、そのリンク先だけが無いものに出る",
    findMissing(extractBotItems(withLink), human, ORIGIN),
    [{ kind: "href", value: "/race/2026-10-12-01-13" }],
  );

  const withTitle = botHtml.replace(
    /<title>[^<]*<\/title>/,
    "<title>ボットだけの title</title>",
  );
  check(
    "title が違うと落ちる",
    findMissing(extractBotItems(withTitle), human, ORIGIN),
    [{ kind: "title", value: "ボットだけの title" }],
  );

  const withCanonical = botHtml.replace(
    `href="${ORIGIN}/venue/1"`,
    `href="${ORIGIN}/venue/01"`,
  );
  check(
    "canonical が違うと落ちる",
    findMissing(extractBotItems(withCanonical), human, ORIGIN),
    [{ kind: "canonical", value: `${ORIGIN}/venue/01` }],
  );

  // 人の DOM から1件消しても落ちる（向きを取り違えていない）
  const humanWithoutDeadline = {
    ...human,
    text: human.text.replaceAll("15:19", ""),
  };
  check(
    "人の画面から締切時刻が消えると落ちる",
    findMissing(extractBotItems(botHtml), humanWithoutDeadline, ORIGIN),
    [{ kind: "text", value: "15:19" }],
  );
}

// ---- 3. 最終更新の時刻 ----
{
  const botHtml = readFix("top.bot.html");
  const human = JSON.parse(readFix("top.human-dom.json"));
  const stamp = /レースデータ更新: (\d{2}\/\d{2}) (\d{2}):(\d{2})/.exec(
    botHtml,
  );
  check("フィクスチャに最終更新がある", Boolean(stamp), true);
  // フィクスチャは本番で取ったままの 08:42（ボット）と 08:40（人）。1 の「0件」はこの許容で通っている
  const at = (hhmm) =>
    botHtml.replace(
      /レースデータ更新: \d{2}\/\d{2} \d{2}:\d{2}/,
      `レースデータ更新: ${stamp[1]} ${hhmm}`,
    );
  check(
    "最終更新が人と同じ時刻なら通る",
    findMissing(extractBotItems(at("08:40")), human, ORIGIN),
    [],
  );
  check(
    "最終更新が30分ずれると落ちる",
    findMissing(extractBotItems(at("09:10")), human, ORIGIN),
    [{ kind: "text", value: `レースデータ更新: ${stamp[1]} 09:10` }],
  );
  const otherLabel = botHtml.replace("レースデータ更新:", "オッズ更新:");
  check(
    "前置きの文言が違えば時刻が近くても落ちる",
    findMissing(extractBotItems(otherLabel), human, ORIGIN).map((m) => m.kind),
    ["text"],
  );
  check(
    "許容を0分にすると2分の差で落ちる",
    findMissing(extractBotItems(botHtml), human, ORIGIN, {
      stampToleranceMin: 0,
    }).length,
    1,
  );
}

// ---- 4. 取り違え ----
{
  check(
    "人の UA の応答（本番の index.html）は SPA の外枠",
    classifyHtml(readFix("top.human-ua.html")),
    "spa",
  );
  check(
    "人の UA にボット向け HTML が返った応答は bot（取り違え）",
    classifyHtml(readFix("top.bot.html")),
    "bot",
  );
  check(
    "会場ページのボット向け HTML も bot",
    classifyHtml(readFix("venue-1.bot.html")),
    "bot",
  );
  check(
    "エラーの本文は unknown",
    classifyHtml("503 Service Unavailable\n"),
    "unknown",
  );
}

// ---- 5. 会場の選び方・中央値 ----
{
  const json = JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        "scripts/lib/__fixtures__/races-today/races-today-2026-10-11.json",
      ),
      "utf8",
    ),
  );
  check(
    "本番の races/today から place_cd の順に2会場",
    pickOpenVenues(json, 2).map((v) => [v.code, v.firstRacePath]),
    [
      [1, "/race/2026-10-11-01-01"],
      [2, "/race/2026-10-11-02-01"],
    ],
  );
  const cancelledFirst = {
    data: [
      {
        place_cd: 5,
        place_name: "多摩川",
        races: [
          { raceNo: 1, date: "2026-10-12", cancellationStatus: "cancelled" },
        ],
      },
      {
        place_cd: 4,
        place_name: "平和島",
        races: [
          { raceNo: 1, date: "2026-10-12", cancellationStatus: "cancelled" },
          { raceNo: 2, date: "2026-10-12", cancellationStatus: null },
        ],
      },
    ],
  };
  check(
    "中止だけの会場を飛ばし、中止でない最初のレースを使う",
    pickOpenVenues(cancelledFirst, 2).map((v) => [v.code, v.firstRacePath]),
    [[4, "/race/2026-10-12-04-02"]],
  );
  check("開催が無ければ空", pickOpenVenues({ success: true, data: [] }, 2), []);
  check("壊れた入力でも空（例外にしない）", pickOpenVenues(null, 2), []);
  check("中央値（奇数）", median([30, 10, 20]), 20);
  check("中央値（偶数）", median([40, 10, 20, 30]), 25);
  check("中央値（空）", median([]), null);
}

// status.json の判定（SEO 再点検 F5）。失敗や途中停止を ok にしない
{
  const ok = {
    generatedAt: "t",
    ok: true,
    blog: { total: 121, succeeded: 121, failedIds: [], fatalError: null },
  };
  const failed = {
    generatedAt: "t",
    ok: false,
    blog: {
      total: 121,
      succeeded: 119,
      failedIds: ["a", "b"],
      fatalError: null,
    },
  };
  const fatal = {
    generatedAt: "t",
    ok: false,
    blog: { total: 121, succeeded: null, failedIds: [], fatalError: "closed" },
  };
  check(
    "status.json: 全件成功は ok",
    evaluateSnapshotStatus(200, JSON.stringify(ok)).level,
    "ok",
  );
  check(
    "status.json: 失敗があれば fail",
    evaluateSnapshotStatus(200, JSON.stringify(failed)).level,
    "fail",
  );
  check(
    "status.json: 失敗した ID をメッセージに出す",
    evaluateSnapshotStatus(200, JSON.stringify(failed)).message.includes(
      "a, b",
    ),
    true,
  );
  check(
    "status.json: 途中で止まったら fail",
    evaluateSnapshotStatus(200, JSON.stringify(fatal)).level,
    "fail",
  );
  check(
    "status.json: 404 は注記（デプロイ前）",
    evaluateSnapshotStatus(404, "").level,
    "note",
  );
  check(
    "status.json: JSON でない（SPA の外枠）は fail",
    evaluateSnapshotStatus(200, "<!doctype html>").level,
    "fail",
  );
  check(
    "status.json: 形が違えば fail",
    evaluateSnapshotStatus(200, "{}").level,
    "fail",
  );
  check(
    "status.json: 500 は fail",
    evaluateSnapshotStatus(500, "").level,
    "fail",
  );
}

if (failures.length > 0) {
  console.error(
    `verify-bot-html-parity-logic: ${failures.length}/${checked} 件が失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`verify-bot-html-parity-logic: ${checked} 件すべて合格`);
