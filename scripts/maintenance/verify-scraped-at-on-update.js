#!/usr/bin/env node
/**
 * `scraped_at` を持つテーブルへの upsert が、`scraped_at` を載せているかを検査する（BOA-463）
 *
 * ## 守っているもの
 *
 * `scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()` の **DEFAULT は INSERT のときしか効かない**。
 * 同じキーの行を繰り返し更新するテーブルで、書き込み側が `scraped_at` を payload に載せないと、
 * **初回挿入時の値が永久に残る**。鮮度の指標として読むと「何日も止まっている」と誤って見える。
 *
 * 実際に `racer_series_points` で起きた（2026-09-28、BOA-463）。若松G1の行は `scraped_at` が
 * 開催初日のままで、中身は7走分まで更新されていた。`scripts/analysis/data-health-report.js` の
 * 「最新の取得時刻」が6日間止まっているように表示され、**逆に本当に止まったときも同じ見た目になる**
 * ため、その列では区別できない状態だった。
 *
 * ## 検査の方法
 *
 * 1. `docs/db-migration/*.sql` から、`scraped_at` 列を持つテーブルを集める
 * 2. `scripts/` からそのテーブルへの `.from("<table>").upsert(...)` / `.update(...)` を探す
 * 3. その呼び出しの周辺に `scraped_at` が出てこなければNGにする
 *
 * ## 対象外（NGにしない）
 *
 * - **`ignoreDuplicates: true` の upsert**: 既存行を更新しないため、DEFAULT が正しく効く
 *   （`race_special_notes` がこれ。新規の特記事項だけを挿入する）
 * - **新規行の挿入だけを行う関数**: 同じく DEFAULT が効く。関数名かコメントに「新規」を含むものを許す
 *   （`racerProfileSync.js` の `saveNewProfile` がこれ）
 * - `scripts/analysis/` ・ `scripts/maintenance/`: 調査・保守の一回限りのコードは対象にしない
 *
 * ## 限界
 *
 * 呼び出しの「周辺」をテキストで見るだけで、実行経路は追わない。`scraped_at` を別の関数で足している
 * 場合は取りこぼす。**取りこぼす方向（偽陰性）に倒しており、偽陽性で止めることを避けている。**
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

/** 呼び出し位置から前後この行数を「周辺」とみなす */
const CONTEXT_LINES = 25;

/** 一回限りの調査・保守コードは対象にしない */
const EXCLUDED_DIRS = ["scripts/analysis/", "scripts/maintenance/"];

/** 新規挿入だけを行うと分かる書き方（DEFAULT が正しく効くので対象外） */
const INSERT_ONLY_HINTS = [/ignoreDuplicates:\s*true/, /新規/];

const listFiles = (dir, ext, acc = []) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "__fixtures__") continue;
      listFiles(full, ext, acc);
    } else if (name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
};

/** マイグレーションから、scraped_at 列を持つテーブル名を集める */
export function tablesWithScrapedAt(sqlTexts) {
  const tables = new Set();
  for (const sql of sqlTexts) {
    const re =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\);/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      if (/\bscraped_at\b/i.test(m[2])) tables.add(m[1]);
    }
    const alter =
      /ALTER\s+TABLE\s+(?:public\.)?["']?(\w+)["']?[\s\S]{0,200}?ADD\s+COLUMN[^;]*?\bscraped_at\b/gi;
    while ((m = alter.exec(sql)) !== null) tables.add(m[1]);
  }
  return tables;
}

/**
 * 1ファイルの中から、対象テーブルへの書き込みで scraped_at を載せていないものを探す。
 * @returns {Array<{line: number, table: string, snippet: string}>}
 */
export function findUnstampedWrites(text, tables) {
  const lines = text.split("\n");
  const problems = [];
  for (const table of tables) {
    const callRe = new RegExp(
      `\\.from\\(["'\`]${table}["'\`]\\)[\\s\\S]{0,120}?\\.(upsert|update)\\(`,
      "g",
    );
    let m;
    while ((m = callRe.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      const from = Math.max(0, line - 1 - CONTEXT_LINES);
      const to = Math.min(lines.length, line + CONTEXT_LINES);
      const context = lines.slice(from, to).join("\n");
      if (/\bscraped_at\b/.test(context)) continue;
      if (INSERT_ONLY_HINTS.some((re) => re.test(context))) continue;
      problems.push({
        line,
        table,
        snippet: lines[line - 1]?.trim() ?? "",
      });
    }
  }
  return problems;
}

function main() {
  const sqlTexts = listFiles(
    path.join(REPO_ROOT, "docs/db-migration"),
    ".sql",
  ).map((f) => fs.readFileSync(f, "utf8"));
  const tables = tablesWithScrapedAt(sqlTexts);
  if (tables.size === 0) {
    console.error("NG: scraped_at を持つテーブルを1つも見つけられませんでした");
    console.error(
      "  マイグレーションの書式が変わった可能性があります（検査が空振りします）",
    );
    return 1;
  }

  const jsFiles = listFiles(path.join(REPO_ROOT, "scripts"), ".js").filter(
    (f) => {
      const rel = path.relative(REPO_ROOT, f);
      return !EXCLUDED_DIRS.some((d) => rel.startsWith(d));
    },
  );

  const all = [];
  for (const file of jsFiles) {
    const rel = path.relative(REPO_ROOT, file);
    for (const p of findUnstampedWrites(
      fs.readFileSync(file, "utf8"),
      tables,
    )) {
      all.push({ ...p, file: rel });
    }
  }

  if (all.length > 0) {
    console.error(
      "NG: scraped_at を持つテーブルへの書き込みで、scraped_at を載せていない箇所があります",
    );
    for (const p of all) {
      console.error(`  ${p.file}:${p.line}  (${p.table})`);
      console.error(`    ${p.snippet}`);
    }
    console.error("");
    console.error(
      "  DEFAULT now() は INSERT のときしか効きません。同じキーの行を更新する書き込みでは、",
    );
    console.error(
      "  payload に scraped_at を載せてください（載せないと初回挿入時の値が残り続けます）。",
    );
    console.error(
      "  既存行を更新しない書き込み（ignoreDuplicates: true、新規挿入専用の関数）は対象外です。",
    );
    return 1;
  }

  console.log(
    `OK: scraped_at を持つ${tables.size}テーブル（${[...tables].sort().join(", ")}）への書き込みは、すべて scraped_at を載せている（${jsFiles.length}ファイルを検査）`,
  );
  return 0;
}

process.exit(main());
