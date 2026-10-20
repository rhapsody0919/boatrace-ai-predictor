/**
 * URL ごとの Google の登録状態と、配信 HTML・描画後の title を並べて書き出す
 *
 * check-venue-indexing.js は英語の会場ガイド専用で、Google が選んだ canonical や
 * 実際に返している HTML までは見ない。任意の URL について次をまとめて取る。
 *   1. URL Inspection API（登録の状態・Google が選んだ canonical・最終クロール・robots）
 *   2. 配信 HTML（JS 実行前）を UA 別に取得: 通常のブラウザ・Googlebot・AI ボット（GPTBot）
 *      AI ボットには middleware が静的スナップショット・/api/bot-page を返す（ADR 0032・0089）
 *   3. Playwright で描画した後の title・canonical・robots・h1・本文の先頭
 * 確認だけで、再クロールの依頼や index の範囲の変更はしない。
 * 注意: 本番に通常のブラウザと GPTBot の UA でアクセスするので、実行1回で GA4（Direct）と
 * Vercel の AI ボットの取得数に URL の数ずつ混ざる。
 *
 * 使い方:
 *   node scripts/analysis/url-index-render-check.js --out=data/analysis/xxx/url-index-render.json https://www.boat-ai.jp/ ...
 *
 * 必要な設定は search-console-report.js と共通（SEARCH_CONSOLE_SITE_URL、サービスアカウント）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { chromium } from "playwright";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const URLS = process.argv.slice(2).filter((a) => a.startsWith("http"));

if (!SITE_URL || !OUT || URLS.length === 0) {
  console.error(
    "❌ SEARCH_CONSOLE_SITE_URL（.env.local）・--out=・URL（1つ以上）が要ります",
  );
  process.exit(1);
}

const USER_AGENTS = {
  browser:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
};

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/webmasters.readonly",
]);
const searchconsole = google.searchconsole({ version: "v1", auth });

async function inspect(url) {
  try {
    const res = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: url,
        siteUrl: SITE_URL,
        languageCode: "ja",
      },
    });
    return res.data.inspectionResult ?? null;
  } catch (err) {
    return { error: err.message };
  }
}

const firstMatch = (html, re) => html.match(re)?.[1]?.trim() ?? null;

// JS 実行前の HTML から、検索エンジンが最初に読む要素だけを抜く
function summarizeHtml(html) {
  return {
    bytes: Buffer.byteLength(html),
    htmlLang: firstMatch(html, /<html[^>]*\slang="([^"]*)"/i),
    title: firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i),
    canonical: firstMatch(
      html,
      /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i,
    ),
    robots: firstMatch(html, /<meta[^>]*name="robots"[^>]*content="([^"]*)"/i),
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    jsonLdCount: (html.match(/application\/ld\+json/gi) ?? []).length,
  };
}

async function fetchAs(url, ua) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": ua },
      redirect: "manual",
    });
    const html = await res.text();
    return {
      status: res.status,
      location: res.headers.get("location"),
      xRobotsTag: res.headers.get("x-robots-tag"),
      ...summarizeHtml(html),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function render(browser, url) {
  const page = await browser.newPage({ userAgent: USER_AGENTS.browser });
  try {
    const res = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    return {
      status: res?.status() ?? null,
      finalUrl: page.url(),
      ...(await page.evaluate(() => {
        const attr = (sel, a) =>
          document.querySelector(sel)?.getAttribute(a) ?? null;
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return {
          htmlLang: document.documentElement.lang || null,
          title: document.title,
          canonical: attr('link[rel="canonical"]', "href"),
          canonicalCount: document.querySelectorAll('link[rel="canonical"]')
            .length,
          robots: [...document.querySelectorAll('meta[name="robots"]')].map(
            (m) => m.content,
          ),
          description: attr('meta[name="description"]', "content"),
          h1: [...document.querySelectorAll("h1")].map((h) =>
            h.innerText.trim(),
          ),
          jsonLdTypes: [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
          ].flatMap((s) => {
            try {
              const j = JSON.parse(s.textContent);
              return [j].flat().map((x) => x["@type"] ?? null);
            } catch {
              return ["(parse error)"];
            }
          }),
          bodyTextLength: text.length,
          bodyTextHead: text.slice(0, 300),
        };
      })),
    };
  } catch (err) {
    return { error: err.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const url of URLS) {
      const inspection = await inspect(url);
      const served = {};
      for (const [name, ua] of Object.entries(USER_AGENTS)) {
        served[name] = await fetchAs(url, ua);
      }
      const rendered = await render(browser, url);
      const idx = inspection?.indexStatusResult;
      console.log(
        `${url}\n  ${idx?.verdict ?? inspection?.error} ${idx?.coverageState ?? ""} googleCanonical=${idx?.googleCanonical ?? "-"} lastCrawl=${idx?.lastCrawlTime ?? "-"}\n  rendered title=${rendered.title ?? rendered.error}`,
      );
      results.push({ url, inspection, served, rendered });
      // URL Inspection API は1分600件・1日2000件の上限があるため間隔を空ける
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    await browser.close();
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        siteUrl: SITE_URL,
        userAgents: USER_AGENTS,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("❌ URL 確認エラー:", err.message);
  process.exit(1);
});
