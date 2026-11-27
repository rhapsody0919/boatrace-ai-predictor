#!/usr/bin/env node
/**
 * 競合のサイトの sitemap を毎朝読み、前の回から増えた・消えたページを数えて、新しいページが出たサイトだけ Slack に知らせる。
 * 新しい区画（URL の1段目が初めて出た）は新機能の手がかりとして別に書く（2026-11-26 オーナー「競合を常に見張る」、一覧は複数の AI の答えから）。
 * 検証: scripts/maintenance/verify-competitor-watch.js
 *
 * 動かし方（オーナーの Mac の launchd、com.terukina.ryujin.competitor-watch）:
 *   node scripts/maintenance/competitor-watch.js --config ~/.config/ryujin/private/competitors/config.json [--dry-run]
 * 設定（リポジトリの外）: sites: [{ name, sitemap, every: "daily"|"weekly" }]・stateDir
 * - 読むのは公開の sitemap だけ（1サイト1日1回、子の sitemap は lastmod が変わった物だけを最大 MAX_CHILD_FETCH 本）。
 *   検索結果を読み取らない（Google の規約）
 * - 初めての回は基準を取るだけで知らせない。Slack の webhook は Keychain（hq-slack-webhook / hq）。値は出さない
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_CHILD_FETCH = 25;
const UA = "Mozilla/5.0 (compatible; sitemap-diff/1.0)";
// 艇愛の racer/sitemap/asg.xml は 18 秒かかることがあり、30 秒では朝の回に打ち切られた（2026-11-27）
const FETCH_TIMEOUT_MS = 60000;

/** sitemap の XML から、ページ（urlset）か子の sitemap（sitemapindex）の一覧を取る */
export function parseSitemap(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const tag = isIndex ? "sitemap" : "url";
  const entries = [
    ...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi")),
  ].map((m) => {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1])?.[1] ?? null;
    const lastmod =
      /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1])?.[1] ?? null;
    return { loc: loc?.replace(/&amp;/g, "&") ?? null, lastmod };
  });
  return { isIndex, entries: entries.filter((e) => e.loc) };
}

/** URL の1段目（区画）。https://a.jp/racer/123 → /racer */
export function sectionOf(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}` : "/";
  } catch {
    return null;
  }
}

/**
 * 前の回と今の回の差分。どちらも { 子の sitemap の loc: string[] }。両方の回にある子だけを比べる
 * （今日読まなかった子・消えた子で「消えた」と数えない）。prevListed は前の回の索引に載っていた子の全部
 */
export function diffSnapshots(prev, cur, prevListed = []) {
  const added = [];
  const removed = [];
  const listed = new Set(prevListed);
  for (const [child, urls] of Object.entries(cur)) {
    const before = prev[child];
    if (!before) {
      // 前の回も一覧にあったが読まなかった子（読む上限の外）は、今日が基準。本当に新しい子だけを増えた側に数える
      if (!listed.has(child)) added.push(...urls);
      continue;
    }
    const b = new Set(before);
    const a = new Set(urls);
    for (const u of urls) if (!b.has(u)) added.push(u);
    for (const u of before) if (!a.has(u)) removed.push(u);
  }
  const prevSections = new Set(Object.values(prev).flat().map(sectionOf));
  const newSections = [...new Set(added.map(sectionOf))].filter(
    (s) => s && !prevSections.has(s),
  );
  return { added, removed, newSections };
}

/** 知らせの1行（新しいページが無ければ null） */
export function alertLine(name, diff, sample = 5) {
  if (diff.added.length === 0) return null;
  const paths = diff.added.slice(0, sample).map((u) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  });
  const sec = diff.newSections.length
    ? `。新しい区画: ${diff.newSections.join("・")}`
    : "";
  return `${name}: 新しいページ ${diff.added.length}（消えた ${diff.removed.length}）${sec}。例: ${paths.join(" ")}`;
}

/** 今日の回に読む子の sitemap（lastmod が前の回と違う物・lastmod が無い物を新しい順に最大 max 本）。残りは前の回の値を使う */
export function childrenToFetch(entries, prevMeta, max = MAX_CHILD_FETCH) {
  const changed = entries.filter(
    (e) => !e.lastmod || prevMeta[e.loc]?.lastmod !== e.lastmod,
  );
  return changed
    .sort((a, b) =>
      String(b.lastmod ?? "9999").localeCompare(String(a.lastmod ?? "9999")),
    )
    .slice(0, max);
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * 1サイトの今の写し。子の sitemap が読めなかったときは、前の回の値があればそれを使い stale に数える
 * （1本の遅い子でサイトの回を丸ごと捨てない）。前の回の値が無い子は投げる（空にすると次の回に全部を新しいページと誤る）
 */
export async function snapshotSite(site, prevState, get = getText) {
  const root = parseSitemap(await get(site.sitemap));
  if (!root.isIndex)
    return {
      snap: { [site.sitemap]: root.entries.map((e) => e.loc) },
      meta: {},
      listed: [site.sitemap],
      stale: [],
    };
  const prevMeta = prevState?.meta ?? {};
  const fetchList = new Set(
    childrenToFetch(root.entries, prevMeta).map((e) => e.loc),
  );
  const snap = {};
  const meta = {};
  const stale = [];
  for (const e of root.entries) {
    if (fetchList.has(e.loc)) {
      let child;
      try {
        child = parseSitemap(await get(e.loc));
      } catch (err) {
        // 読めない子だけ前の回の値で埋める。前の値が無ければサイトの回ごと落とす
        if (!prevState?.snap?.[e.loc]) throw err;
        snap[e.loc] = prevState.snap[e.loc];
        meta[e.loc] = prevMeta[e.loc];
        stale.push(`${e.loc}: ${err.message}`);
        continue;
      }
      snap[e.loc] = child.entries.map((c) => c.loc);
      meta[e.loc] = { lastmod: e.lastmod };
    } else if (prevState?.snap?.[e.loc]) {
      snap[e.loc] = prevState.snap[e.loc];
      meta[e.loc] = prevMeta[e.loc];
    }
  }
  return { snap, meta, listed: root.entries.map((e) => e.loc), stale };
}

function readWebhook() {
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "hq-slack-webhook", "-a", "hq", "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return null;
  }
}

const isDue = (site, now) => site.every !== "weekly" || now.getUTCDay() === 1; // 毎週は月曜（UTC）

/** 1サイトを読み、前の回と比べて知らせの1行を返す（初めての回・新しいページ無しは null） */
async function watchSite(site, cfg, now, dry) {
  // 名前は日本語なのでホスト名で分ける
  const file = path.join(
    cfg.stateDir,
    `${new URL(site.sitemap).hostname}.json`,
  );
  const prev = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : null;
  const { stale, ...cur } = await snapshotSite(site, prev);
  for (const s of stale) console.error(`competitor-watch: ${site.name} の子を前の回の値で埋めた ${s}`);
  if (!dry) {
    fs.mkdirSync(cfg.stateDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: now.toISOString(), ...cur }));
  }
  const count = Object.values(cur.snap).flat().length;
  console.log(
    `competitor-watch: ${site.name} ${count} ページ${prev ? "" : "（初めての回、基準だけ）"}`,
  );
  if (!prev) return null;
  return alertLine(
    site.name,
    diffSnapshots(prev.snap, cur.snap, prev.listed ?? Object.keys(prev.snap)),
  );
}

async function postSlack(lines) {
  const hook = readWebhook();
  if (!hook)
    throw new Error(
      "Slack の webhook が Keychain に無い（hq-slack-webhook / hq）",
    );
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `[競合の新しいページ]\n${lines.join("\n")}` }),
  });
  if (!res.ok) throw new Error(`Slack に出せない: HTTP ${res.status}`);
  console.log(`competitor-watch: Slack に ${lines.length} 件`);
}

async function main(argv) {
  const cfgPath = argv[argv.indexOf("--config") + 1];
  if (!argv.includes("--config") || !cfgPath)
    throw new Error("--config <設定の JSON> が要る");
  const dry = argv.includes("--dry-run");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const now = new Date();
  const lines = [];
  for (const site of cfg.sites.filter((x) => isDue(x, now))) {
    try {
      const line = await watchSite(site, cfg, now, dry);
      if (line) lines.push(line);
    } catch (e) {
      console.error(`competitor-watch: 読めない ${site.name}: ${e.message}`);
    }
  }
  if (dry) for (const l of lines) console.log(l);
  else if (lines.length > 0) await postSlack(lines);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`competitor-watch: ${e.message}`);
    process.exitCode = 1;
  });
}
