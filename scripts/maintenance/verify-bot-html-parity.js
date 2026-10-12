#!/usr/bin/env node
/**
 * 日中の照合（ADR 0089「監視」）。本番のボット向け HTML が、人の画面の部分集合になっているかを確かめる。
 *
 * 見るもの（失敗なら終了コード 1）:
 * 1. 部分集合の照合: / と、開催中の会場2つの /venue/{code}（と、振り分けていれば言語版の /{lang}/・/{lang}/venue/{先頭の会場}、
 *    BOA-848 第2段）について、bingbot の UA で取った HTML の
 *    本文の文字列（見出し・会場名・節の名前・グレード・レース番号・締切時刻・最終更新）・リンク先・
 *    head（title・description・canonical・hreflang・JSON-LD）が、Playwright で人として描いたページにすべてあること
 *    （hreflang は hreflang と href の組、JSON-LD は JSON として読んだ値で比べる。人の側は document 全体を見る）
 * 2. 取り違え: bingbot で取った直後に人の UA で同じ URL を取り、SPA の外枠が返ること（ボット向けが返ったら重大）
 * 3. Googlebot: Googlebot の UA で / を取ると SPA の外枠であること
 * 4. スナップショット生成: /ai-snapshots/status.json が ok であること（ブログ等の生成の失敗はビルドを止めないので、ここで見つける。SEO 再点検 F5）
 *
 * 記録だけ（失敗にしない）:
 * 5. TTFB: 人の UA で /・/venue/{会場}・/en/・/race/{本日のレース}（middleware を通らない比較用）を交互に10巡し、中央値を出す
 *
 * 照合の関数は scripts/lib/botHtmlParity.js（検証は verify-bot-html-parity-logic.js、tier ci）。
 * 監視自体が途中で止まった（本番に繋がらない・ブラウザが起動しない等）は終了コード 2。
 * 本番へのリクエストは、ページの HTML で 40 前後。言語版を配線した後は 60 前後（Playwright の描画が読むアセット・API は別）。
 * 言語版を照合するかは、このリポジトリの振り分け（resolveSnapshotPath）で決める。ワークフローは master を checkout するので、
 * 本番に出ている振り分けと同じになる
 *
 * 使い方:
 *   node scripts/maintenance/verify-bot-html-parity.js
 *   BOT_PARITY_ORIGIN=https://xxx.vercel.app node scripts/maintenance/verify-bot-html-parity.js   # Preview に向ける
 *   node scripts/maintenance/verify-bot-html-parity.js --save-fixtures scripts/lib/__fixtures__/bot-html-parity
 *     # 照合に使った HTML と人の DOM を保存する（ロジックのテストのフィクスチャを取り直すとき）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
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
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from "../../src/config/languages.js";

// 言語版の候補（ja 以外の対応言語）。振り分けているかは resolveSnapshotPath で見る
const PREFIXED_LANGS = SUPPORTED_LANGUAGES.map(({ code }) => code).filter(
  (code) => code !== DEFAULT_LANGUAGE,
);

const ORIGIN = (
  process.env.BOT_PARITY_ORIGIN || "https://www.boat-ai.jp"
).replace(/\/$/, "");
const VENUE_COUNT = 2;
const TTFB_ROUNDS = 10;
const RENDER_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;

const UA = {
  bingbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  human:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

const saveDirIndex = process.argv.indexOf("--save-fixtures");
const saveDir = saveDirIndex >= 0 ? process.argv[saveDirIndex + 1] : null;
if (saveDirIndex >= 0 && !saveDir) {
  console.error("--save-fixtures には保存先のディレクトリを付ける");
  process.exit(2);
}

const fixtureName = (p) =>
  p === "/"
    ? "top"
    : p.replace(/^\//, "").replace(/\/$/, "").replaceAll("/", "-");
function save(file, content) {
  if (!saveDir) return;
  mkdirSync(saveDir, { recursive: true });
  writeFileSync(path.join(saveDir, file), content);
}

async function get(pathname, ua) {
  const res = await fetch(`${ORIGIN}${pathname}`, {
    headers: { "user-agent": ua },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
}

/** ヘッダーが届くまでの時間（ms）。本文は読み切ってから次へ進む */
async function ttfb(pathname) {
  const t0 = performance.now();
  const res = await fetch(`${ORIGIN}${pathname}`, {
    headers: { "user-agent": UA.human },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const ms = performance.now() - t0;
  await res.arrayBuffer();
  return ms;
}

/** 人の画面を描いて、本文・リンク・head を取る */
async function humanSnapshot(page) {
  return page.evaluate(() => ({
    text: document.body?.innerText ?? "",
    hrefs: [...document.querySelectorAll("a[href]")].map((a) =>
      a.getAttribute("href"),
    ),
    head: {
      title: document.title,
      description:
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? "",
      canonicals: [...document.querySelectorAll('link[rel="canonical"]')].map(
        (l) => l.getAttribute("href"),
      ),
      alternates: [
        ...document.querySelectorAll('link[rel="alternate"][hreflang]'),
      ].map((l) => ({
        hreflang: l.getAttribute("hreflang") ?? "",
        href: l.getAttribute("href") ?? "",
      })),
      jsonLd: [
        ...document.querySelectorAll('script[type="application/ld+json"]'),
      ].map((s) => s.textContent ?? ""),
    },
  }));
}

/** 描画を待ちながら、ボット側の文字列が全部そろうまで（最大 timeoutMs）見る */
async function waitForParity(page, bot, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  let missing;
  for (;;) {
    snapshot = await humanSnapshot(page);
    missing = findMissing(bot, snapshot, ORIGIN);
    if (missing.length === 0 || Date.now() >= deadline) break;
    await page.waitForTimeout(1000);
  }
  return { snapshot, missing };
}

async function main() {
  const failures = [];
  const notes = [];
  console.log(`照合先: ${ORIGIN}`);

  // ---- 開催中の会場を選ぶ ----
  const today = await get("/api/races/today", UA.human);
  if (today.status !== 200) {
    throw new Error(`/api/races/today が HTTP ${today.status}`);
  }
  const venues = pickOpenVenues(JSON.parse(today.body), VENUE_COUNT);
  if (venues.length === 0) {
    notes.push("本日は開催中の会場が無いため、/ だけを照合する");
  }
  const { checked: paths, skipped } = parityPaths(
    venues.map((v) => v.code),
    {
      langs: PREFIXED_LANGS,
      isRouted: (p) =>
        resolveSnapshotPath(p, UA.bingbot)?.startsWith("/api/bot-page/") ??
        false,
    },
  );
  if (skipped.length > 0) {
    notes.push(
      `ボット向け HTML へ振り分けていないので照合しない: ${skipped.join(" ")}`,
    );
  }
  console.log(
    `照合するページ: ${paths.join(" ")}${venues.length ? `（${venues.map((v) => v.name).join("・")}）` : ""}`,
  );

  // ---- 取り違え（ボットの直後に人）と、ボット向け HTML の取得 ----
  const botHtml = new Map();
  for (const p of paths) {
    const bot = await get(p, UA.bingbot);
    const human = await get(p, UA.human);
    save(`${fixtureName(p)}.bot.html`, bot.body);
    if (p === "/") save("top.human-ua.html", human.body);
    const botKind = classifyHtml(bot.body);
    const humanKind = classifyHtml(human.body);
    console.log(
      `[取り違え] ${p}: bingbot → HTTP ${bot.status} ${botKind} / 直後の人 → HTTP ${human.status} ${humanKind}`,
    );
    if (humanKind !== "spa") {
      failures.push(
        `[重大・取り違え] 人の UA の ${p} に SPA の外枠が返らない（${humanKind}、HTTP ${human.status}）`,
      );
    }
    if (bot.status === 200 && botKind === "bot") {
      botHtml.set(p, bot.body);
    } else {
      failures.push(
        `[配信] bingbot の ${p} にボット向け HTML が返らない（${botKind}、HTTP ${bot.status}）`,
      );
    }
  }

  // ---- Googlebot ----
  const gb = await get("/", UA.googlebot);
  const gbKind = classifyHtml(gb.body);
  console.log(`[Googlebot] /: HTTP ${gb.status} ${gbKind}`);
  if (gbKind !== "spa") {
    failures.push(
      `[Googlebot] / に SPA の外枠が返らない（${gbKind}、HTTP ${gb.status}）`,
    );
  }

  // ---- スナップショット生成の結果（status.json） ----
  const st = await get("/ai-snapshots/status.json", UA.human);
  const stResult = evaluateSnapshotStatus(st.status, st.body);
  console.log(`[スナップショット] ${stResult.message}`);
  if (stResult.level === "fail") failures.push(`[スナップショット] ${stResult.message}`);
  if (stResult.level === "note") notes.push(stResult.message);

  // ---- 部分集合の照合 ----
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent: UA.human,
      viewport: { width: 1280, height: 900 },
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });
    const page = await context.newPage();
    for (const p of paths) {
      const html = botHtml.get(p);
      if (!html) continue;
      let bot = extractBotItems(html);
      await page.goto(`${ORIGIN}${p}`, { waitUntil: "domcontentloaded" });
      let { snapshot, missing } = await waitForParity(
        page,
        bot,
        RENDER_TIMEOUT_MS,
      );
      if (missing.length > 0) {
        // 材料の更新（5分ごと）をボットと人で別の時点で読んだだけかもしれないので、1回だけ両方を取り直す
        const again = await get(p, UA.bingbot);
        if (again.status === 200 && classifyHtml(again.body) === "bot") {
          bot = extractBotItems(again.body);
          await page.goto(`${ORIGIN}${p}`, { waitUntil: "domcontentloaded" });
          ({ snapshot, missing } = await waitForParity(
            page,
            bot,
            RENDER_TIMEOUT_MS,
          ));
        }
      }
      save(
        `${fixtureName(p)}.human-dom.json`,
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
      const total =
        bot.texts.length +
        bot.hrefs.length +
        3 +
        bot.head.alternates.length +
        bot.head.jsonLd.length;
      console.log(
        `[照合] ${p}: ${total - missing.length}/${total} 件が人の画面にある（本文 ${bot.texts.length}・リンク ${bot.hrefs.length}・head 3・hreflang ${bot.head.alternates.length}・JSON-LD ${bot.head.jsonLd.length}）`,
      );
      if (missing.length > 0) {
        failures.push(
          `[照合] ${p}: 人の画面に無いもの ${missing.length} 件\n${missing
            .map((m) => `  - ${m.kind}: ${m.value}`)
            .join("\n")}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  // ---- TTFB（記録だけ） ----
  // /en/ は言語版の配線（BOA-848 第2段）の前後で middleware を通るかが変わるので、比べられるよう毎日残す
  const ttfbPaths = venues.length
    ? ["/", `/venue/${venues[0].code}`, "/en/", venues[0].firstRacePath]
    : ["/", "/venue/1", "/en/"];
  const samples = Object.fromEntries(ttfbPaths.map((p) => [p, []]));
  for (let i = 0; i < TTFB_ROUNDS; i += 1) {
    for (const p of ttfbPaths) samples[p].push(await ttfb(p));
  }
  console.log(
    `[TTFB] 人の UA・${TTFB_ROUNDS}巡の中央値（記録だけ、失敗にしない）`,
  );
  for (const p of ttfbPaths) {
    const note = p.startsWith("/race/")
      ? "（middleware を通らない比較用）"
      : "";
    console.log(`  ${p}: ${median(samples[p]).toFixed(0)}ms${note}`);
  }

  for (const n of notes) console.log(`[注記] ${n}`);
  if (failures.length > 0) {
    console.log(`\n失敗 ${failures.length} 件:`);
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  console.log("\n合格: 照合・取り違え・Googlebot とも問題なし");
}

main().catch((e) => {
  console.error(`照合の途中で止まった: ${e?.stack ?? e}`);
  process.exit(2);
});
