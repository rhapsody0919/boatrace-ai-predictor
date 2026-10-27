/**
 * データの読み手の台帳（docs/reference/data-readers.{json,md}）の抽出と組み立て。DB にも
 * ファイルにも触れない純粋な関数だけを置く（I/O は scripts/maintenance/generate-data-readers.js）。
 *
 * 読み手・書き手はソースを @babel/parser で構文木にして拾う（grep の文字列ではなく）。
 *   - Supabase クライアント: `.from("表")` に続く `.select/.insert/.upsert/.update/.delete` と絞り込み
 *     （`.eq("列", …)` 等）の連鎖、`.rpc("関数")`
 *   - REST の直叩き: 文字列・テンプレートの `/rest/v1/表?…`・`/rest/v1/rpc/関数`。囲む fetch の
 *     `method` で読み書きを分ける
 *   - 名前が変数（`.from(table)`・`/rest/v1/${path}`）のものは拾えないので unresolved に入れる
 * RPC の本体が読む・書く表は、本番スキーマの写し（docs/reference/schema-snapshot.json、ADR-0102）の
 * 関数の定義から、コメントと文字列を外した SQL の FROM・JOIN・INTO・UPDATE の後の名前で引く。
 * 権限は写しの GRANT とポリシーから引く。
 */
import { parse } from "@babel/parser";

export const LEDGER_JSON = "docs/reference/data-readers.json";
export const LEDGER_MD = "docs/reference/data-readers.md";
export const EXTRA_FILE = "docs/reference/data-readers.extra.json";
export const FORMAT = 1;

/** 読み手を拾うディレクトリ（git ls-files の結果をここで絞る） */
export const SOURCE_ROOTS = ["src/", "api/", "scripts/", "sns-video-studio/"];
const SOURCE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|build|out|coverage)\//;

/** 検査のための固定入力を持つファイル。`.from("x")` が偽の表のことが多いので、写しに有る名前だけを拾う */
export function isFixtureLike(file) {
  return (
    /^scripts\/maintenance\/verify-[^/]+\.js$/.test(file) ||
    /^scripts\/tests\//.test(file) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

export function isSourceFile(file) {
  return (
    SOURCE_ROOTS.some((r) => file.startsWith(r)) &&
    SOURCE_EXT.test(file) &&
    !SKIP_PATH.test(file) &&
    !file.endsWith(".d.ts")
  );
}

const WRITE_OPS = new Set(["insert", "upsert", "update", "delete"]);
const DB_OPS = new Set(["select", ...WRITE_OPS]);
/** 第1引数が列の名前になる絞り込み・並べ替え */
const COLUMN_FILTERS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "likeAllOf",
  "likeAnyOf",
  "ilikeAllOf",
  "ilikeAnyOf",
  "is",
  "isDistinct",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "rangeAdjacent",
  "textSearch",
  "not",
  "filter",
  "order",
]);
/** `X.from(…)` の X がこれなら Supabase ではない */
const NON_DB_FROM_OBJECTS = new Set([
  "Array",
  "Buffer",
  "Object",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "Set",
  "Map",
  "Iterator",
  "Readable",
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "range",
]);

function parserPlugins(file) {
  if (/\.tsx$/.test(file)) return ["typescript", "jsx"];
  if (/\.ts$/.test(file)) return ["typescript"];
  return ["jsx"];
}

/** 文字列・式の無いテンプレートの値。それ以外は null */
export function literalString(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
  }
  return null;
}

function splitTopLevel(text, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * PostgREST の select の文字列を、列と埋め込み（別の表）に分ける。
 * `a, b:c, d::text, e->x, rel!fk(x, y), alias:rel!inner(*)`
 * @returns {{ columns: string[], embeds: Array<{ name: string, columns: string[], embeds: unknown[] }> }}
 */
export function parseSelect(text) {
  const columns = [];
  const embeds = [];
  for (const raw of splitTopLevel(String(text).replace(/\s+/g, " "), ",")) {
    let item = raw.replace(/^\.\.\./, "").trim();
    const paren = item.indexOf("(");
    if (paren >= 0 && item.endsWith(")")) {
      let head = item.slice(0, paren).trim();
      const inner = item.slice(paren + 1, -1);
      if (head.includes(":")) head = head.slice(head.lastIndexOf(":") + 1);
      head = head.split("!")[0].trim();
      // count()・sum() 等の集約は列ではない
      if (["count", "sum", "avg", "min", "max"].includes(head) && !inner)
        continue;
      if (IDENT.test(head)) embeds.push({ name: head, ...parseSelect(inner) });
      continue;
    }
    // alias:col（ただし :: はキャスト）
    const aliasMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*(.+)$/);
    if (aliasMatch) item = aliasMatch[2];
    item = item.split("::")[0].split("->")[0].split(".")[0].trim();
    if (item === "*" || IDENT.test(item)) columns.push(item);
  }
  return { columns, embeds };
}

function objectKeys(node) {
  if (!node) return null;
  if (node.type === "ObjectExpression") {
    const keys = [];
    for (const p of node.properties) {
      if (p.type !== "ObjectProperty" || p.computed) return null; // スプレッド・計算キーは分からない
      if (p.key.type === "Identifier") keys.push(p.key.name);
      else if (p.key.type === "StringLiteral") keys.push(p.key.value);
      else return null;
    }
    return keys;
  }
  if (node.type === "ArrayExpression") {
    const all = new Set();
    for (const el of node.elements) {
      const keys = objectKeys(el);
      if (!keys) return null;
      keys.forEach((k) => all.add(k));
    }
    return [...all];
  }
  return null;
}

function propertyValue(objNode, name) {
  if (!objNode || objNode.type !== "ObjectExpression") return undefined;
  for (const p of objNode.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue;
    const key =
      p.key.type === "Identifier"
        ? p.key.name
        : p.key.type === "StringLiteral"
          ? p.key.value
          : null;
    if (key === name) return p.value;
  }
  return undefined;
}

function memberName(node) {
  if (
    !node ||
    (node.type !== "MemberExpression" &&
      node.type !== "OptionalMemberExpression")
  )
    return null;
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  return literalString(node.property);
}

function isCall(node) {
  return (
    node &&
    (node.type === "CallExpression" || node.type === "OptionalCallExpression")
  );
}

/** `callNode` の後ろに続く `.m(args)` の連鎖を外側へ集める */
function chainAfter(callNode, parents) {
  const chain = [];
  let cur = callNode;
  for (;;) {
    const member = parents.get(cur);
    if (
      !member ||
      (member.type !== "MemberExpression" &&
        member.type !== "OptionalMemberExpression") ||
      member.object !== cur
    )
      break;
    const call = parents.get(member);
    if (!isCall(call) || call.callee !== member) break;
    chain.push({ name: memberName(member), args: call.arguments });
    cur = call;
  }
  return chain;
}

function walk(root, visit) {
  const parents = new Map();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    visit(node, parents);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i -= 1) {
          const c = v[i];
          if (c && typeof c.type === "string") {
            parents.set(c, node);
            stack.push(c);
          }
        }
      } else if (v && typeof v.type === "string") {
        parents.set(v, node);
        stack.push(v);
      }
    }
  }
  return parents;
}

/** 親の連鎖を外へたどり、最初に当たる fetch 系の呼び出しの method を返す（GET が既定） */
function enclosingFetchMethod(node, parents) {
  let cur = node;
  for (let depth = 0; depth < 6 && cur; depth += 1) {
    const p = parents.get(cur);
    if (!p) break;
    if (isCall(p) && p.arguments[0] === cur) {
      const calleeName =
        p.callee.type === "Identifier" ? p.callee.name : memberName(p.callee);
      const isFetch = Boolean(calleeName && /fetch/i.test(calleeName));
      const opts = p.arguments[1];
      // fetch 以外の包み（db("rpc/…", { method })）は method が書いてあるときだけ分かる
      if (!opts) return isFetch ? "GET" : null;
      const m = propertyValue(opts, "method");
      if (m === undefined)
        return isFetch && opts.type === "ObjectExpression" ? "GET" : null;
      const lit = literalString(m);
      return lit ? lit.toUpperCase() : null;
    }
    cur = p;
  }
  return null;
}

const REST_RESERVED_PARAMS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "or",
  "and",
  "columns",
]);

/** `/rest/v1/…` の文字列（テンプレートは式を `\u0000` に置いた形）から表・RPC と列を読む */
export function parseRestPath(text) {
  const m = text.match(/\/rest\/v1\/(rpc\/)?([^?\s"'`]*)(\?[^\s"'`]*)?/);
  if (!m) return null;
  const isRpc = Boolean(m[1]);
  // 名前の無い「/rest/v1/」だけの文字列（前置きの定数・判定の文字列）は読み書きではない
  if (m[2] === "") return null;
  const nameMatch = m[2].match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!nameMatch || m[2].length !== nameMatch[0].length) {
    // 名前が式（${path}）か、途中で切れている
    return { dynamic: true, isRpc };
  }
  const columns = new Set();
  let onConflict = [];
  for (const part of (m[3] ?? "").slice(1).split("&")) {
    if (!part) continue;
    const [key, value = ""] = part.split("=");
    if (!key || key.includes("\u0000")) continue;
    if (key === "select" && !value.includes("\u0000")) {
      parseSelect(decodeURIComponentSafe(value)).columns.forEach((c) =>
        columns.add(c),
      );
    } else if (key === "on_conflict" && !value.includes("\u0000")) {
      onConflict = value.split(",").filter((c) => IDENT.test(c));
    } else if (key === "order" && !value.includes("\u0000")) {
      value
        .split(",")
        .map((c) => c.split(".")[0])
        .filter((c) => IDENT.test(c))
        .forEach((c) => columns.add(c));
    } else if (!REST_RESERVED_PARAMS.has(key) && IDENT.test(key)) {
      columns.add(key);
    }
  }
  return {
    dynamic: false,
    isRpc,
    name: nameMatch[0],
    columns: [...columns],
    onConflict,
  };
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * ファイルの中で1回だけ宣言された `const X = "…"`（`cond ? "a" : "b"` も）の値。
 * `.rpc(rpcName)`・`/rest/v1/rpc/${rpcName}` の名前を引くのに使う
 */
function collectConstStrings(program) {
  const count = new Map();
  const values = new Map();
  walk(program, (node) => {
    if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier")
      return;
    const name = node.id.name;
    count.set(name, (count.get(name) ?? 0) + 1);
    const v = staticStrings(node.init, null);
    if (v) values.set(name, v);
  });
  for (const name of [...values.keys()])
    if (count.get(name) !== 1) values.delete(name);
  return values;
}

/** 式が取りうる文字列（分からなければ null） */
function staticStrings(node, consts) {
  if (!node) return null;
  const lit = literalString(node);
  if (lit !== null) return [lit];
  if (node.type === "Identifier" && consts?.has(node.name))
    return consts.get(node.name);
  if (node.type === "ConditionalExpression") {
    const a = staticStrings(node.consequent, consts);
    const b = staticStrings(node.alternate, consts);
    return a && b ? [...new Set([...a, ...b])] : null;
  }
  return null;
}

/** 文字列・テンプレートの文面。式は定数で引けたら値に、引けなければ \u0000 に置く（値が複数なら全部の組） */
function templateTexts(node, consts) {
  if (node.type === "StringLiteral") return [node.value];
  if (node.type !== "TemplateLiteral") return [];
  let texts = [""];
  node.quasis.forEach((q, i) => {
    texts = texts.map((t) => t + (q.value.cooked ?? q.value.raw));
    const expr = node.expressions[i];
    if (!expr) return;
    const vals = staticStrings(expr, consts) ?? ["\u0000"];
    texts = texts.flatMap((t) => vals.map((v) => t + v)).slice(0, 8);
  });
  return texts;
}

const REST_METHOD_OP = {
  GET: "select",
  HEAD: "select",
  POST: "insert",
  PATCH: "update",
  PUT: "upsert",
  DELETE: "delete",
};

/**
 * 1つのファイルから、表・RPC への読み書きと、拾えなかった箇所と、相対 import を集める。
 * @param {string} source
 * @param {string} file リポジトリ直下からのパス
 * @param {{ knownTables?: Set<string>, knownFunctions?: Set<string> }} [known] 写しの名前（固定入力のファイルの絞り込みに使う）
 */
export function extractAccesses(source, file, known = {}) {
  const accesses = [];
  const unresolved = [];
  const imports = [];
  const mentions = [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: parserPlugins(file),
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowUndeclaredExports: true,
    });
  } catch (e) {
    return { accesses, unresolved, imports, mentions, parseError: e.message };
  }
  const fixture = isFixtureLike(file);
  const keepTable = (name) => !fixture || known.knownTables?.has(name);
  const keepFn = (name) => !fixture || known.knownFunctions?.has(name);
  const line = (n) => n.loc?.start.line ?? 0;
  const consts = collectConstStrings(ast.program);

  walk(ast.program, (node, parents) => {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      imports.push(node.source.value);
      return;
    }
    if (
      node.type === "ImportExpression" ||
      (isCall(node) && node.callee.type === "Import")
    ) {
      const spec = literalString(node.source ?? node.arguments?.[0]);
      if (spec) imports.push(spec);
      return;
    }
    if (isCall(node)) {
      const callee = node.callee;
      const name = memberName(callee);
      if (name === "from" && node.arguments.length === 1) {
        const obj = callee.object;
        if (obj.type === "Identifier" && NON_DB_FROM_OBJECTS.has(obj.name))
          return;
        if (memberName(obj) === "storage") return; // supabase.storage.from("bucket")
        const chain = chainAfter(node, parents);
        const opLink = chain.find((c) => DB_OPS.has(c.name));
        const tableNames = staticStrings(node.arguments[0], consts);
        if (tableNames === null) {
          if (opLink)
            unresolved.push({
              file,
              line: line(callee.property),
              reason: "表の名前が変数（.from(式)）",
            });
          return;
        }
        for (const table of tableNames) {
          if (!IDENT.test(table)) continue;
          if (!opLink && !known.knownTables?.has(table)) continue; // Supabase と言えない
          if (!keepTable(table)) continue;
          const op = opLink ? opLink.name : "from";
          const columns = new Set();
          const writeColumns = new Set();
          const embeds = [];
          for (const link of chain) {
            if (link.name === "select") {
              const sel = literalString(link.args[0]);
              if (sel === null && link.args.length > 0) columns.add("?");
              else {
                const parsed = parseSelect(sel ?? "*");
                parsed.columns.forEach((c) => columns.add(c));
                embeds.push(...parsed.embeds);
              }
            } else if (COLUMN_FILTERS.has(link.name)) {
              const col = literalString(link.args[0]);
              if (col !== null) {
                const base = col.split("->")[0].trim();
                if (IDENT.test(base)) columns.add(base);
              }
            } else if (link.name === "match") {
              (objectKeys(link.args[0]) ?? []).forEach((k) => columns.add(k));
            } else if (WRITE_OPS.has(link.name) && link.name !== "delete") {
              const keys = objectKeys(link.args[0]);
              if (keys) keys.forEach((k) => writeColumns.add(k));
              else writeColumns.add("?");
              const oc = literalString(
                propertyValue(link.args[1], "onConflict"),
              );
              if (oc)
                oc.split(",")
                  .map((c) => c.trim())
                  .filter((c) => IDENT.test(c))
                  .forEach((c) => columns.add(c));
            }
          }
          const isWrite = WRITE_OPS.has(op);
          accesses.push({
            kind: "table",
            name: table,
            op,
            via: "client",
            file,
            line: line(callee.property),
            // 書き込みの連鎖の select（返り値）・絞り込みの列は「読む」に入れる
            columns: [...columns].sort(),
            writeColumns: isWrite ? [...writeColumns].sort() : [],
          });
          const pushEmbeds = (list) => {
            for (const e of list) {
              if (keepTable(e.name) && (known.knownTables?.has(e.name) ?? true))
                accesses.push({
                  kind: "table",
                  name: e.name,
                  op: "select",
                  via: "embed",
                  file,
                  line: line(callee.property),
                  columns: [...new Set(e.columns)].sort(),
                  writeColumns: [],
                });
              pushEmbeds(e.embeds);
            }
          };
          pushEmbeds(embeds);
        }
        return;
      }
      if (name === "rpc" && node.arguments.length >= 1) {
        const fnNames = staticStrings(node.arguments[0], consts);
        if (fnNames === null) {
          unresolved.push({
            file,
            line: line(callee.property),
            reason: "RPC の名前が変数（.rpc(式)）",
          });
          return;
        }
        for (const fn of fnNames) {
          if (!IDENT.test(fn) || !keepFn(fn)) continue;
          accesses.push({
            kind: "rpc",
            name: fn,
            op: "call",
            via: "client",
            file,
            line: line(callee.property),
            columns: [],
            writeColumns: [],
          });
        }
        return;
      }
    }
    if (node.type === "StringLiteral" || node.type === "TemplateLiteral") {
      const value = literalString(node);
      if (value !== null && !fixture) {
        if (known.knownFunctions?.has(value))
          mentions.push({ kind: "rpc", name: value, file, line: line(node) });
        else if (known.knownTables?.has(value))
          mentions.push({ kind: "table", name: value, file, line: line(node) });
      }
      // テンプレートの中の文字列は TemplateElement（別の型）なので二重には拾わない
      const method = enclosingFetchMethod(node, parents);
      for (const text of templateTexts(node, consts)) {
        // REST の包み（db("rpc/f", …)・db(`表?…`)）に渡す、/rest/v1/ を省いた相対のパス
        const bare = text.match(/^(rpc\/)?([A-Za-z_][A-Za-z0-9_]*)(\?|$)/);
        const bareKnown =
          bare &&
          (bare[1]
            ? known.knownFunctions?.has(bare[2])
            : bare[3] === "?" && known.knownTables?.has(bare[2]));
        if (!text.includes("/rest/v1/") && !bareKnown) continue;
        const rest = parseRestPath(
          text.includes("/rest/v1/") ? text : `/rest/v1/${text}`,
        );
        if (!rest) continue;
        if (rest.dynamic) {
          unresolved.push({
            file,
            line: line(node),
            reason: rest.isRpc
              ? "REST の RPC の名前が式"
              : "REST の表の名前が式（/rest/v1/${…}）",
          });
          continue;
        }
        if (rest.isRpc) {
          if (!keepFn(rest.name)) continue;
          accesses.push({
            kind: "rpc",
            name: rest.name,
            op: "call",
            via: "rest",
            file,
            line: line(node),
            columns: [],
            writeColumns: [],
          });
          continue;
        }
        if (!keepTable(rest.name)) continue;
        const op = method ? (REST_METHOD_OP[method] ?? "rest") : "rest";
        const columns = new Set([...rest.columns, ...rest.onConflict]);
        accesses.push({
          kind: "table",
          name: rest.name,
          op,
          via: "rest",
          file,
          line: line(node),
          columns: [...columns].sort(),
          writeColumns: WRITE_OPS.has(op) && op !== "delete" ? ["?"] : [],
        });
      }
    }
  });
  // 名前の文字列だけがあるもの（`.rpc(fn.name)`・`/rest/v1/rpc/${rpcName}` の先の定数・一覧）。
  // 直接の呼び出しで拾った箇所は除く。表の名前は一般の語と重なるので、名前が式の箇所があるファイルだけ
  const nearDirect = (m) =>
    accesses.some(
      (a) =>
        a.kind === m.kind &&
        a.name === m.name &&
        Math.abs(a.line - m.line) <= 3,
    );
  const seen = new Set();
  const keptMentions = mentions.filter((m) => {
    const key = `${m.kind}:${m.name}:${m.line}`;
    if (nearDirect(m) || seen.has(key)) return false;
    seen.add(key);
    return m.kind === "rpc" || unresolved.length > 0;
  });
  return {
    accesses,
    // 検査の固定入力のファイルの「名前が式」は偽の呼び出しが多いので出さない
    unresolved: fixture ? [] : unresolved,
    imports: [...new Set(imports)].sort(),
    mentions: keptMentions,
  };
}

/** SQL の本文からコメントと文字列の中身を外す（$$ の本体は残す） */
export function stripSqlNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * 関数の定義（CREATE OR REPLACE FUNCTION … 全文）が読む表・書く表・呼ぶ関数を、写しにある名前だけで返す。
 * @param {string} definition
 * @param {Set<string>} relationNames
 * @param {Set<string>} functionNames
 * @param {string} selfName 自分の名前（呼ぶ関数から外す）
 */
export function sqlTableRefs(
  definition,
  relationNames,
  functionNames,
  selfName,
) {
  const sql = stripSqlNoise(definition)
    // 定義の頭（CREATE … FUNCTION name(args) RETURNS …）は本文ではない
    .replace(/^[\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)/i, "$1");
  const reads = new Set();
  const writes = new Set();
  const calls = new Set();
  const name = String.raw`(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
  for (const m of sql.matchAll(
    new RegExp(
      String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+(?:only\s+)?${name}`,
      "gi",
    ),
  )) {
    const t = m[1].toLowerCase();
    if (relationNames.has(t)) writes.add(t);
  }
  for (const m of sql.matchAll(
    new RegExp(
      String.raw`\b(?:from|join|using)\s+(?:only\s+|lateral\s+)?${name}`,
      "gi",
    ),
  )) {
    const t = m[1].toLowerCase();
    // DELETE FROM は書き込みとして上で拾った
    const before = sql.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
    if (/delete\s*$/.test(before)) continue;
    if (relationNames.has(t)) reads.add(t);
  }
  for (const m of sql.matchAll(new RegExp(String.raw`${name}\s*\(`, "g"))) {
    const f = m[1].toLowerCase();
    if (functionNames.has(f) && f !== selfName) calls.add(f);
  }
  return {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    calls: [...calls].sort(),
  };
}

const ANON_ROLES = new Set(["anon", "PUBLIC", "public"]);
const AUTH_ROLES = new Set(["authenticated", "PUBLIC", "public"]);

function hasPrivilege(grants, roles, privilege) {
  return grants.some(
    (g) => roles.has(g.grantee) && g.privileges.includes(privilege),
  );
}

function policyAllows(relation, roles, command) {
  if (!relation.rlsEnabled) return true;
  return relation.policies.some(
    (p) =>
      p.permissive !== false &&
      (p.command === command || p.command === "ALL") &&
      p.roles.some((r) => roles.has(r)),
  );
}

/** 表の権限の要約。service_role は RLS を通らないので、anon・authenticated だけを見る */
export function relationAccess(relation) {
  const out = {};
  for (const [label, roles] of [
    ["anon", ANON_ROLES],
    ["authenticated", AUTH_ROLES],
  ]) {
    out[label] = ["SELECT", "INSERT", "UPDATE", "DELETE"].filter(
      (priv) =>
        hasPrivilege(relation.grants, roles, priv) &&
        policyAllows(relation, roles, priv),
    );
  }
  out.summary = out.anon.includes("SELECT")
    ? "anon 可"
    : out.authenticated.includes("SELECT")
      ? "authenticated 可"
      : "service だけ";
  return out;
}

export function functionAccess(fn) {
  const anon = hasPrivilege(fn.grants, ANON_ROLES, "EXECUTE");
  const authenticated = hasPrivilege(fn.grants, AUTH_ROLES, "EXECUTE");
  return {
    anon,
    authenticated,
    summary: anon
      ? "anon 可"
      : authenticated
        ? "authenticated 可"
        : "service だけ",
  };
}

const ref = (a) => `${a.file}:${a.line}`;
const byRef = (a, b) =>
  a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;
const sortStr = (list) =>
  [...new Set(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * 相対 import を解決する（拡張子・index の補い）。リポジトリ外・パッケージは null
 * @param {string} from
 * @param {string} spec
 * @param {Set<string>} files
 */
export function resolveImport(from, spec, files) {
  if (!spec.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const base = parts.join("/");
  for (const cand of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}/index.js`,
  ]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/**
 * 取得のジョブ（scrape の registry）ごとに、入口の api/cron のファイルと、そこから import でたどれる書き込みを返す。
 * 入口: api/cron/{job の _ を - にした名前}.js。無ければ、ジョブの名前の文字列を持つ api/cron のファイルが1つだけのとき。
 * @param {string[]} jobNames
 * @param {Map<string, { accesses: unknown[], imports: string[], strings?: Set<string> }>} perFile
 */
export function scrapeJobWriters(jobNames, perFile) {
  const files = new Set(perFile.keys());
  const cronFiles = [...files].filter((f) => /^api\/cron\/[^/]+\.js$/.test(f));
  const jobs = [];
  const unresolved = [];
  for (const job of [...jobNames].sort()) {
    const byName = `api/cron/${job.replace(/_/g, "-")}.js`;
    let entry = files.has(byName) ? byName : null;
    if (!entry) {
      const cands = cronFiles.filter((f) => perFile.get(f).strings?.has(job));
      if (cands.length === 1) entry = cands[0];
    }
    if (!entry) {
      unresolved.push({
        job,
        reason: "入口の api/cron のファイルが決まらない",
      });
      continue;
    }
    const seen = new Set([entry]);
    const queue = [entry];
    while (queue.length) {
      const cur = queue.shift();
      for (const spec of perFile.get(cur)?.imports ?? []) {
        const next = resolveImport(cur, spec, files);
        if (next && !seen.has(next) && !isFixtureLike(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const writes = new Map();
    for (const f of seen) {
      for (const a of perFile.get(f)?.accesses ?? []) {
        if (a.kind === "table" && WRITE_OPS.has(a.op)) {
          if (!writes.has(a.name)) writes.set(a.name, []);
          writes.get(a.name).push(ref(a));
        }
      }
    }
    jobs.push({
      job,
      entry,
      reachableFiles: seen.size,
      writes: Object.fromEntries(
        [...writes.keys()].sort().map((t) => [t, sortStr(writes.get(t))]),
      ),
    });
  }
  return { jobs, unresolved };
}

/** 手で足す外の読み手（data-readers.extra.json）の形を確かめる。誤りの文の一覧を返す */
export function validateExtra(extra, snapshot) {
  const errors = [];
  if (!extra || !Array.isArray(extra.readers)) return ["readers が配列でない"];
  const rels = new Map(snapshot.relations.map((r) => [r.name, r]));
  const fns = new Set(snapshot.functions.map((f) => f.name));
  extra.readers.forEach((r, i) => {
    const at = `readers[${i}]`;
    for (const key of [
      "kind",
      "name",
      "reader",
      "repo",
      "access",
      "source",
      "addedAt",
    ]) {
      if (typeof r[key] !== "string" || !r[key])
        errors.push(`${at}.${key} が空`);
    }
    if (!["table", "rpc"].includes(r.kind))
      errors.push(`${at}.kind は table か rpc`);
    if (!["read", "write"].includes(r.access))
      errors.push(`${at}.access は read か write`);
    if (r.kind === "table" && !rels.has(r.name))
      errors.push(`${at}.name の表 ${r.name} が写しに無い`);
    if (r.kind === "rpc" && !fns.has(r.name))
      errors.push(`${at}.name の RPC ${r.name} が写しに無い`);
    if (r.columns !== undefined) {
      if (!Array.isArray(r.columns)) errors.push(`${at}.columns が配列でない`);
      else if (r.kind === "table" && rels.has(r.name)) {
        const cols = new Set(rels.get(r.name).columns.map((c) => c.name));
        r.columns
          .filter((c) => !cols.has(c))
          .forEach((c) =>
            errors.push(`${at}.columns の ${c} が ${r.name} に無い`),
          );
      }
    }
    if (typeof r.addedAt === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt))
      errors.push(`${at}.addedAt は YYYY-MM-DD`);
  });
  return errors;
}

/**
 * 台帳を組み立てる。
 * @param {{ perFile: Map<string, { accesses: Array<Record<string, unknown>>, unresolved: unknown[], imports: string[], parseError?: string }>, snapshot: any, extra: any, scrapeJobNames: string[], uncoveredFiles: string[] }} input
 */
export function buildLedger({
  perFile,
  snapshot,
  extra,
  scrapeJobNames,
  uncoveredFiles,
}) {
  const relationNames = new Set(snapshot.relations.map((r) => r.name));
  const functionNames = new Set(snapshot.functions.map((f) => f.name));
  const all = [...perFile.values()].flatMap((p) => p.accesses).sort(byRef);
  const mentions = [...perFile.values()]
    .flatMap((p) => p.mentions ?? [])
    .sort(byRef);
  const mentionRefs = (kind, name) =>
    mentions.filter((m) => m.kind === kind && m.name === name).map(ref);
  // トリガーの関数（public.f() の f）→ その表
  const triggerTables = new Map();
  for (const rel of snapshot.relations) {
    for (const t of rel.triggers ?? []) {
      const fn = String(t.function)
        .replace(/^public\./, "")
        .replace(/\(.*$/, "");
      if (!triggerTables.has(fn)) triggerTables.set(fn, new Set());
      triggerTables.get(fn).add(rel.name);
    }
  }

  const fnBody = new Map();
  for (const fn of snapshot.functions) {
    const refs = sqlTableRefs(
      fn.definition.join("\n"),
      relationNames,
      functionNames,
      fn.name,
    );
    const prev = fnBody.get(fn.name);
    // 同じ名前の多重定義は合わせる
    fnBody.set(
      fn.name,
      prev
        ? {
            reads: sortStr([...prev.reads, ...refs.reads]),
            writes: sortStr([...prev.writes, ...refs.writes]),
            calls: sortStr([...prev.calls, ...refs.calls]),
          }
        : refs,
    );
  }
  const extraReaders = extra?.readers ?? [];

  // 検査の固定入力のファイル（verify-*.js 等）の箇所には test を付ける。写しにある名前だけを拾っている
  const entry = (a, columns) => ({
    ref: ref(a),
    op: a.op,
    via: a.via,
    columns,
    ...(isFixtureLike(a.file) ? { test: true } : {}),
  });
  const tables = {};
  for (const rel of [...snapshot.relations].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const mine = all.filter((a) => a.kind === "table" && a.name === rel.name);
    const readers = mine.filter((a) => !WRITE_OPS.has(a.op));
    const writers = mine.filter((a) => WRITE_OPS.has(a.op));
    const columns = {};
    const colNames = new Set(rel.columns.map((c) => c.name));
    for (const c of rel.columns) columns[c.name] = { readers: [], writers: [] };
    const unknownColumns = new Set();
    for (const a of mine) {
      for (const c of a.columns) {
        if (c === "*" || c === "?") continue;
        if (colNames.has(c)) columns[c].readers.push(ref(a));
        else unknownColumns.add(c);
      }
      for (const c of a.writeColumns) {
        if (c === "?") continue;
        if (colNames.has(c)) columns[c].writers.push(ref(a));
        else unknownColumns.add(c);
      }
    }
    for (const c of Object.keys(columns)) {
      columns[c].readers = sortStr(columns[c].readers);
      columns[c].writers = sortStr(columns[c].writers);
    }
    const viaRpc = [...fnBody.entries()]
      .filter(([, b]) => b.reads.includes(rel.name))
      .map(([n]) => n)
      .sort();
    const writtenByRpc = [...fnBody.entries()]
      .filter(([, b]) => b.writes.includes(rel.name))
      .map(([n]) => n)
      .sort();
    tables[rel.name] = {
      kind: rel.kind,
      rlsEnabled: rel.rlsEnabled,
      access: relationAccess(rel),
      readers: readers.map((a) => entry(a, a.columns)),
      writers: writers.map((a) => entry(a, a.writeColumns)),
      readByRpc: viaRpc,
      writtenByRpc,
      columns,
      columnsNotInSnapshot: [...unknownColumns].sort(),
      mentions: mentionRefs("table", rel.name),
      external: extraReaders.filter(
        (e) => e.kind === "table" && e.name === rel.name,
      ),
    };
  }

  const rpcs = {};
  const fnByName = new Map();
  for (const fn of snapshot.functions)
    if (!fnByName.has(fn.name)) fnByName.set(fn.name, fn);
  for (const name of [...fnByName.keys()].sort()) {
    const fn = fnByName.get(name);
    const callers = all.filter((a) => a.kind === "rpc" && a.name === name);
    const body = fnBody.get(name);
    rpcs[name] = {
      kind: fn.kind,
      securityDefiner: fn.securityDefiner,
      access: functionAccess(fn),
      callers: callers.map((a) => ({ ref: ref(a), via: a.via })),
      mentions: mentionRefs("rpc", name),
      triggerOn: [...(triggerTables.get(name) ?? [])].sort(),
      calledByRpc: [...fnBody.entries()]
        .filter(([, b]) => b.calls.includes(name))
        .map(([n]) => n)
        .sort(),
      reads: body.reads,
      writes: body.writes,
      calls: body.calls,
      external: extraReaders.filter((e) => e.kind === "rpc" && e.name === name),
    };
  }

  const notInSnapshot = {};
  for (const a of all) {
    const known =
      a.kind === "table"
        ? relationNames.has(a.name)
        : functionNames.has(a.name);
    if (known) continue;
    const key = `${a.kind}:${a.name}`;
    if (!notInSnapshot[key])
      notInSnapshot[key] = { kind: a.kind, name: a.name, refs: [] };
    notInSnapshot[key].refs.push(ref(a));
  }

  const scrape = scrapeJobWriters(scrapeJobNames, perFile);
  for (const j of scrape.jobs) {
    for (const t of Object.keys(j.writes)) {
      if (tables[t]) {
        tables[t].scrapeJobs ??= [];
        tables[t].scrapeJobs.push(j.job);
      }
    }
  }
  for (const t of Object.values(tables)) t.scrapeJobs ??= [];

  const unresolved = [...perFile.values()]
    .flatMap((p) => p.unresolved)
    .sort(byRef);
  const parseErrors = [...perFile.entries()]
    .filter(([, p]) => p.parseError)
    .map(([file, p]) => ({ file, error: p.parseError }));

  return {
    $comment:
      "機械生成（scripts/maintenance/generate-data-readers.js）。手で書き換えない。外の読み手は docs/reference/data-readers.extra.json に足す",
    format: FORMAT,
    snapshotCapturedAt: snapshot.capturedAt,
    counts: {
      tables: Object.keys(tables).length,
      rpcs: Object.keys(rpcs).length,
      sourceFiles: perFile.size,
      filesWithAccess: [...perFile.values()].filter(
        (p) => p.accesses.length > 0,
      ).length,
      tableReaders: all.filter(
        (a) => a.kind === "table" && !WRITE_OPS.has(a.op),
      ).length,
      tableWriters: all.filter((a) => a.kind === "table" && WRITE_OPS.has(a.op))
        .length,
      rpcCallers: all.filter((a) => a.kind === "rpc").length,
      nameMentions: mentions.length,
      tablesWithoutReaders: Object.values(tables).filter(
        (t) =>
          t.readers.length === 0 &&
          t.readByRpc.length === 0 &&
          t.mentions.length === 0 &&
          t.external.length === 0,
      ).length,
      rpcsWithoutCallers: Object.values(rpcs).filter(
        (r) =>
          r.callers.length === 0 &&
          r.calledByRpc.length === 0 &&
          r.mentions.length === 0 &&
          r.triggerOn.length === 0 &&
          r.external.length === 0,
      ).length,
      external: extraReaders.length,
      notInSnapshot: Object.keys(notInSnapshot).length,
      unresolved: unresolved.length,
      parseErrors: parseErrors.length,
      uncoveredFiles: uncoveredFiles.length,
    },
    tables,
    rpcs,
    scrapeJobs: scrape.jobs,
    notInSnapshot: Object.values(notInSnapshot).sort((a, b) =>
      `${a.kind}:${a.name}` < `${b.kind}:${b.name}` ? -1 : 1,
    ),
    unresolved,
    unresolvedJobs: scrape.unresolved,
    parseErrors,
    uncoveredFiles: sortStr(uncoveredFiles),
  };
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function shortList(list, max = 6) {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} ほか${list.length - max}`;
}

function rpcCallerText(r) {
  const parts = [];
  if (r.callers.length)
    parts.push(
      shortList(
        r.callers.map((x) => x.ref),
        4,
      ),
    );
  if (r.mentions.length)
    parts.push(`名前の文字列: ${shortList(r.mentions, 3)}`);
  if (r.calledByRpc.length) parts.push(`RPC から: ${r.calledByRpc.join(", ")}`);
  if (r.triggerOn.length) parts.push(`トリガー: ${r.triggerOn.join(", ")}`);
  return parts.join(" / ") || "なし";
}

/** 台帳の Markdown。JSON と同じ中身を、人と AI が先に読む形にする */
export function renderMarkdown(ledger) {
  const L = [];
  const c = ledger.counts;
  L.push("# データの読み手の台帳");
  L.push("");
  L.push(
    "> 機械生成（`node scripts/maintenance/generate-data-readers.js`）。手で書き換えない。表・列・RPC を変える・消す前に、ここで読み手と書き手を確かめる。機械で拾えない repo の外の読み手（hq 等）は `docs/reference/data-readers.extra.json` に手で足す。",
  );
  L.push(">");
  L.push(
    `> 入力: \`src/\`・\`api/\`・\`scripts/\`・\`sns-video-studio/\` の JS/TS（構文木で \`.from()\`・\`.select()\`・\`.rpc()\` 等と \`/rest/v1/\` を拾う）と、本番スキーマの写し（\`docs/reference/schema-snapshot.json\`、取得 ${ledger.snapshotCapturedAt}）。権限・RPC の本体はこの写しの時点のもの。`,
  );
  L.push("");
  L.push("## 件数");
  L.push("");
  L.push("| 項目 | 件数 |");
  L.push("|---|---|");
  const labels = {
    tables: "表・ビュー（写し）",
    rpcs: "RPC（写しの関数）",
    sourceFiles: "読んだファイル",
    filesWithAccess: "読み書きのあるファイル",
    tableReaders: "表の読み手（箇所）",
    tableWriters: "表の書き手（箇所）",
    rpcCallers: "RPC の呼び手（箇所）",
    nameMentions: "名前の文字列だけの箇所（呼ぶ経路は式）",
    tablesWithoutReaders:
      "読み手の見つからない表（RPC 経由・名前の文字列・外も無し）",
    rpcsWithoutCallers:
      "呼び手の見つからない RPC（RPC 経由・名前の文字列・トリガー・外も無し）",
    external: "外の読み手（手で足した行）",
    notInSnapshot: "コードが使うのに写しに無い名前",
    unresolved: "名前が式で拾えなかった箇所",
    parseErrors: "構文木にできなかったファイル",
    uncoveredFiles: "対象外の言語のファイル（Python 等）",
  };
  for (const [k, v] of Object.entries(c))
    L.push(`| ${labels[k] ?? k} | ${v} |`);
  L.push("");
  L.push("## 表");
  L.push("");
  L.push(
    "読み手・書き手は箇所の数。権限の「anon 可」は anon に SELECT の GRANT があり、RLS が無いか anon・PUBLIC 向けの SELECT のポリシーがあるもの。service_role は RLS を通らないので「service だけ」でも service のキーからは読める。",
  );
  L.push("");
  L.push(
    "| 表 | 種類 | 権限 | 読み手 | 書き手 | 本体で読む RPC | 本体で書く RPC | 取得のジョブ | 外の読み手 |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const [name, t] of Object.entries(ledger.tables)) {
    L.push(
      `| [${name}](#t-${name}) | ${t.kind} | ${t.access.summary} | ${t.readers.length} | ${t.writers.length} | ${cell(shortList(t.readByRpc, 3))} | ${cell(shortList(t.writtenByRpc, 3))} | ${cell(shortList(t.scrapeJobs, 3))} | ${t.external.map((e) => cell(`${e.repo}:${e.reader}`)).join(", ")} |`,
    );
  }
  L.push("");
  L.push("## RPC");
  L.push("");
  L.push(
    "| RPC | 権限 | definer | 呼び手 | 呼ぶ RPC | 本体が読む表 | 本体が書く表 | 外の読み手 |",
  );
  L.push("|---|---|---|---|---|---|---|---|");
  for (const [name, r] of Object.entries(ledger.rpcs)) {
    L.push(
      `| ${name} | ${r.access.summary} | ${r.securityDefiner ? "yes" : ""} | ${cell(rpcCallerText(r))} | ${cell(r.calls.join(", "))} | ${cell(r.reads.join(", "))} | ${cell(r.writes.join(", "))} | ${r.external.map((e) => cell(`${e.repo}:${e.reader}`)).join(", ")} |`,
    );
  }
  L.push("");
  L.push("## 取得のジョブ（scrape の registry）");
  L.push("");
  L.push(
    "入口の `api/cron` のファイルから相対 import でたどれるファイルの書き込み。共有の部品を通るので、別のジョブの書き込みも入る（多めに出る）。",
  );
  L.push("");
  L.push("| ジョブ | 入口 | たどったファイル | 書く表 |");
  L.push("|---|---|---|---|");
  for (const j of ledger.scrapeJobs) {
    L.push(
      `| ${j.job} | ${j.entry} | ${j.reachableFiles} | ${cell(Object.keys(j.writes).join(", "))} |`,
    );
  }
  for (const u of ledger.unresolvedJobs)
    L.push(`| ${u.job} | （${u.reason}） | | |`);
  L.push("");
  L.push("## 表ごとの読み手・書き手");
  L.push("");
  for (const [name, t] of Object.entries(ledger.tables)) {
    L.push(`### <a id="t-${name}"></a>${name}`);
    L.push("");
    L.push(
      `- 権限: ${t.access.summary}（anon: ${t.access.anon.join("・") || "なし"} / authenticated: ${t.access.authenticated.join("・") || "なし"}、RLS ${t.rlsEnabled ? "有効" : "無効"}）`,
    );
    if (t.readByRpc.length)
      L.push(`- 本体で読む RPC: ${t.readByRpc.join(", ")}`);
    if (t.writtenByRpc.length)
      L.push(`- 本体で書く RPC: ${t.writtenByRpc.join(", ")}`);
    if (t.scrapeJobs.length)
      L.push(`- 取得のジョブ: ${t.scrapeJobs.join(", ")}`);
    for (const e of t.external)
      L.push(
        `- 外の読み手: ${e.repo} \`${e.reader}\`（${e.access}${e.columns ? `、列 ${e.columns.join(", ")}` : ""}）${e.detail ? ` ${e.detail}` : ""}（${e.source}、${e.addedAt}）`,
      );
    if (t.columnsNotInSnapshot.length)
      L.push(
        `- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: ${t.columnsNotInSnapshot.join(", ")}`,
      );
    const fmt = (a) =>
      `\`${a.ref}\` ${a.op}${a.via !== "client" ? `(${a.via})` : ""}${a.columns.length ? ` [${a.columns.join(", ")}]` : ""}${a.test ? " （検査）" : ""}`;
    if (t.mentions.length)
      L.push(
        `- 名前の文字列（\`.from(式)\` 等の先で読む・書く見込み）: ${t.mentions.map((m) => `\`${m}\``).join(", ")}`,
      );
    L.push(
      `- 読み手（${t.readers.length}）: ${t.readers.length ? "" : "なし"}`,
    );
    for (const a of t.readers) L.push(`  - ${fmt(a)}`);
    L.push(
      `- 書き手（${t.writers.length}）: ${t.writers.length ? "" : "なし"}`,
    );
    for (const a of t.writers) L.push(`  - ${fmt(a)}`);
    const unread = Object.entries(t.columns)
      .filter(([, v]) => v.readers.length === 0)
      .map(([k]) => k);
    if (
      t.readers.some(
        (a) =>
          a.columns.includes("*") ||
          a.columns.includes("?") ||
          a.columns.length === 0,
      )
    ) {
      L.push(
        '- 列: `select("*")` か列の分からない読み手があるので、名指しの無い列も読まれうる',
      );
    } else if (unread.length) {
      L.push(`- 名指しで読まれていない列: ${unread.join(", ")}`);
    }
    L.push("");
  }
  L.push("## コードが使うのに写しに無い名前");
  L.push("");
  L.push(
    "写しの取得より後のマイグレーションで足したもの、消したもの、別のスキーマ、誤りのどれか。",
  );
  L.push("");
  if (!ledger.notInSnapshot.length) L.push("なし");
  for (const n of ledger.notInSnapshot)
    L.push(
      `- ${n.kind} \`${n.name}\`: ${shortList(
        n.refs.map((r) => `\`${r}\``),
        5,
      )}`,
    );
  L.push("");
  L.push("## 拾えなかったもの");
  L.push("");
  L.push(
    `- 名前が式（変数・テンプレートの式）の箇所: ${ledger.unresolved.length}`,
  );
  for (const u of ledger.unresolved)
    L.push(`  - \`${u.file}:${u.line}\` ${u.reason}`);
  L.push(`- 構文木にできなかったファイル: ${ledger.parseErrors.length}`);
  for (const p of ledger.parseErrors)
    L.push(`  - \`${p.file}\` ${cell(p.error)}`);
  L.push(
    `- 対象外の言語で DB を読み書きしうるファイル（Python。拾っていない）: ${ledger.uncoveredFiles.length}`,
  );
  for (const f of ledger.uncoveredFiles) L.push(`  - \`${f}\``);
  L.push(
    "- repo の外（hq の `platform/*.py`・cron-job.org 等）: 機械では拾えない。`docs/reference/data-readers.extra.json` に手で足す",
  );
  L.push(
    '- 読み手の変数に入れてから後で足した連鎖（`let q = …from("t"); q = q.eq("c", …)`）の列、`.select()` の文字列が式の列',
  );
  L.push("");
  return L.join("\n");
}
