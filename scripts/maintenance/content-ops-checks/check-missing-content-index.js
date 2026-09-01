/**
 * AppRouter.jsx に新規追加されたルートのうち、対応する
 * docs/design/{slug}/content-index.json の static_pages に一切登録されて
 * いないものを検知する（verify-sitemap-coverage.jsと同じ発想）。
 *
 * フローA-1「機能実装完了（PRマージ）を単一トリガーとする」は、実際には
 * 検知の仕組みが無く同一セッション内の判断任せだった（2026-09-01発覚）。
 * この穴を埋めるための機械チェック。ただし新規ルート＝ブログ記事が要る新機能、
 * とは限らない（管理画面・リダイレクト等）ため、強制エラーにはせず
 * session-start-check.js経由で提示するだけに留める。詳細:
 * docs/design/content-ops-flow/spec.md フローA-1
 */

import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const APP_ROUTER_PATH = path.join(REPO_ROOT, "src/AppRouter.jsx");
const DESIGN_DIR = path.join(REPO_ROOT, "docs/design");
const EXCLUDED_DIR_NAMES = new Set(["_template"]);

// content-indexの対象にならないルート（管理画面・リダイレクト専用・規約等）。
// 新しいルートを除外する場合はここに理由付きで追記すること
const EXCLUDED_ROUTES = new Set([
  "/",
  "/hit-races",
  "/accuracy",
  "/picks",
  "/accuracy/history",
  "/privacy",
  "/terms",
  "/contact",
  "/races",
  "/races/:date",
  "/races/:date/:venueCode",
  "/blog",
  "/blog/:id",
  "/about",
  "/faq",
  "/how-to-use",
  "/profile",
  "/guide",
  "/responsible-gambling",
  "/admin/rules",
  "/admin/sns-hub",
  "/holmes",
  "/poirot",
]);

const CUTOFF_DATE = "2026-09-01"; // content-index.json運用の開始日。それ以前のルートは対象外
const GRACE_DAYS = 3; // 追加直後（同一PR作業中）を誤検知しないための猶予

function extractRoutesBlock(source) {
  const start = source.indexOf("function LocalizedRoutes(");
  const end = source.indexOf("function LanguageSync(");
  if (start === -1 || end === -1) {
    throw new Error(
      "AppRouter.jsx の LocalizedRoutes/LanguageSync が見つかりません。関数名が変更された場合はこのスクリプトの抽出ロジックを更新してください",
    );
  }
  return { block: source.slice(start, end), offset: start };
}

function normalizeRoutePath(rawPath) {
  if (rawPath === "*") return null;
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
}

async function extractRouteEntries() {
  const source = await fs.readFile(APP_ROUTER_PATH, "utf-8");
  const { block, offset } = extractRoutesBlock(source);
  const routes = [];
  for (const match of block.matchAll(/<Route\s+path="([^"]*)"/g)) {
    const normalized = normalizeRoutePath(match[1]);
    if (!normalized) continue;
    const absoluteIndex = offset + match.index;
    const lineNumber = source.slice(0, absoluteIndex).split("\n").length;
    routes.push({ path: normalized, lineNumber });
  }
  return routes;
}

async function getLineDates(lineNumbers) {
  if (lineNumbers.length === 0) return new Map();
  const min = Math.min(...lineNumbers);
  const max = Math.max(...lineNumbers);
  const { stdout } = await execFileAsync(
    "git",
    ["blame", `-L${min},${max}`, "--date=short", "--", "src/AppRouter.jsx"],
    { cwd: REPO_ROOT },
  );
  const dateByLine = new Map();
  const lines = stdout.split("\n");
  lines.forEach((line, idx) => {
    const dateMatch = line.match(/\((?:.+?) (\d{4}-\d{2}-\d{2}) /);
    if (dateMatch) dateByLine.set(min + idx, dateMatch[1]);
  });
  return dateByLine;
}

async function collectIndexedStaticPages() {
  const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
  const paths = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const candidate = path.join(DESIGN_DIR, entry.name, "content-index.json");
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const data = JSON.parse(raw);
      for (const p of data.content?.static_pages ?? []) paths.add(p);
    } catch {
      // content-index.jsonが無い/壊れているディレクトリはスキップ
      // （check-content-index-coverage.jsが別途フォーマットを検証する）
    }
  }
  return paths;
}

function daysSince(dateString) {
  const diffMs = Date.now() - new Date(`${dateString}T00:00:00Z`).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function checkMissingContentIndex() {
  const routes = await extractRouteEntries();
  const dateByLine = await getLineDates(routes.map((r) => r.lineNumber));
  const indexedPaths = await collectIndexedStaticPages();

  const missingRoutes = [];
  for (const route of routes) {
    if (EXCLUDED_ROUTES.has(route.path)) continue;
    if (indexedPaths.has(route.path)) continue;
    const addedDate = dateByLine.get(route.lineNumber);
    if (!addedDate) continue;
    if (addedDate < CUTOFF_DATE) continue; // 運用開始前からある既存ルート
    if (daysSince(addedDate) < GRACE_DAYS) continue; // 追加直後の猶予期間

    missingRoutes.push({ route: route.path, addedDate });
  }

  return { missingRoutes };
}
