#!/usr/bin/env node
/**
 * docs/reference/database-design.md の「テーブル一覧と使用状況」と「コアテーブル詳細」を、
 * 本番のスキーマとリポジトリのコードから作り直す（BOA-330）。読み取りのみ。
 *
 * 手書きの節は初期設計（2025年）のまま陳腐化していた（使用中の race_odds を「未使用」と書く等）。
 * 生成した内容は、文書の中のマーカー
 *   <!-- generated:table-usage:start --> 〜 <!-- generated:table-usage:end -->
 *   <!-- generated:core-tables:start --> 〜 <!-- generated:core-tables:end -->
 * の間だけを書き換える。
 *
 * 取得元:
 *   - テーブル・ビュー・列・型・PK・FK・列コメント: PostgREST の OpenAPI（/rest/v1/、service key）
 *   - 推定行数: 各表への HEAD（count=estimated。pg の統計値なので概数）
 *   - コードの参照: src/・api/・scripts/ で表名を（単語の境界で）含むファイルを数える。
 *     コメントでの言及も数えるので、「参照なし」は確実だが「参照あり」は使用の証明ではない
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/generate-database-design-sections.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const DOC = path.join(ROOT, "docs/reference/database-design.md");
const CODE_DIRS = ["src", "api", "scripts"];
// 主要なテーブル（レース・出走・結果・予想と、それを作る直前情報・会場・モデル）
const CORE_TABLES = [
  "races",
  "race_entries",
  "race_results",
  "race_start_timings",
  "race_conditions",
  "exhibition_data",
  "predictions",
  "models",
  "racer_aggregated_stats",
  "venues",
];

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "SUPABASE_URL と SUPABASE_SERVICE_KEY が必要です（--env-file=.env.local）",
  );
  process.exit(1);
}
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

async function fetchOpenApi() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { ...headers, Accept: "application/openapi+json" },
  });
  if (!res.ok) throw new Error(`OpenAPI の取得に失敗: HTTP ${res.status}`);
  return res.json();
}

async function estimatedRows(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=estimated" },
  });
  if (!res.ok)
    throw new Error(`${table} の行数の取得に失敗: HTTP ${res.status}`);
  const range = res.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : null;
}

function listCodeFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs|ts)$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

// 表名 → { dir → 表名を含むファイルの集合 }。表名は単語の境界で照合する
// （`.from("表名")`・定数の定義・REST の URL `/rest/v1/表名`・埋め込み `表名(列)` のどれでも拾う）
function codeReferences(tableNames) {
  const refs = new Map(tableNames.map((t) => [t, {}]));
  const patterns = tableNames.map((t) => [
    t,
    new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`),
  ]);
  for (const dir of CODE_DIRS) {
    for (const file of listCodeFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      for (const [table, re] of patterns) {
        if (!re.test(text)) continue;
        const byDir = refs.get(table);
        byDir[dir] ??= new Set();
        byDir[dir].add(file);
      }
    }
  }
  return refs;
}

const isPk = (col) => /<pk\/>/.test(col.description ?? "");
const fkOf = (col) =>
  (col.description ?? "").match(/<fk table='([^']+)' column='([^']+)'\/>/);
// PostgREST が説明文に足す「Note: This is a Primary Key.」等を除いた、列コメントの本文
const commentOf = (col) =>
  (col.description ?? "")
    .replace(
      /Note:\n?This is a (Primary|Foreign) Key[^\n]*<(pk|fk)[^>]*\/>/g,
      "",
    )
    .trim()
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|");

function usageLabel(rows, refCount) {
  if (refCount === 0) return "コード参照なし";
  if (rows === 0) return "空（参照あり）";
  return "使用中";
}

function renderUsage(defs, rowsByTable, refs, generatedAt) {
  const lines = [
    `本番スキーマ（PostgREST の OpenAPI）とコード（表名の出現）から機械生成（${generatedAt}、\`scripts/maintenance/generate-database-design-sections.js\`）。`,
    "行数は pg の統計値による推定（概数）。「使用中」は推定行数>0 かつコード参照あり。参照数は表名を含む src/・api/・scripts/ のファイル数（コメントでの言及も数える。docs/db-migration の SQL・RPC は数えない）。「コード参照なし」は確実だが、参照ありは使用の証明ではない。",
    "",
    "| テーブル | 種別 | 推定行数 | PK | src | api | scripts | 状態 |",
    "|---|---|---:|---|---:|---:|---:|---|",
  ];
  for (const name of Object.keys(defs).sort()) {
    const props = defs[name].properties ?? {};
    const pk = Object.entries(props)
      .filter(([, c]) => isPk(c))
      .map(([k]) => k)
      .join(", ");
    // PK を持たないものはビュー（PostgREST は表の PK だけを注記する）
    const kind = pk ? "表" : "ビュー等";
    const byDir = refs.get(name) ?? {};
    const counts = CODE_DIRS.map((d) => byDir[d]?.size ?? 0);
    const total = counts.reduce((a, b) => a + b, 0);
    const rows = rowsByTable.get(name);
    lines.push(
      `| \`${name}\` | ${kind} | ${rows ?? "—"} | ${pk || "—"} | ${counts.join(" | ")} | ${usageLabel(rows, total)} |`,
    );
  }
  return lines.join("\n");
}

function renderCore(defs, rowsByTable) {
  const out = [
    "主要なテーブルの列。型・NULL 可否・PK・FK・列コメント（`COMMENT ON COLUMN`）は本番スキーマから機械生成。",
    "列の意味の詳細は、各列を足したマイグレーション（`docs/db-migration/`）と機能の設計（`docs/design/{slug}/plan.md`）を参照。",
  ];
  for (const name of CORE_TABLES) {
    const def = defs[name];
    if (!def) {
      out.push("", `### ${name}`, "", "（本番に存在しない）");
      continue;
    }
    const required = new Set(def.required ?? []);
    out.push(
      "",
      `### ${name}`,
      "",
      `推定行数: ${rowsByTable.get(name) ?? "—"}`,
      "",
      "| 列 | 型 | NULL | キー | コメント |",
      "|---|---|---|---|---|",
    );
    for (const [col, c] of Object.entries(def.properties ?? {})) {
      const fk = fkOf(c);
      const key = [isPk(c) ? "PK" : "", fk ? `FK→${fk[1]}.${fk[2]}` : ""]
        .filter(Boolean)
        .join(" ");
      out.push(
        `| \`${col}\` | ${c.format ?? c.type ?? ""} | ${required.has(col) ? "不可" : "可"} | ${key} | ${commentOf(c)} |`,
      );
    }
  }
  return out.join("\n");
}

function replaceBetween(doc, marker, body) {
  const start = `<!-- generated:${marker}:start -->`;
  const end = `<!-- generated:${marker}:end -->`;
  const i = doc.indexOf(start);
  const j = doc.indexOf(end);
  if (i < 0 || j < i) throw new Error(`${DOC} にマーカー ${marker} が無い`);
  return `${doc.slice(0, i + start.length)}\n${body}\n${doc.slice(j)}`;
}

const api = await fetchOpenApi();
const defs = api.definitions ?? {};
const names = Object.keys(defs);
const rowsByTable = new Map();
for (const name of names) rowsByTable.set(name, await estimatedRows(name));
const refs = codeReferences(names);
const generatedAt = new Date().toISOString().slice(0, 10);

let doc = fs.readFileSync(DOC, "utf8");
doc = replaceBetween(
  doc,
  "table-usage",
  renderUsage(defs, rowsByTable, refs, generatedAt),
);
doc = replaceBetween(doc, "core-tables", renderCore(defs, rowsByTable));
fs.writeFileSync(DOC, doc);
console.log(
  `✅ ${path.relative(ROOT, DOC)} を更新（${names.length} 件、コア ${CORE_TABLES.length} 表）`,
);
