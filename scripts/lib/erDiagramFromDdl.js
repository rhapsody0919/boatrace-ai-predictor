/**
 * docs/db-migration/ のSQL DDLからmermaid erDiagramを機械的に導出する。
 *
 * 「実装前に人がER図を手で描く」方式は、このプロジェクトが既に何度も踏んできた
 * 「散文ルールはコンテキスト圧迫下で読み飛ばされる」パターンを再生産するため、
 * 正の情報源であるDDLから逆算する方式にした（2026-09-15、天才エンジニア視点
 * レビューでの指摘を反映）。完全なSQLパーサーではなく、このプロジェクトの
 * DDL記法（`CREATE TABLE ... (\n...\n);`が閉じ括弧だけの行で終わる等）に
 * 特化した簡易パーサー。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_MIGRATION_DIR = path.join(__dirname, "../../docs/db-migration");
export const DESIGN_DIR = path.join(__dirname, "../../docs/design");

// 括弧の深さを見ながらトップレベルのカンマだけで分割する（VARCHAR(50)等の
// 型パラメータ中のカンマを誤って分割しないため）。
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * SQLテキストからCREATE TABLE文とALTER TABLE ... ADD COLUMN文を抽出し、
 * テーブル・カラム・外部キー関係の一覧を返す。
 */
export function parseTablesFromSql(rawSqlText) {
  // 行末の`-- コメント`を先に除去する。除去せずにトップレベルのカンマで
  // 分割すると、コメント直後（次のカンマの前）に別カラムの定義が続く場合
  // コメント文字列が次カラムのセグメント先頭に紛れ込み、そのカラムが
  // 「\w+で始まらない行」として丸ごと読み飛ばされてしまう
  // （このプロジェクトのDDLはほぼ全カラムに行末コメントが付くため、
  // 気づかずに半分以上のカラムを取りこぼしていた実例あり。2026-09-15判明）。
  const sqlText = rawSqlText.replace(/--[^\n]*/g, "");

  const tables = new Map(); // name -> { columns: [{name, type, isPk}], newTable: boolean }
  const relationships = []; // { fromTable, fromColumn, toTable, toColumn }

  function getTable(name, { newTable } = {}) {
    if (!tables.has(name)) {
      tables.set(name, { name, columns: [], newTable: Boolean(newTable) });
    }
    const t = tables.get(name);
    if (newTable) t.newTable = true;
    return t;
  }

  // CREATE TABLE ... ( ... 閉じ括弧のみの行 );
  const createTableRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = createTableRe.exec(sqlText))) {
    const [, tableName, body] = m;
    const table = getTable(tableName, { newTable: true });

    for (const rawLine of splitTopLevel(body)) {
      const line = rawLine.trim();
      if (!line) continue;

      // テーブルレベルの制約行（CONSTRAINT/UNIQUE/CHECK/PRIMARY KEY(...)単独）
      if (/^(CONSTRAINT|UNIQUE|CHECK)\b/i.test(line)) {
        const fk = line.match(
          /FOREIGN KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i,
        );
        if (fk) {
          relationships.push({
            fromTable: tableName,
            fromColumn: fk[1],
            toTable: fk[2],
            toColumn: fk[3],
          });
        }
        continue;
      }
      if (/^PRIMARY KEY\s*\(/i.test(line)) {
        const pkCols = [...line.matchAll(/\(([^)]+)\)/g)][0]?.[1]
          .split(",")
          .map((c) => c.trim());
        for (const col of pkCols || []) {
          const existing = table.columns.find((c) => c.name === col);
          if (existing) existing.isPk = true;
        }
        continue;
      }

      // 通常のカラム定義: 先頭トークンがカラム名
      const colMatch = line.match(/^(\w+)\s+(.+)$/s);
      if (!colMatch) continue;
      const [, columnName, rest] = colMatch;
      const isPk = /PRIMARY KEY/i.test(rest);
      const typeMatch = rest.match(
        /^([\w()0-9,\s]+?)(?:\s+(?:NOT NULL|DEFAULT|PRIMARY KEY|UNIQUE|CHECK|REFERENCES).*)?$/i,
      );
      const type = (typeMatch?.[1] || rest.split(/\s+/)[0]).trim();

      table.columns.push({ name: columnName, type, isPk });

      const ref = rest.match(/REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i);
      if (ref) {
        relationships.push({
          fromTable: tableName,
          fromColumn: columnName,
          toTable: ref[1],
          toColumn: ref[2],
        });
      }
    }
  }

  // ALTER TABLE x ADD COLUMN a ..., ADD COLUMN b ..., ...;
  // (1文で複数カラムをカンマ区切りで追加する書き方がこのプロジェクトの主流のため、
  // ADD COLUMN句ごとに独立した文だと決め打ちしない)
  const alterTableRe = /ALTER TABLE\s+(\w+)\s+([\s\S]*?);/gi;
  while ((m = alterTableRe.exec(sqlText))) {
    const [, tableName, body] = m;
    if (!/ADD COLUMN/i.test(body)) continue;
    const table = getTable(tableName); // 既存テーブルへの追加。newTableは立てない

    for (const rawClause of splitTopLevel(body)) {
      const clause = rawClause.trim();
      const colMatch = clause.match(
        /^ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)\s+(.+)$/is,
      );
      if (!colMatch) continue;
      const [, columnName, rest] = colMatch;
      const typeMatch = rest.match(
        /^([\w()0-9,\s]+?)(?:\s+(?:NOT NULL|DEFAULT|PRIMARY KEY|UNIQUE|CHECK|REFERENCES).*)?$/i,
      );
      const type = (typeMatch?.[1] || rest.split(/\s+/)[0]).trim();
      table.columns.push({ name: columnName, type, isPk: false });

      const ref = rest.match(/REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i);
      if (ref) {
        relationships.push({
          fromTable: tableName,
          fromColumn: columnName,
          toTable: ref[1],
          toColumn: ref[2],
        });
      }
    }
  }

  return { tables: [...tables.values()], relationships };
}

/**
 * {slug}のspec/plan.mdを参照しているdocs/db-migration/配下のSQLファイル一覧を返す。
 * このプロジェクトの既存慣習（マイグレーションのヘッダーコメントに
 * `docs/design/{slug}/plan.md`等の参照を書く）に依存した検出方法。
 */
export async function findLinkedMigrations(slug) {
  const files = await fs.readdir(DB_MIGRATION_DIR);
  const sqlFiles = files.filter((f) => f.endsWith(".sql"));
  const linked = [];
  for (const f of sqlFiles) {
    const content = await fs.readFile(path.join(DB_MIGRATION_DIR, f), "utf-8");
    if (content.includes(`docs/design/${slug}/`)) {
      linked.push({ file: f, content });
    }
  }
  return linked;
}

/**
 * パース結果からmermaid erDiagramのコードブロック本文（```mermaid行は含まない）を生成する。
 */
export function buildMermaidErDiagram({ tables, relationships }) {
  const lines = ["erDiagram"];

  for (const rel of relationships) {
    const label =
      rel.fromColumn === rel.toColumn
        ? rel.fromColumn
        : `${rel.fromColumn} -> ${rel.toColumn}`;
    lines.push(`    ${rel.fromTable} }o--|| ${rel.toTable} : "${label}"`);
  }

  for (const table of tables) {
    if (table.columns.length === 0) continue;
    lines.push(`    ${table.name} {`);
    for (const col of table.columns) {
      const pk = col.isPk ? " PK" : "";
      const safeType = (col.type || "text").replace(/\s+/g, "_");
      lines.push(`        ${safeType} ${col.name}${pk}`);
    }
    lines.push("    }");
  }

  return lines.join("\n");
}
