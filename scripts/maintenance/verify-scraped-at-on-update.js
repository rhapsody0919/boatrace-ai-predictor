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
 * - **`scraped_at-intentionally-not-set` を書いた箇所**: 更新しないと決めたもの。**理由を必ず添える**。
 *   実例は `racerProfileSync.js` の `saveSeasonStats` で、`racer_profiles` の1行はプロフィールと
 *   期別成績の2つの取得元が混ざっており、プロフィールは既存選手では再取得されないため、
 *   `scraped_at`＝プロフィールの取得時刻は初回挿入時のままで正しい（期別成績側は
 *   `official_updated_at` が別に持つ）
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

/**
 * 呼び出し位置から後ろへ見る行数（payload がこの範囲に入る）。
 * 前方向は行数ではなく「囲っている関数の先頭まで」で切る（下記 enclosingStart）。
 * 固定行数で前を見ると**隣の関数のコメントまで拾い**、別の関数のマーカーで免除されてしまう
 * （実際に `saveSeasonStats` のマーカーが、隣接する `saveNewProfile` を免除していた）
 */
const FORWARD_LINES = 25;

/** 関数の先頭とみなす書き方 */
const FUNCTION_START =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+|^\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/;

/** コメント行か（関数の直前の説明を窓に含めるために使う） */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * 呼び出し行から後ろへたどり、囲っている関数の先頭の行番号（0始まり）を返す。
 * 関数の**直前に続くコメント行も含める**（マーカーと理由はJSDocに書くのが自然なため）。
 * ただし空行で止めるので、さらに手前の別の関数のコメントまでは遡らない
 */
export function enclosingStart(lines, callLineIndex) {
  for (let i = callLineIndex; i >= 0; i -= 1) {
    if (!FUNCTION_START.test(lines[i])) continue;
    let start = i;
    while (start > 0 && COMMENT_LINE.test(lines[start - 1])) start -= 1;
    return start;
  }
  return 0;
}

/** 一回限りの調査・保守コードは対象にしない */
const EXCLUDED_DIRS = ["scripts/analysis/", "scripts/maintenance/"];

/**
 * 既存行を更新しないことがコードから読み取れる書き方（DEFAULT が正しく効くので対象外）。
 *
 * **「新規」等の語の有無では判定しない。** 周辺25行のどこかに語があれば通ってしまい、
 * 「更新しないと決めた」箇所と「書き忘れ」を区別できない（実際に、理由を説明するコメントに
 * 含まれる「新規選手」が免除として働き、検査が空振りした）。コードの形で判定できるものだけを置く
 */
const INSERT_ONLY_HINTS = [/ignoreDuplicates:\s*true/];

/**
 * 「更新しないと決めた」ことを明示するマーカー。**理由をコメントで添えたうえで**書く。
 * 語が周辺にあるだけで通す作りだと、意図的な非設定と書き忘れを区別できないため、
 * 専用のマーカーを要求する（`racer_profiles` の `saveSeasonStats` が実例）
 */
const OPT_OUT_MARKER = /scraped_at-intentionally-not-set/;

/** 実際に値を設定している書き方（`scraped_at: ...`）。単なる言及と区別する */
const ASSIGNS_SCRAPED_AT = /\bscraped_at\s*:/;

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
      // 前は「囲っている関数の先頭」まで（隣の関数のコメントを拾わない）、後ろは固定行数
      const from = enclosingStart(lines, line - 1);
      const to = Math.min(lines.length, line + FORWARD_LINES);
      const context = lines.slice(from, to).join("\n");
      if (ASSIGNS_SCRAPED_AT.test(context)) continue;
      if (OPT_OUT_MARKER.test(context)) continue;
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
