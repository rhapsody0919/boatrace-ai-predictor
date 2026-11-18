/**
 * 承認の前に読む要約（dbApplySql.js から分けた純粋関数）: 確認の節の取り出し・Markdown の要約。
 * 呼び出し元はこれまでどおり dbApplySql.js から import できる
 */

// これを超える行には注意を出す（本文の枠の外に隠れる）
const LONG_LINE_CHARS = 200;

/**
 * ファイル冒頭のコメント（最初の文より前の -- 行）から、見出しに「確認」を含む節を取り出す。
 * 見出し: `-- 適用後の確認（読み取りのみ）:` のように `-- ` の直後から書かれ、`:`（全角可）を含む行。
 * 中身: 続く `--` + 空白2つ以上で字下げされた行。
 *
 * @param {string} sql
 * @returns {{ heading: string, lines: string[] }[]}
 */
export function extractConfirmationSections(sql) {
  const header = [];
  for (const raw of sql.split("\n")) {
    const lineText = raw.replace(/\r$/, "");
    if (lineText.trim() === "") {
      header.push("--");
      continue;
    }
    if (!/^\s*--/.test(lineText)) break;
    header.push(lineText.trim());
  }
  const sections = [];
  let current = null;
  for (const lineText of header) {
    // 見出しの「確認」より前に : が無いこと（「過去分: …確認できておらず」を見出しにしない）
    const heading = /^-- ?((?=\S)[^:：]*確認[^:：]*[:：])\s*(.*)$/.exec(lineText);
    if (heading) {
      current = { heading: heading[1], inline: heading[2], indented: [] };
      sections.push(current);
      continue;
    }
    if (current && /^--\s{2,}\S/.test(lineText)) {
      current.indented.push(lineText.slice(2));
      continue;
    }
    current = null;
  }
  return sections.map(({ heading, inline, indented }) => {
    const indent = Math.min(...indented.map((l) => l.search(/\S/)));
    return {
      heading,
      lines: [...(inline ? [inline] : []), ...indented.map((l) => l.slice(indent))],
    };
  });
}

/**
 * job summary の表のセルに入れるコード片（`…` で囲む前）。コードスパンの中では HTML も Markdown も解釈されないので、
 * 抜け出す手段（` と改行）と、表の列を割る | だけを潰す
 */
export const codeCell = (text) =>
  String(text).replace(/\s+/g, " ").replace(/`/g, "'").replace(/\|/g, "\\|");

/** job summary の地の文（見出し等）に SQL 由来の文字列を入れるとき、Markdown・HTML として解釈させない */
export const escapeInline = (text) =>
  String(text)
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]|~]/g, (c) => `\\${c}`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fenceFor = (text) => {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length),
  );
  return "`".repeat(longest + 1);
};

/** 拒否・長い行・適用済みの注意（この順） */
function pushWarnings(out, { lines, inspection, alreadyApplied }) {
  if (inspection.rejections.length > 0) {
    out.push("### このファイルは適用できない（承認の前に止めた）");
    out.push("");
    for (const r of inspection.rejections) out.push(`- ${r}`);
    out.push("");
  }
  const longLines = lines
    .map((l, idx) => ({ line: idx + 1, length: l.length }))
    .filter((l) => l.length > LONG_LINE_CHARS);
  if (longLines.length > 0) {
    out.push(
      `> **注意: ${LONG_LINE_CHARS} 字を超える行がある（${longLines
        .slice(0, 10)
        .map((l) => `${l.line}行目 ${l.length}字`)
        .join("、")}）。本文の枠は横にスクロールしないと見えないので、行末まで読んでから承認する**`,
    );
    out.push("");
  }
  if (alreadyApplied) {
    out.push(
      "> **注意: 台帳（APPLIED.md）ではこのファイルは既に「適用済み」。再適用で問題ないか確認してから承認する**",
    );
    out.push("");
  }
}

/** 項目の表 */
function pushFacts(out, { path, sha256, fileUrl, lineCount, inspection }) {
  out.push("| 項目 | 値 |");
  out.push("|---|---|");
  out.push(`| ファイル | [${path}](${fileUrl}) |`);
  out.push(`| sha256 | \`${sha256}\` |`);
  out.push(`| 行数 | ${lineCount} |`);
  out.push(`| 文の数 | ${inspection.statements.length} |`);
  out.push(
    `| 実行のしかた | ${
      inspection.mode === "file-transaction"
        ? "ファイル自身の BEGIN〜COMMIT（1つのトランザクション。途中で失敗したら全体が戻る）"
        : "psql --single-transaction（1つのトランザクション。途中で失敗したら全体が戻る）"
    } |`,
  );
  out.push("");
}

/** 触るテーブルの節 */
function pushTables(out, inspection) {
  out.push(
    "### 触るテーブル（CREATE/ALTER/INSERT/UPDATE/DELETE/DROP/TRUNCATE の対象）",
  );
  out.push("");
  if (inspection.tables.length === 0) {
    out.push(
      "なし（関数・ポリシー・権限・コメントだけの変更か、DO ブロックの中で触っている。本文で確認する）",
    );
  } else {
    out.push("| テーブル | 操作 |");
    out.push("|---|---|");
    for (const t of inspection.tables)
      out.push(`| \`${codeCell(t.table)}\` | ${t.ops.join(", ")} |`);
  }
  out.push("");
  out.push("DO ブロック・関数本体（$$ の中）は抽出しない。");
  out.push("");
}

/** 冒頭コメントの確認 SQL の節 */
function pushConfirmations(out, sql) {
  out.push("### 冒頭コメントの確認 SQL");
  out.push("");
  const sections = extractConfirmationSections(sql);
  if (sections.length === 0) {
    out.push(
      "冒頭コメントに「確認」の節が無い。本文の確認方法を読んでから承認する。",
    );
  } else {
    for (const s of sections) {
      const text = s.lines.join("\n");
      const fence = fenceFor(text);
      out.push(`**${escapeInline(s.heading)}**`);
      out.push("");
      out.push(`${fence}sql`);
      out.push(text);
      out.push(fence);
      out.push("");
    }
  }
}

/** 文の一覧と本文の節 */
function pushStatementsAndBody(out, { lines, lineCount, inspection, maxBodyLines }) {
  out.push("### 文の一覧（先頭120字）");
  out.push("");
  out.push("| 行 | 文 |");
  out.push("|---|---|");
  for (const s of inspection.statements) {
    out.push(`| ${s.line} | \`${codeCell(s.head)}\` |`);
  }
  out.push("");
  const shown = lines.slice(0, maxBodyLines).join("\n");
  const fence = fenceFor(shown);
  out.push(
    lineCount > maxBodyLines
      ? `### 本文（先頭 ${maxBodyLines} 行 / 全 ${lineCount} 行。全文は上のリンク）`
      : "### 本文",
  );
  out.push("");
  out.push(`${fence}sql`);
  out.push(shown.replace(/\n$/, ""));
  out.push(fence);
  out.push("");
}

/**
 * 承認の前に見る job summary（Markdown）。
 * @param {{ path: string, sha256: string, sql: string, inspection: ReturnType<typeof inspectMigration>,
 *           fileUrl: string, alreadyApplied: boolean, maxBodyLines?: number }} args
 */
export function renderSummary({
  path,
  sha256,
  sql,
  inspection,
  fileUrl,
  alreadyApplied,
  maxBodyLines = 2000,
}) {
  const lines = sql.split("\n");
  const lineCount = sql.endsWith("\n") ? lines.length - 1 : lines.length;
  const out = [];
  out.push(`## 本番 DB への適用: \`${path}\``);
  out.push("");
  pushWarnings(out, { lines, inspection, alreadyApplied });
  pushFacts(out, { path, sha256, fileUrl, lineCount, inspection });
  pushTables(out, inspection);
  pushConfirmations(out, sql);
  pushStatementsAndBody(out, { lines, lineCount, inspection, maxBodyLines });
  return out.join("\n");
}
