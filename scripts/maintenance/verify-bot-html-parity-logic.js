#!/usr/bin/env node
/**
 * 日中の照合（verify-bot-html-parity.js、ADR 0089「監視」）の関数 scripts/lib/botHtmlParity.js を、
 * 本番の HTML と人の DOM を1回保存したフィクスチャ（scripts/lib/__fixtures__/bot-html-parity/、2026-10-12）で確かめる。
 * トップ（top・en）は、説明の本文・よくある質問・ブログ欄・案内の帯を足した版の Preview（2026-10-13、PR #1456）で取り直した。
 * 人の DOM の本文は innerText に閉じた <details> の中身を足したもの（verify-bot-html-parity.js の humanSnapshot）
 * ネットワークにもブラウザにも繋がない。
 *
 * 守るもの:
 * 1. 同じなら通る: ボット向け HTML（/・/en/・/venue/1・/venue/2）と、同じ時点の人の DOM で、無いものが0件。
 *    トップのよくある質問の答え（人の画面では閉じた <details> の中）も人の側にある
 * 2. 人の DOM に無い文言・リンク・title を1つ足したボット HTML で落ちる（足したものだけが一覧に出る）
 *    hreflang・JSON-LD も同じ（人に無い行・型・値で落ち、キーの順の違いでは落ちない。BOA-848）
 * 3. 最終更新の時刻: CDN の差（2分）は通り、許容を超える差・前置きの違いは落ちる
 * 4. 取り違え: 人の UA にボット向け HTML が返った応答を "bot" と見分ける（SPA の外枠は "spa"）
 * 5. 開催中の会場の選び方（中止だけの会場を飛ばす・place_cd の順・レースの URL）と中央値
 * 5b. 英字の大文字・小文字は区別しない（人の innerText は CSS の text-transform: uppercase を反映する）
 * 6. 照合するページの一覧（parityPaths）: 言語版は、ボット向け HTML へ振り分けているときだけ照合し、配線前は飛ばす（BOA-848 第2段）
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
  parityPaths,
  pickOpenVenues,
} from "../lib/botHtmlParity.js";
import { resolveSnapshotPath } from "../../src/config/aiCrawlerBots.js";

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
  { name: "en", path: "/en/" },
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
  check(
    "/: 会場ページへのリンクを含む",
    top.hrefs.some((h) => /^\/venue\/\d+$/.test(h)),
    true,
  );
  // 説明の本文・よくある質問・ブログ欄（PR #1456）も取り出して照合している
  check(
    "/: 説明の見出し・よくある質問の見出しと答えを含む",
    [
      top.texts.includes("龍神レーダーのボートレースAI予想"),
      top.texts.includes("よくある質問"),
      top.texts.some((t) => t.startsWith("過去の割合は、画面で選んだ条件")),
    ],
    [true, true, true],
  );
  check(
    "/: 成績ページ・的中レース・ブログ記事へのリンクを含む",
    [
      top.hrefs.includes("/accuracy"),
      top.hrefs.includes("/hit-races"),
      top.hrefs.filter((h) => /^\/blog\/./.test(h)).length,
    ],
    [true, true, 6],
  );
  const en = extractBotItems(readFix("en.bot.html"));
  check(
    "/en/: 案内の帯（/en/about）とブログ記事（/en/blog/...）へのリンクを含む",
    [
      en.hrefs.includes("/en/about"),
      en.hrefs.filter((h) => /^\/en\/blog\/./.test(h)).length,
    ],
    [true, 6],
  );
  // 閉じた <details> の答えを人の側に足していなければ落ちる（照合のロジックを直した理由）
  {
    const human = JSON.parse(readFix("top.human-dom.json"));
    const answer = top.texts.find((t) =>
      t.startsWith("過去の割合は、画面で選んだ条件"),
    );
    check(
      "/: 人の側から閉じた details の答えを除くと、その答えが無いものに出る",
      findMissing(
        top,
        { ...human, text: human.text.replaceAll(answer, "") },
        ORIGIN,
      ).map((m) => m.value),
      [answer],
    );
  }
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

// ---- 2b. hreflang・JSON-LD（BOA-848） ----
// フィクスチャの hreflang・JSON-LD は、PR の Preview（2026-10-12）で取ったボット向け HTML の head と人の DOM を、
// 同日の本番のフィクスチャに足したもの
{
  const top = extractBotItems(readFix("top.bot.html"));
  check(
    "/: hreflang を取り出せる（4言語と x-default）",
    top.head.alternates.map((a) => a.hreflang),
    ["ja", "en", "zh-Hant", "ko", "x-default"],
  );
  check(
    "/: JSON-LD を4つ取り出せる（共通の3つ＋FAQPage）",
    top.head.jsonLd.map((s) => JSON.parse(s)["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "FAQPage"],
  );
  const v1 = extractBotItems(readFix("venue-1.bot.html"));
  check(
    "/venue/1: JSON-LD の型（共通の3つ＋パンくず）",
    v1.head.jsonLd.map((s) => JSON.parse(s)["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "BreadcrumbList"],
  );

  const botHtml = readFix("venue-1.bot.html");
  const human = JSON.parse(readFix("venue-1.human-dom.json"));
  const missingOf = (html, h = human) =>
    findMissing(extractBotItems(html), h, ORIGIN);

  const withAlternate = botHtml.replace(
    "</head>",
    `<link rel="alternate" hreflang="fr" href="${ORIGIN}/fr/venue/1">\n</head>`,
  );
  check(
    "hreflang を1行足すと、その行だけが無いものに出る",
    missingOf(withAlternate),
    [{ kind: "hreflang", value: `fr ${ORIGIN}/fr/venue/1` }],
  );
  const wrongHref = botHtml.replace(
    `hreflang="en" href="${ORIGIN}/en/venue/1"`,
    `hreflang="en" href="${ORIGIN}/en/venue/01"`,
  );
  check("hreflang の URL が違うと落ちる", missingOf(wrongHref), [
    { kind: "hreflang", value: `en ${ORIGIN}/en/venue/01` },
  ]);

  const extraLd = '{"@context":"https://schema.org","@type":"SportsEvent"}';
  check(
    "人に無い型の JSON-LD を足すと落ちる",
    missingOf(
      botHtml.replace(
        "</head>",
        `<script type="application/ld+json">${extraLd}</script>\n</head>`,
      ),
    ),
    [{ kind: "jsonld", value: extraLd }],
  );
  const renamed = botHtml.replace('"name":"桐生"', '"name":"きりゅう"');
  check(
    "JSON-LD の値が1つ違うと落ちる",
    missingOf(renamed).map((m) => [m.kind, JSON.parse(m.value)["@type"]]),
    [["jsonld", "BreadcrumbList"]],
  );
  check(
    "JSON として読めない JSON-LD は落ちる",
    missingOf(
      botHtml.replace(
        "</head>",
        '<script type="application/ld+json">{oops</script>\n</head>',
      ),
    ),
    [{ kind: "jsonld", value: "{oops" }],
  );
  // 人の画面から BreadcrumbList が消えたら落ちる（向きを取り違えていない）
  const humanWithoutCrumb = {
    ...human,
    head: {
      ...human.head,
      jsonLd: human.head.jsonLd.filter((s) => !s.includes("BreadcrumbList")),
    },
  };
  check(
    "人の画面からパンくずの JSON-LD が消えると落ちる",
    missingOf(botHtml, humanWithoutCrumb).map((m) => m.kind),
    ["jsonld"],
  );
  // キーの順・空白の違い（人の側は index.html の整形のまま）は同じとみなす
  const reordered = botHtml.replace(
    /<script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@type":"Organization"[^<]*)<\/script>/,
    (_, json) => {
      const o = JSON.parse(json);
      const flipped = Object.fromEntries(Object.entries(o).reverse());
      return `<script type="application/ld+json">${JSON.stringify(flipped)}</script>`;
    },
  );
  check("キーの順を入れ替えても落ちない", reordered !== botHtml, true);
  check("キーの順を入れ替えても無いものは0件", missingOf(reordered), []);
}

// ---- 3. 最終更新の時刻 ----
// 時刻は人の DOM の値から組む（フィクスチャを取り直しても、ボットと人の差に左右されない）
{
  const botHtml = readFix("top.bot.html");
  const human = JSON.parse(readFix("top.human-dom.json"));
  const STAMP = /レースデータ更新: (\d{2}\/\d{2}) (\d{2}):(\d{2})/;
  const stamp = STAMP.exec(human.text);
  check(
    "フィクスチャに最終更新がある",
    Boolean(stamp && STAMP.test(botHtml)),
    true,
  );
  const plusMin = (min) => {
    const total = Number(stamp[2]) * 60 + Number(stamp[3]) + min;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };
  const at = (hhmm) =>
    botHtml.replace(
      /レースデータ更新: \d{2}\/\d{2} \d{2}:\d{2}/,
      `レースデータ更新: ${stamp[1]} ${hhmm}`,
    );
  check(
    "最終更新が人と同じ時刻なら通る",
    findMissing(extractBotItems(at(plusMin(0))), human, ORIGIN),
    [],
  );
  check(
    "最終更新が2分ずれても通る（CDN の差）",
    findMissing(extractBotItems(at(plusMin(2))), human, ORIGIN),
    [],
  );
  check(
    "最終更新が30分ずれると落ちる",
    findMissing(extractBotItems(at(plusMin(30))), human, ORIGIN),
    [{ kind: "text", value: `レースデータ更新: ${stamp[1]} ${plusMin(30)}` }],
  );
  const otherLabel = botHtml.replace("レースデータ更新:", "オッズ更新:");
  check(
    "前置きの文言が違えば時刻が近くても落ちる",
    findMissing(extractBotItems(otherLabel), human, ORIGIN).map((m) => m.kind),
    ["text"],
  );
  check(
    "許容を0分にすると2分の差で落ちる",
    findMissing(extractBotItems(at(plusMin(2))), human, ORIGIN, {
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

// ---- 5b. CSS の text-transform（人の innerText は大文字になる） ----
{
  const bot = {
    texts: ["Betting deadline", "15:19 JST"],
    hrefs: [],
    head: {
      title: "",
      description: "",
      canonical: "",
      alternates: [],
      jsonLd: [],
    },
  };
  const human = (text) => ({
    text,
    hrefs: [],
    head: {
      title: "",
      description: "",
      canonicals: [""],
      alternates: [],
      jsonLd: [],
    },
  });
  check(
    "uppercase で描かれたラベルは同じとみなす",
    findMissing(bot, human("BETTING DEADLINE\n15:19 JST"), ORIGIN),
    [],
  );
  check(
    "文字が違えば大文字・小文字に関係なく落ちる",
    findMissing(bot, human("BETTING CLOSE\n15:19 JST"), ORIGIN).map(
      (m) => m.value,
    ),
    ["Betting deadline"],
  );
}

// ---- 6. 照合するページの一覧 ----
{
  const langs = ["en", "zh-TW", "ko"];
  const all = () => true;
  check(
    "全部振り分けていれば全部照合する",
    parityPaths([1, 12], { langs, isRouted: all }),
    {
      checked: [
        "/",
        "/venue/1",
        "/venue/12",
        "/today",
        "/en/",
        "/en/venue/1",
        "/zh-TW/",
        "/zh-TW/venue/1",
        "/ko/",
        "/ko/venue/1",
      ],
      skipped: [],
    },
  );
  const jaOnly = (p) => !/^\/(en|zh-TW|ko)\//.test(p) && p !== "/today";
  check(
    "言語版を振り分けていなければ飛ばす",
    parityPaths([1, 12], { langs, isRouted: jaOnly }),
    {
      checked: ["/", "/venue/1", "/venue/12"],
      skipped: [
        "/today",
        "/en/",
        "/en/venue/1",
        "/zh-TW/",
        "/zh-TW/venue/1",
        "/ko/",
        "/ko/venue/1",
      ],
    },
  );
  check(
    "開催が無ければ / と言語版のトップだけ",
    parityPaths([], { langs, isRouted: all }).checked,
    ["/", "/today", "/en/", "/zh-TW/", "/ko/"],
  );
  check(
    "extraPaths（本日のレース詳細）も振り分けているときだけ照合する",
    [
      parityPaths([1], {
        langs: [],
        isRouted: all,
        extraPaths: ["/race/2026-10-12-01-01"],
      }).checked,
      parityPaths([1], {
        langs: [],
        isRouted: (p) => !p.startsWith("/race/"),
        extraPaths: ["/race/2026-10-12-01-01"],
      }).skipped,
    ],
    [
      ["/", "/venue/1", "/today", "/race/2026-10-12-01-01"],
      ["/race/2026-10-12-01-01"],
    ],
  );
  // 照合スクリプトの isRouted（今のリポジトリの振り分け）: 日本語の / と /venue/N は関数へ振り分けている
  const BINGBOT =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36";
  const isRouted = (p) =>
    resolveSnapshotPath(p, BINGBOT)?.startsWith("/api/bot-page/") ?? false;
  check("今の振り分け: / は照合する", isRouted("/"), true);
  check("今の振り分け: /venue/1 は照合する", isRouted("/venue/1"), true);
  check(
    "今の振り分け: 静的スナップショット（/winning-technique）は照合しない",
    isRouted("/winning-technique"),
    false,
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
