/**
 * scripts/lib/dbApplySql.js から移した、job summary（renderSummary）の部品。冒頭コメントの確認の節の取り出し・
 * セルと地の文の無害化・節ごとの行の組み立て。字は元のまま。
 */

// これを超える行には注意を出す（本文の枠の外に隠れる）
export const LONG_LINE_CHARS = 200;

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

export const fenceFor = (text) => {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length),
  );
  return "`".repeat(longest + 1);
};

export const rejectionLines = (rejections) =>
  rejections.length === 0
    ? []
    : ["### このファイルは適用できない（承認の前に止めた）", "", ...rejections.map((r) => `- ${r}`), ""];

export function longLineLines(lines) {
  const longLines = lines
    .map((l, idx) => ({ line: idx + 1, length: l.length }))
    .filter((l) => l.length > LONG_LINE_CHARS);
  if (longLines.length === 0) return [];
  return [
    `> **注意: ${LONG_LINE_CHARS} 字を超える行がある（${longLines
      .slice(0, 10)
      .map((l) => `${l.line}行目 ${l.length}字`)
      .join("、")}）。本文の枠は横にスクロールしないと見えないので、行末まで読んでから承認する**`,
    "",
  ];
}

export const appliedNoticeLines = (alreadyApplied) =>
  alreadyApplied
    ? ["> **注意: 台帳（APPLIED.md）ではこのファイルは既に「適用済み」。再適用で問題ないか確認してから承認する**", ""]
    : [];

export const infoTableLines = ({ path, sha256, fileUrl, lineCount, inspection }) => [
  "| 項目 | 値 |",
  "|---|---|",
  `| ファイル | [${path}](${fileUrl}) |`,
  `| sha256 | \`${sha256}\` |`,
  `| 行数 | ${lineCount} |`,
  `| 文の数 | ${inspection.statements.length} |`,
  `| 実行のしかた | ${
    inspection.mode === "file-transaction"
      ? "ファイル自身の BEGIN〜COMMIT（1つのトランザクション。途中で失敗したら全体が戻る）"
      : "psql --single-transaction（1つのトランザクション。途中で失敗したら全体が戻る）"
  } |`,
  "",
];

export const tableLines = (tables) => [
  "### 触るテーブル（CREATE/ALTER/INSERT/UPDATE/DELETE/DROP/TRUNCATE の対象）",
  "",
  ...(tables.length === 0
    ? ["なし（関数・ポリシー・権限・コメントだけの変更か、DO ブロックの中で触っている。本文で確認する）"]
    : ["| テーブル | 操作 |", "|---|---|", ...tables.map((t) => `| \`${codeCell(t.table)}\` | ${t.ops.join(", ")} |`)]),
  "",
  "DO ブロック・関数本体（$$ の中）は抽出しない。",
  "",
];

export function confirmationLines(sql) {
  const sections = extractConfirmationSections(sql);
  const body =
    sections.length === 0
      ? ["冒頭コメントに「確認」の節が無い。本文の確認方法を読んでから承認する。"]
      : sections.flatMap((s) => {
          const text = s.lines.join("\n");
          const fence = fenceFor(text);
          return [`**${escapeInline(s.heading)}**`, "", `${fence}sql`, text, fence, ""];
        });
  return ["### 冒頭コメントの確認 SQL", "", ...body];
}

export const statementListLines = (statements) => [
  "### 文の一覧（先頭120字）",
  "",
  "| 行 | 文 |",
  "|---|---|",
  ...statements.map((s) => `| ${s.line} | \`${codeCell(s.head)}\` |`),
  "",
];

export function bodyLines(lines, lineCount, maxBodyLines) {
  const shown = lines.slice(0, maxBodyLines).join("\n");
  const fence = fenceFor(shown);
  return [
    lineCount > maxBodyLines
      ? `### 本文（先頭 ${maxBodyLines} 行 / 全 ${lineCount} 行。全文は上のリンク）`
      : "### 本文",
    "",
    `${fence}sql`,
    shown.replace(/\n$/, ""),
    fence,
    "",
  ];
}
