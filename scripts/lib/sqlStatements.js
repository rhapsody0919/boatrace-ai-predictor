/**
 * SQL を最上位の `;` で文に分ける字句の読み（純粋関数）。dbApplySql.js の splitStatements の本体を、
 * 読む位置・行・文の途中の状態を1つの物（scanner）に持たせ、引用・コメント・$ 引用・メタコマンドごとの関数へ分けた。
 * 出力は元の splitStatements と同じ（呼び出し元は dbApplySql.js から import する）。
 */

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

const createScanner = (sql) => ({
  sql,
  n: sql.length,
  i: 0,
  line: 1,
  code: "",
  stmtLine: 0, // 文の最初の非空白文字の行（0=まだ無い）
  stmtStart: 0, // 文の最初の非空白文字の位置
  statements: [],
  metaCommands: [],
  errors: [],
});

function markStart(st) {
  if (st.stmtLine === 0) {
    st.stmtLine = st.line;
    st.stmtStart = st.i;
  }
}

function advance(st, count) {
  for (let k = 0; k < count; k += 1) {
    if (st.sql[st.i + k] === "\n") st.line += 1;
  }
  st.i += count;
}

function scanLineComment(st) {
  const end = st.sql.indexOf("\n", st.i);
  const stop = end === -1 ? st.n : end;
  st.code += " ";
  advance(st, stop - st.i);
}

function scanBlockComment(st) {
  const { sql } = st;
  let depth = 1;
  const startLine = st.line;
  advance(st, 2);
  while (st.i < st.n && depth > 0) {
    if (sql[st.i] === "/" && sql[st.i + 1] === "*") {
      depth += 1;
      advance(st, 2);
    } else if (sql[st.i] === "*" && sql[st.i + 1] === "/") {
      depth -= 1;
      advance(st, 2);
    } else {
      advance(st, 1);
    }
  }
  if (depth > 0) st.errors.push(`${startLine}行目: 閉じていないコメント /*`);
  st.code += " ";
}

/** 開きの ' の後から読み、閉じたかを返す */
function skipStringBody(st, escapeString) {
  const { sql } = st;
  while (st.i < st.n) {
    if (escapeString && sql[st.i] === "\\") {
      advance(st, 2);
      continue;
    }
    if (sql[st.i] === "'") {
      if (sql[st.i + 1] === "'") {
        advance(st, 2);
        continue;
      }
      advance(st, 1);
      return true;
    }
    advance(st, 1);
  }
  return false;
}

function scanString(st) {
  markStart(st);
  const prev = st.sql[st.i - 1] ?? "";
  const prev2 = st.sql[st.i - 2] ?? "";
  const escapeString = /[Ee]/.test(prev) && !IDENT_CHAR.test(prev2);
  const startLine = st.line;
  advance(st, 1);
  const closed = skipStringBody(st, escapeString);
  if (!closed) st.errors.push(`${startLine}行目: 閉じていない文字列 '`);
  st.code += "''";
}

function scanQuotedIdent(st) {
  const { sql, n, i } = st;
  markStart(st);
  const startLine = st.line;
  let j = i + 1;
  let closed = false;
  while (j < n) {
    if (sql[j] === '"') {
      if (sql[j + 1] === '"') {
        j += 2;
        continue;
      }
      closed = true;
      break;
    }
    j += 1;
  }
  if (!closed) {
    st.errors.push(`${startLine}行目: 閉じていない識別子 "`);
    st.code += sql.slice(i);
    advance(st, n - i);
    return;
  }
  st.code += sql.slice(i, j + 1);
  advance(st, j + 1 - i);
}

/** $タグ$ の引用なら読み進めて true。そうでなければ何もせず false */
function scanDollarQuote(st) {
  const { sql, i } = st;
  const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(
    sql.slice(i, i + 64),
  );
  if (!m) return false;
  markStart(st);
  const tag = m[0];
  const startLine = st.line;
  const end = sql.indexOf(tag, i + tag.length);
  if (end === -1) {
    st.errors.push(`${startLine}行目: 閉じていない ${tag} 引用`);
    st.code += `${tag}${tag}`;
    advance(st, st.n - i);
    return true;
  }
  st.code += `${tag}${tag}`;
  advance(st, end + tag.length - i);
  return true;
}

function scanMetaCommand(st) {
  const end = st.sql.indexOf("\n", st.i);
  st.metaCommands.push({
    line: st.line,
    text: st.sql.slice(st.i, end === -1 ? st.n : end).slice(0, 80),
  });
  st.code += " ";
  advance(st, 1);
}

function endStatement(st) {
  if (st.code.trim() !== "") {
    st.statements.push({
      code: st.code.trim(),
      line: st.stmtLine,
      text: st.sql.slice(st.stmtStart, st.i),
    });
  }
  st.code = "";
  st.stmtLine = 0;
  advance(st, 1);
}

/** 1字（または1つのまとまり）を読み進める */
function scanStep(st) {
  const c = st.sql[st.i];
  const next = st.sql[st.i + 1];
  if (c === "-" && next === "-") return scanLineComment(st);
  if (c === "/" && next === "*") return scanBlockComment(st);
  if (c === "'") return scanString(st);
  if (c === '"') return scanQuotedIdent(st);
  if (c === "$" && !IDENT_CHAR.test(st.sql[st.i - 1] ?? "") && scanDollarQuote(st)) return;
  if (c === "\\") return scanMetaCommand(st);
  if (c === ";") return endStatement(st);
  if (!/\s/.test(c)) markStart(st);
  st.code += c;
  advance(st, 1);
}

/**
 * SQL を最上位の `;` で文に分ける。文字列（'…'・E'…'）・$タグ$…$タグ$・"識別子"・コメント（-- と入れ子の \/* *\/）の中の
 * `;` やキーワードは文の区切り・判定に使わない。
 *
 * 各文の code は、コメントを空白に、文字列と $ 引用の中身を空にしたもの（"識別子" は残す）。
 * 最上位（引用・コメントの外）のバックスラッシュは psql のメタコマンド（\! でシェルを実行できる）なので metaCommands に入れる。
 *
 * @param {string} sql
 * @returns {{ statements: { code: string, line: number, text: string }[], metaCommands: { line: number, text: string }[], errors: string[] }}
 */
export function splitStatements(sql) {
  const st = createScanner(sql);
  while (st.i < st.n) scanStep(st);
  if (st.code.trim() !== "") {
    st.statements.push({ code: st.code.trim(), line: st.stmtLine, text: sql.slice(st.stmtStart) });
  }
  return { statements: st.statements, metaCommands: st.metaCommands, errors: st.errors };
}
