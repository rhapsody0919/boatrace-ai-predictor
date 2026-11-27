#!/usr/bin/env node
/**
 * GSC（クエリ×ページ・ページ）と GA4（入口のページ×経路・機能ページのイベント）の28日と直前28日を、
 * 毎朝 JSON に保存する（読むだけ。hq の google-detail-collect.mjs を龍神へ移した物、2026-11-26 オーナー「今すぐ龍神へ」）。
 * 検証: scripts/maintenance/verify-google-detail-collect.js
 *
 * 動かし方（オーナーの Mac の launchd、com.terukina.ryujin.google-detail。リポジトリに置かない設定を読む）:
 *   node scripts/maintenance/google-detail-collect.js --config ~/.config/ryujin/private/google-detail.json [--now <ISO>]
 * 設定（JSON）: siteUrl・propertyId・keyFile（サービスアカウントの鍵のパス）・outDir・timezone・windowDays・lagDays・featurePages・dailyDays（既定60）
 * 日別（gsc_daily.json・gsc_page_daily.json）: 直近 dailyDays 日（末日は窓と同じ lagDays 日前、日付は GSC の PT のまま）の
 *   date×query×page と date×page を growth_gsc_daily・growth_gsc_page_daily と同じ行で保存する（seo-morning-sheet --local-dir が読む）。
 *   取得は scripts/lib/growth/gscDaily.js・gscPageDaily.js の fetchDay・fetchPageDay（1日ずつ・25000行のページ送り）。
 * URL 検査（url_inspection.json）: 設定の inspection（{ sitemap: 既定 本番の sitemap.xml の URL（ファイルのパスも可）, max: 既定200 }、false で止める）。
 *   GSC・GA4 を書いた後に回し、URL ごとの最新の行の写しを書く（scripts/lib/growth/localInspection.js。seo-morning-sheet --local-dir が読む）。
 * 数字は公開リポジトリに入れない（outDir はリポジトリの外）。全部の API が取れたときだけ日付の置き場に書く。
 * --now に過去の時刻を渡すと、その日の回を取り直せる（窓は日付から決まるので、抜けた日も後から同じ物が取れる）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROW_CAP, fetchDay } from "../lib/growth/gscDaily.js";
import { dateRange, fetchPageDay } from "../lib/growth/gscPageDaily.js";
import { collectInspections, readPreviousSnapshot } from "../lib/growth/localInspection.js";

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 取得の日（設定の timezone の暦日）と、現と前の2つの窓（両端を含む windowDays 日、末日は lagDays 日前） */
export function windowsFor(now, { timezone, windowDays, lagDays }) {
  if (!Number.isInteger(windowDays) || windowDays < 1)
    throw new Error("windowDays は正の整数");
  if (!Number.isInteger(lagDays) || lagDays < 3)
    throw new Error("lagDays は3以上の整数（GSC の確定の遅れ）");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const end = Date.parse(`${today}T00:00:00Z`) - lagDays * DAY;
  const windows = ["current", "previous"].map((name, i) => ({
    name,
    startDate: iso(end - ((i + 1) * windowDays - 1) * DAY),
    endDate: iso(end - i * windowDays * DAY),
  }));
  return { today, windows };
}

/** 日別の取得の日付（古い順）。末日は windowsFor と同じ（lagDays 日前）、日付は timezone（GSC は PT）の暦日 */
export function dailyDatesFor(now, { timezone, dailyDays, lagDays }) {
  if (!Number.isInteger(dailyDays) || dailyDays < 1)
    throw new Error("dailyDays は正の整数");
  const { windows } = windowsFor(now, { timezone, windowDays: 1, lagDays });
  const end = windows[0].endDate;
  const start = iso(Date.parse(`${end}T00:00:00Z`) - (dailyDays - 1) * DAY);
  return dateRange(start, end);
}

const counts = (r) => ({
  clicks: Math.round(r.clicks ?? 0),
  impressions: Math.round(r.impressions ?? 0),
});

function dailyRow(r, date) {
  if (!Array.isArray(r.keys) || r.keys.length !== 3)
    throw new Error(`GSC ${date}: keys が [date, query, page] でない`);
  const [d, query, page] = r.keys;
  return { date: d, query, page, ...counts(r), position: Number(r.position ?? 0) };
}

function pageDailyRow(r, date) {
  if (!Array.isArray(r.keys) || r.keys.length !== 2)
    throw new Error(`GSC ${date}: keys が [date, page] でない`);
  const [d, page] = r.keys;
  return { date: d, page, ...counts(r) };
}

/**
 * 日別の2ファイルの中身（行は表と同じ形、fetched_at は付けない）。
 * 1日でも落ちたら投げる（全部取れたときだけ書く決まり）。上限（API_ROW_CAP）に当たった日は meta.capped_dates に残す
 */
export async function collectDaily(sc, cfg, now) {
  const dates = dailyDatesFor(now, {
    timezone: cfg.timezone,
    dailyDays: cfg.dailyDays ?? 60,
    lagDays: cfg.lagDays ?? 3,
  });
  const daily = [];
  const pageDaily = [];
  const capped = [];
  for (const date of dates) {
    const qp = await api(`GSC ${date} date×query×page`, () =>
      fetchDay(sc, cfg.siteUrl, date).then((rows) => ({ data: rows })),
    );
    const pg = await api(`GSC ${date} date×page`, () =>
      fetchPageDay(sc, cfg.siteUrl, date).then((rows) => ({ data: rows })),
    );
    if (qp.length >= API_ROW_CAP) capped.push(date);
    daily.push(...qp.map((r) => dailyRow(r, date)));
    pageDaily.push(...pg.map((r) => pageDailyRow(r, date)));
  }
  const meta = {
    from: dates[0],
    to: dates.at(-1),
    days: dates.length,
    collected_at: now.toISOString(),
    site: cfg.siteUrl,
    capped_dates: capped,
  };
  return [
    ["gsc_daily", { meta, rows: daily }],
    ["gsc_page_daily", { meta, rows: pageDaily }],
  ];
}

/** GA4 の runReport の行を {次元: 値, 指標: 数} にする */
export function flattenGa4Rows(rows, dimensions, metrics) {
  return (rows ?? []).map((r) =>
    Object.fromEntries([
      ...dimensions.map((name, i) => [name, r.dimensionValues[i].value]),
      ...metrics.map((name, i) => [name, Number(r.metricValues[i].value)]),
    ]),
  );
}

/** 匿名化されたクリックの割合の推定（query×page と page のクリック合計の差） */
export function anonymizedFraction(queryRows, pageRows) {
  const q = queryRows.reduce((n, r) => n + r.clicks, 0);
  const p = pageRows.reduce((n, r) => n + r.clicks, 0);
  return {
    queryClicks: q,
    pageClicks: p,
    fraction: p === 0 ? null : 1 - q / p,
  };
}

function readConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["siteUrl", "propertyId", "outDir", "timezone"]) {
    if (!cfg[key]) throw new Error(`設定に ${key} が無い（${file}）`);
  }
  if (!cfg.featurePages || !Object.keys(cfg.featurePages).length) {
    throw new Error("設定に featurePages（機能ごとのページ条件）が無い");
  }
  return cfg;
}

async function clients(cfg) {
  if (cfg.keyFile) process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ??= cfg.keyFile;
  const { google } = await import("googleapis");
  const { getGoogleAuthClient } = await import("../lib/googleServiceAuth.js");
  const auth = getGoogleAuthClient([
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ]);
  return {
    sc: google.searchconsole({ version: "v1", auth }),
    ga: google.analyticsdata({ version: "v1beta", auth }),
  };
}

async function api(label, call) {
  try {
    return (await call()).data;
  } catch (e) {
    const status = e.response?.status ?? e.code ?? "unknown";
    const hint =
      Number(status) === 403
        ? "（サービスアカウントのサイト・プロパティへの閲覧権限を確かめる）"
        : "";
    throw new Error(`${label}: API ${status}: ${e.message}${hint}`);
  }
}

async function search(sc, siteUrl, window, dimensions) {
  const rows = [];
  const rowLimit = 25000;
  for (let startRow = 0; ; startRow += rowLimit) {
    const data = await api(`GSC ${window.name} ${dimensions.join("×")}`, () =>
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: window.startDate,
          endDate: window.endDate,
          dimensions,
          type: "web",
          dataState: "final",
          aggregationType: "byPage",
          rowLimit,
          startRow,
        },
      }),
    );
    const batch = data.rows ?? [];
    rows.push(...batch);
    if (batch.length < rowLimit) return rows;
  }
}

async function report(
  ga,
  property,
  window,
  dimensions,
  metrics,
  dimensionFilter,
) {
  const rows = [];
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const data = await api(`GA4 ${window.name} ${dimensions.join("×")}`, () =>
      ga.properties.runReport({
        property,
        requestBody: {
          dateRanges: [
            { startDate: window.startDate, endDate: window.endDate },
          ],
          dimensions: dimensions.map((name) => ({ name })),
          metrics: metrics.map((name) => ({ name })),
          ...(dimensionFilter ? { dimensionFilter } : {}),
          orderBys: dimensions.map((dimensionName) => ({
            dimension: { dimensionName },
          })),
          limit,
          offset,
        },
      }),
    );
    rows.push(...flattenGa4Rows(data.rows, dimensions, metrics));
    const n = (data.rows ?? []).length;
    if (n < limit || offset + n >= Number(data.rowCount)) return rows;
  }
}

async function collectWindow({ sc, ga }, cfg, property, window, now) {
  const queryPage = await search(sc, cfg.siteUrl, window, ["query", "page"]);
  const pages = await search(sc, cfg.siteUrl, window, ["page"]);
  const anon = anonymizedFraction(queryPage, pages);
  const meta = {
    window,
    collected_at: now.toISOString(),
    timezone: cfg.timezone,
    lag_days: cfg.lagDays,
    site: cfg.siteUrl,
    property,
    query_page_clicks: anon.queryClicks,
    page_clicks: anon.pageClicks,
    anonymized_click_fraction: anon.fraction,
  };
  const landing = await report(
    ga,
    property,
    window,
    ["landingPage", "sessionSource", "sessionCampaignName"],
    ["sessions", "activeUsers"],
  );
  const features = {};
  for (const [name, pattern] of Object.entries(cfg.featurePages)) {
    features[name] = await report(
      ga,
      property,
      window,
      ["eventName"],
      ["eventCount"],
      {
        filter: {
          fieldName: "pagePathPlusQueryString",
          stringFilter: { matchType: "CONTAINS", value: pattern },
        },
      },
    );
  }
  return [
    [`gsc_query_page_${window.name}`, { meta, rows: queryPage }],
    [`gsc_page_${window.name}`, { meta, rows: pages }],
    [`ga4_landing_${window.name}`, { meta, rows: landing }],
    [
      `ga4_features_${window.name}`,
      { meta, feature_pages: cfg.featurePages, features },
    ],
  ];
}

/** sitemap.xml の本文。URL なら取る（作業の場所の古い public/sitemap.xml を読まない）、ほかはファイルのパス */
async function readSitemap(src) {
  if (!/^https?:\/\//.test(src)) return fs.readFileSync(path.resolve(src), "utf8");
  const res = await fetch(src);
  if (!res.ok) throw new Error(`sitemap の取得の失敗: ${src} ${res.status}`);
  return res.text();
}

/** URL 検査を回して url_inspection.json を書く（GSC・GA4 のファイルを書いた後。落ちても前のファイルは残る） */
async function writeInspection(sc, cfg, outDir, today, now) {
  const insp = await collectInspections(
    sc,
    {
      siteUrl: cfg.siteUrl,
      xml: await readSitemap(cfg.inspection?.sitemap ?? "https://www.boat-ai.jp/sitemap.xml"),
      prevRows: readPreviousSnapshot(cfg.outDir, today),
      max: cfg.inspection?.max,
    },
    today,
    now,
  );
  fs.writeFileSync(path.join(outDir, "url_inspection.json"), `${JSON.stringify(insp, null, 2)}\n`);
  console.log(`google-detail-collect: URL 検査 ${insp.meta.inspected}/${insp.meta.planned} 件（落ち ${insp.meta.failed}）`);
}

async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--config", "--now"].includes(argv[i]) || argv[i + 1] === undefined)
      throw new Error(`不正な引数: ${argv[i]}`);
    opt[argv[i]] = argv[i + 1];
  }
  if (!opt["--config"]) throw new Error("--config <設定の JSON> が要る");
  const cfg = readConfig(opt["--config"]);
  const now = opt["--now"] ? new Date(opt["--now"]) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now は ISO 時刻");
  const { today, windows } = windowsFor(now, {
    timezone: cfg.timezone,
    windowDays: cfg.windowDays ?? 28,
    lagDays: cfg.lagDays ?? 3,
  });
  const property = String(cfg.propertyId).startsWith("properties/")
    ? cfg.propertyId
    : `properties/${cfg.propertyId}`;
  const c = await clients(cfg);
  const files = [];
  for (const w of windows)
    files.push(...(await collectWindow(c, cfg, property, w, now)));
  files.push(...(await collectDaily(c.sc, cfg, now)));
  const outDir = path.join(cfg.outDir, today);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, data] of files)
    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
    );
  console.log(`google-detail-collect: ${outDir} に ${files.length} ファイル`);
  if (cfg.inspection !== false) await writeInspection(c.sc, cfg, outDir, today, now);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`google-detail-collect: ${e.message}`);
    process.exitCode = 1;
  });
}
