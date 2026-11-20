/**
 * kb-backfill.js の共通の部品（日付・取得の窓・応答の分類・取得の計画と見積り・アーカイブのパスと jsonl の読み）。
 * CLI と使い方は kb-backfill.js の冒頭のコメント。大きさの線（400行）のため分けた（中身は変えない）。
 * 日付・窓・分類・計画の純粋関数は scripts/lib/kbBackfillPlan.js（scripts/lib の archiveDownloader.js も読む。ここは再 export）
 */

import fs from "node:fs";
import path from "node:path";
import { kbArchiveRelPath } from "../lib/kbFileParser.js";

const HARD_MIN_INTERVAL_MS = 3000; // 公式サイトへの最小間隔（ADR-0067）。これ未満は指定できない

// ---------------------------------------------------------------------------
// アーカイブ（ファイルシステム）
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
const rawPath = (dir, kind, date) =>
  path.join(dir, "raw", kbArchiveRelPath(kind, date));
const parsedPath = (dir, date, plain) =>
  path.join(
    dir,
    "parsed",
    date.slice(0, 7).replace("-", ""),
    `kb-${date}.json${plain ? "" : ".gz"}`,
  );

export { HARD_MIN_INTERVAL_MS, manifestPath, rawPath, parsedPath, readJsonl };

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${file} の${i + 1}行目が不正なJSONです: ${e.message}`);
      }
    });
}

export {
  dateRange,
  jstToday,
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  latestManifest,
  planDownload,
  estimatePlan,
} from "../lib/kbBackfillPlan.js";
