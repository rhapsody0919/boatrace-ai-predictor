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
    // 台帳を作るスクリプト自身（判定の文字列に "/rest/v1/" を持つ）
    file === "scripts/lib/dataReaders.js" ||
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

/** REST の1つの絞り込み（select・on_conflict・order・列の絞り込み）を acc に足す。値が式（\u0000）なら足さない */
function applyRestParam(acc, key, value) {
  const fixed = !value.includes("\u0000");
  if (key === "select" && fixed) {
    const parsed = parseSelect(decodeURIComponentSafe(value));
    parsed.columns.forEach((c) => acc.columns.add(c));
    acc.embeds.push(...parsed.embeds);
  } else if (key === "on_conflict" && fixed) {
    acc.onConflict = value.split(",").filter((c) => IDENT.test(c));
  } else if (key === "order" && fixed) {
    value
      .split(",")
      .map((c) => c.split(".")[0])
      .filter((c) => IDENT.test(c))
      .forEach((c) => acc.columns.add(c));
  } else if (!REST_RESERVED_PARAMS.has(key) && IDENT.test(key)) {
    acc.columns.add(key);
  }
}

/** `?select=…&order=…&列=…` の絞り込みから、触る列・埋め込み・衝突の列を読む */
function parseRestQuery(query) {
  const acc = { columns: new Set(), embeds: [], onConflict: [] };
  for (const part of query.slice(1).split("&")) {
    if (!part) continue;
    const [key, value = ""] = part.split("=");
    if (!key || key.includes("\u0000")) continue;
    applyRestParam(acc, key, value);
  }
  return acc;
}

/** `/rest/v1/…` の文字列（テンプレートは式を `\u0000` に置いた形）から表・RPC と列を読む */
export function parseRestPath(text) {
  const m = text.match(/\/rest\/v1\/(rpc\/)?([^?\s"'`]*)(\?[^\s"'`]*)?/);
  if (!m) return null;
  const isRpc = Boolean(m[1]);
  // 名前の無い「/rest/v1/」だけの文字列（前置きの定数・判定の文字列）は読み書きではない
  if (m[2] === "") return null;
  // 名前が式（${path}）。式でもなく名前でもない（`/rest/v1/*` 等の文）は読み書きではない
  if (m[2].startsWith("\u0000")) return { dynamic: true, isRpc };
  const nameMatch = m[2].match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!nameMatch) return null;
  if (m[2].length !== nameMatch[0].length) return { dynamic: true, isRpc };
  const { columns, embeds, onConflict } = parseRestQuery(m[3] ?? "");
  return {
    dynamic: false,
    isRpc,
    name: nameMatch[0],
    columns: [...columns],
    onConflict,
    embeds,
  };
}

/**
 * 関数の中で REST の select に渡す文字列（`params.set("select", "…")`・`{ select: "…" }`）。
 * URL を URLSearchParams で組む書き方の select（埋め込みの表を含む）を拾う
 */
function selectLiteralsIn(fnNode, consts) {
  const out = [];
  if (!fnNode) return out;
  walk(fnNode, (node) => {
    if (
      isCall(node) &&
      ["set", "append"].includes(memberName(node.callee)) &&
      literalString(node.arguments[0]) === "select"
    ) {
      const v = staticStrings(node.arguments[1], consts);
      if (v) out.push(...v);
    }
    if (
      node.type === "ObjectProperty" &&
      !node.computed &&
      ((node.key.type === "Identifier" && node.key.name === "select") ||
        (node.key.type === "StringLiteral" && node.key.value === "select"))
    ) {
      const v = staticStrings(node.value, consts);
      if (v) out.push(...v);
    }
  });
  return out;
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

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** いちばん内側の関数の名前と引数の名前（名前の付かない関数は name が null） */
function enclosingFunction(node, parents) {
  let cur = parents.get(node);
  while (cur && !FUNCTION_TYPES.has(cur.type)) cur = parents.get(cur);
  if (!cur) return null;
  const params = cur.params.map((p) =>
    p.type === "Identifier"
      ? p.name
      : p.type === "AssignmentPattern" && p.left.type === "Identifier"
        ? p.left.name
        : null,
  );
  let name = cur.id?.name ?? null;
  const parent = parents.get(cur);
  if (
    !name &&
    parent?.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
  )
    name = parent.id.name;
  return { name, params, node: cur };
}

/** 名前が引数（部品の中）なら部品として記録して true */
function noteHelper(ctx, argNode, parents, at, kind, op) {
  if (argNode?.type !== "Identifier") return false;
  // 内側の無名の関数（chunks.map((c) => client.from(table)…)）を越えて、名前を引数に持つ関数まで上がる
  let fn = enclosingFunction(at, parents);
  while (fn && !fn.params.includes(argNode.name))
    fn = enclosingFunction(fn.node, parents);
  if (!fn?.name) return false;
  ctx.helperDefs.push({
    fn: fn.name,
    paramIndex: fn.params.indexOf(argNode.name),
    kind,
    op,
  });
  return true;
}

/** `${x}` の式に使う識別子の名前（const の値は、宣言の行ではなく使う行で数える） */
function collectTemplateIdents(program) {
  const templateIdents = new Set();
  walk(program, (node) => {
    if (node.type === "TemplateLiteral")
      node.expressions.forEach((e) => {
        if (e.type === "Identifier") templateIdents.add(e.name);
      });
  });
  return templateIdents;
}

/** import・export … from の相対パスと、名前つき import の対応を記録する。拾ったら true */
function noteStaticImport(ctx, node) {
  if (
    !(
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) ||
    !node.source
  )
    return false;
  ctx.imports.push(node.source.value);
  if (node.type === "ImportDeclaration")
    for (const sp of node.specifiers) {
      if (sp.type === "ImportSpecifier")
        ctx.importBindings[sp.local.name] = {
          source: node.source.value,
          imported:
            sp.imported.type === "Identifier"
              ? sp.imported.name
              : sp.imported.value,
        };
    }
  return true;
}

/** `import("…")` の相対パスを記録する。拾ったら true */
function noteDynamicImport(ctx, node) {
  if (!(
    node.type === "ImportExpression" ||
    (isCall(node) && node.callee.type === "Import")
  ))
    return false;
  const spec = literalString(node.source ?? node.arguments?.[0]);
  if (spec) ctx.imports.push(spec);
  return true;
}

/** 識別子の関数の呼び出しで、引数が文字列の定数か、囲む関数の引数なら記録する（部品の呼び出しの解決用） */
function noteCallSite(ctx, node, parents) {
  const fn = enclosingFunction(node, parents);
  const args = node.arguments.map((a) => {
    const lits = staticStrings(a, ctx.consts);
    const param =
      a.type === "Identifier" && fn ? fn.params.indexOf(a.name) : -1;
    return { lits, param: param >= 0 ? param : null };
  });
  if (args.some((a) => a.lits || a.param !== null))
    ctx.callSites.push({
      callee: node.callee.name,
      line: ctx.line(node),
      encl: fn?.name ?? null,
      args,
    });
}

/** `.from(…)` の後ろの連鎖の1つ（select・絞り込み・match・書き込み）の列を acc に足す */
function applySelectLink(acc, link) {
  const sel = literalString(link.args[0]);
  if (sel === null && link.args.length > 0) {
    acc.columns.add("?");
    return;
  }
  const parsed = parseSelect(sel ?? "*");
  parsed.columns.forEach((c) => acc.columns.add(c));
  acc.embeds.push(...parsed.embeds);
}

function applyFilterLink(acc, link) {
  const col = literalString(link.args[0]);
  if (col === null) return;
  const base = col.split("->")[0].trim();
  if (IDENT.test(base)) acc.columns.add(base);
}

function applyWriteLink(acc, link) {
  const keys = objectKeys(link.args[0]);
  if (keys) keys.forEach((k) => acc.writeColumns.add(k));
  else acc.writeColumns.add("?");
  const oc = literalString(propertyValue(link.args[1], "onConflict"));
  if (oc)
    oc.split(",")
      .map((c) => c.trim())
      .filter((c) => IDENT.test(c))
      .forEach((c) => acc.columns.add(c));
}

function applyChainLink(acc, link) {
  if (link.name === "select") applySelectLink(acc, link);
  else if (COLUMN_FILTERS.has(link.name)) applyFilterLink(acc, link);
  else if (link.name === "match")
    (objectKeys(link.args[0]) ?? []).forEach((k) => acc.columns.add(k));
  else if (WRITE_OPS.has(link.name) && link.name !== "delete")
    applyWriteLink(acc, link);
}

function chainColumns(chain) {
  const acc = { columns: new Set(), writeColumns: new Set(), embeds: [] };
  for (const link of chain) applyChainLink(acc, link);
  return acc;
}

/** 埋め込み（別の表）の読みを、入れ子の分まで記録する。accept は写しにある名前かの判定 */
function pushEmbedAccesses(ctx, list, line, accept) {
  for (const e of list) {
    if (accept(e.name))
      ctx.accesses.push({
        kind: "table",
        name: e.name,
        op: "select",
        via: "embed",
        file: ctx.file,
        line,
        columns: [...new Set(e.columns)].sort(),
        writeColumns: [],
      });
    pushEmbedAccesses(ctx, e.embeds, line, accept);
  }
}

const clientEmbedKnown = (ctx, name) =>
  ctx.keepTable(name) && (ctx.known.knownTables?.has(name) ?? true);
const restEmbedKnown = (ctx, name) =>
  ctx.known.knownTables?.has(name) && ctx.keepTable(name);

/** `.from("表")` 1つ分の読み書きと、埋め込みの読みを記録する */
function pushClientTable(ctx, table, chain, opLink, callee) {
  if (!IDENT.test(table)) return;
  if (!opLink && !ctx.known.knownTables?.has(table)) return; // Supabase と言えない
  if (!ctx.keepTable(table)) return;
  const op = opLink ? opLink.name : "from";
  const { columns, writeColumns, embeds } = chainColumns(chain);
  const isWrite = WRITE_OPS.has(op);
  const line = ctx.line(callee.property);
  ctx.accesses.push({
    kind: "table",
    name: table,
    op,
    via: "client",
    file: ctx.file,
    line,
    // 書き込みの連鎖の select（返り値）・絞り込みの列は「読む」に入れる
    columns: [...columns].sort(),
    writeColumns: isWrite ? [...writeColumns].sort() : [],
  });
  pushEmbedAccesses(ctx, embeds, line, (n) => clientEmbedKnown(ctx, n));
}

function visitFromCall(ctx, node, parents) {
  const callee = node.callee;
  const obj = callee.object;
  if (obj.type === "Identifier" && NON_DB_FROM_OBJECTS.has(obj.name)) return;
  if (memberName(obj) === "storage") return; // supabase.storage.from("bucket")
  const chain = chainAfter(node, parents);
  const opLink = chain.find((c) => DB_OPS.has(c.name));
  const tableNames = staticStrings(node.arguments[0], ctx.consts);
  if (tableNames === null) {
    if (
      opLink &&
      !noteHelper(ctx, node.arguments[0], parents, node, "table", opLink.name)
    )
      ctx.unresolved.push({
        file: ctx.file,
        line: ctx.line(callee.property),
        reason: "表の名前が変数（.from(式)）",
      });
    return;
  }
  for (const table of tableNames)
    pushClientTable(ctx, table, chain, opLink, callee);
}

function visitRpcCall(ctx, node, parents) {
  const callee = node.callee;
  const fnNames = staticStrings(node.arguments[0], ctx.consts);
  if (fnNames === null) {
    if (!noteHelper(ctx, node.arguments[0], parents, node, "rpc", "call"))
      ctx.unresolved.push({
        file: ctx.file,
        line: ctx.line(callee.property),
        reason: "RPC の名前が変数（.rpc(式)）",
      });
    return;
  }
  for (const fn of fnNames) {
    if (!IDENT.test(fn) || !ctx.keepFn(fn)) continue;
    ctx.accesses.push({
      kind: "rpc",
      name: fn,
      op: "call",
      via: "client",
      file: ctx.file,
      line: ctx.line(callee.property),
      columns: [],
      writeColumns: [],
    });
  }
}

function visitCall(ctx, node, parents) {
  const callee = node.callee;
  if (callee.type === "Identifier" && node.arguments.length > 0)
    noteCallSite(ctx, node, parents);
  const name = memberName(callee);
  if (name === "from" && node.arguments.length === 1)
    visitFromCall(ctx, node, parents);
  else if (name === "rpc" && node.arguments.length >= 1)
    visitRpcCall(ctx, node, parents);
}

/** 写しにある表・RPC の名前だけの文字列を mentions に記録する（固定入力のファイルは除く） */
function noteMention(ctx, node, value) {
  if (ctx.known.knownFunctions?.has(value))
    ctx.mentions.push({
      kind: "rpc",
      name: value,
      file: ctx.file,
      line: ctx.line(node),
    });
  else if (ctx.known.knownTables?.has(value))
    ctx.mentions.push({
      kind: "table",
      name: value,
      file: ctx.file,
      line: ctx.line(node),
    });
}

/** `const base = "/rest/v1/…"` のように、`${base}` で使う所で数える定数の宣言（ここでは数えない） */
function isTemplateOnlyConstDecl(ctx, node, decl) {
  return (
    decl?.type === "VariableDeclarator" &&
    decl.init === node &&
    decl.id.type === "Identifier" &&
    ctx.consts.has(decl.id.name) &&
    ctx.templateIdents.has(decl.id.name)
  );
}

/** REST の包みの中（`/rest/v1/${path}` の path が引数）か */
function hasWrapperParam(node, fnCtx) {
  return (
    node.type === "TemplateLiteral" &&
    node.expressions.some(
      (e) =>
        e.type === "Identifier" && fnCtx?.name && fnCtx.params.includes(e.name),
    )
  );
}

/** REST の包み（db("rpc/f", …)・db(`表?…`)）に渡す、/rest/v1/ を省いた相対のパスが写しにある名前か */
function isKnownBarePath(text, known) {
  const bare = text.match(/^(rpc\/)?([A-Za-z_][A-Za-z0-9_]*)(\?|$)/);
  return (
    bare &&
    (bare[1]
      ? known.knownFunctions?.has(bare[2])
      : bare[3] === "?" && known.knownTables?.has(bare[2]))
  );
}

/** REST の表（`/rest/v1/表?…`）の読み書きと、埋め込みの読みを記録する */
function pushRestTable(ctx, node, rest, method, fnCtx) {
  let op = method ? (REST_METHOD_OP[method] ?? "rest") : "rest";
  if (op === "insert" && rest.onConflict.length) op = "upsert";
  const columns = new Set([...rest.columns, ...rest.onConflict]);
  const embeds = [...rest.embeds];
  if (op === "select" || op === "rest") {
    for (const sel of selectLiteralsIn(fnCtx?.node, ctx.consts)) {
      const parsed = parseSelect(sel);
      parsed.columns.forEach((c) => columns.add(c));
      embeds.push(...parsed.embeds);
    }
  }
  pushEmbedAccesses(ctx, embeds, ctx.line(node), (n) => restEmbedKnown(ctx, n));
  ctx.accesses.push({
    kind: "table",
    name: rest.name,
    op,
    via: "rest",
    file: ctx.file,
    line: ctx.line(node),
    columns: [...columns].sort(),
    writeColumns: WRITE_OPS.has(op) && op !== "delete" ? ["?"] : [],
  });
}

/** 文字列の文面 1つ分の REST の読み書き（`/rest/v1/…`・REST の包みの相対のパス）を記録する */
function pushRestAccess(ctx, node, text, { method, fnCtx, wrapperParam }) {
  if (!text.includes("/rest/v1/") && !isKnownBarePath(text, ctx.known)) return;
  const rest = parseRestPath(
    text.includes("/rest/v1/") ? text : `/rest/v1/${text}`,
  );
  if (!rest) return;
  if (rest.dynamic) {
    if (wrapperParam) return;
    ctx.unresolved.push({
      file: ctx.file,
      line: ctx.line(node),
      reason: rest.isRpc
        ? "REST の RPC の名前が式"
        : "REST の表の名前が式（/rest/v1/${…}）",
    });
    return;
  }
  if (rest.isRpc) {
    if (!ctx.keepFn(rest.name)) return;
    ctx.accesses.push({
      kind: "rpc",
      name: rest.name,
      op: "call",
      via: "rest",
      file: ctx.file,
      line: ctx.line(node),
      columns: [],
      writeColumns: [],
    });
    return;
  }
  if (!ctx.keepTable(rest.name)) return;
  pushRestTable(ctx, node, rest, method, fnCtx);
}

function visitString(ctx, node, parents) {
  const value = literalString(node);
  if (value !== null && !ctx.fixture) noteMention(ctx, node, value);
  // テンプレートの中の文字列は TemplateElement（別の型）なので二重には拾わない
  if (isTemplateOnlyConstDecl(ctx, node, parents.get(node))) return; // `${base}` で使う所で数える
  const method = enclosingFetchMethod(node, parents);
  const fnCtx = enclosingFunction(node, parents);
  // 呼び手が渡す相対のパスで拾う
  const wrapperParam = hasWrapperParam(node, fnCtx);
  for (const text of templateTexts(node, ctx.consts))
    pushRestAccess(ctx, node, text, { method, fnCtx, wrapperParam });
}

function visitNode(ctx, node, parents) {
  if (noteStaticImport(ctx, node) || noteDynamicImport(ctx, node)) return;
  if (isCall(node)) visitCall(ctx, node, parents);
  else if (node.type === "StringLiteral" || node.type === "TemplateLiteral")
    visitString(ctx, node, parents);
}

/**
 * 名前の文字列だけがあるもの（`.rpc(fn.name)`・`/rest/v1/rpc/${rpcName}` の先の定数・一覧）。
 * 直接の呼び出しで拾った箇所は除く。表の名前は一般の語と重なるので、名前が式の箇所があるファイルだけ
 */
function keepMentions(accesses, mentions, unresolved) {
  const nearDirect = (m) =>
    accesses.some(
      (a) =>
        a.kind === m.kind &&
        a.name === m.name &&
        Math.abs(a.line - m.line) <= 3,
    );
  const seen = new Set();
  return mentions.filter((m) => {
    const key = `${m.kind}:${m.name}:${m.line}`;
    if (nearDirect(m) || seen.has(key)) return false;
    seen.add(key);
    return m.kind === "rpc" || unresolved.length > 0;
  });
}

function parseSource(source, file) {
  return parse(source, {
    sourceType: "unambiguous",
    plugins: parserPlugins(file),
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowUndeclaredExports: true,
  });
}

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
  // 表・RPC の名前を引数で受け取る部品（upsertChangedRows(client, table, …) 等）と、関数の呼び出し
  const helperDefs = [];
  const callSites = [];
  const importBindings = {};
  let ast;
  try {
    ast = parseSource(source, file);
  } catch (e) {
    return {
      accesses,
      unresolved,
      imports,
      mentions,
      helperDefs,
      callSites,
      importBindings,
      parseError: e.message,
    };
  }
  const fixture = isFixtureLike(file);
  const ctx = {
    file,
    known,
    fixture,
    accesses,
    unresolved,
    imports,
    mentions,
    helperDefs,
    callSites,
    importBindings,
    keepTable: (name) => !fixture || known.knownTables?.has(name),
    keepFn: (name) => !fixture || known.knownFunctions?.has(name),
    line: (n) => n.loc?.start.line ?? 0,
    consts: collectConstStrings(ast.program),
    templateIdents: collectTemplateIdents(ast.program),
  };
  walk(ast.program, (node, parents) => visitNode(ctx, node, parents));
  return {
    accesses,
    // 検査の固定入力のファイルの「名前が式」は偽の呼び出しが多いので出さない
    unresolved: fixture ? [] : unresolved,
    imports: [...new Set(imports)].sort(),
    mentions: keepMentions(accesses, mentions, unresolved),
    helperDefs,
    callSites: fixture ? [] : callSites,
    importBindings,
  };
}

/**
 * 構文木で読まない言語（Python）のファイルの、写しにある名前の文字列（`"表?select=…"`・`"rpc/関数"`・`"表"`）。
 * 読み書きの別は分からないので「名前の文字列」として出す
 * @returns {Array<{ kind: "table" | "rpc", name: string, file: string, line: number }>}
 */
export function pythonMentions(source, file, known) {
  const out = [];
  source.split("\n").forEach((text, i) => {
    if (/^\s*#/.test(text)) return;
    for (const m of text.matchAll(
      /["'](?:\/rest\/v1\/)?(rpc\/)?([A-Za-z_][A-Za-z0-9_]*)(?:\?[^"']*)?["']/g,
    )) {
      const kind = m[1]
        ? "rpc"
        : known.knownTables.has(m[2])
          ? "table"
          : known.knownFunctions.has(m[2])
            ? "rpc"
            : null;
      if (!kind) continue;
      if (kind === "rpc" && !known.knownFunctions.has(m[2])) continue;
      out.push({ kind, name: m[2], file, line: i + 1 });
    }
  });
  return out;
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

/** ジョブの入口の api/cron のファイル。名前で決まらなければ、ジョブの名前の文字列を持つファイルが1つだけのとき。決まらなければ null */
function findJobEntry(job, files, cronFiles, perFile) {
  const byName = `api/cron/${job.replace(/_/g, "-")}.js`;
  if (files.has(byName)) return byName;
  const cands = cronFiles.filter((f) => perFile.get(f).strings?.has(job));
  return cands.length === 1 ? cands[0] : null;
}

/** 入口から相対 import でたどれるファイル（入口を含む。固定入力のファイルは辿らない） */
function reachableFiles(entry, perFile, files) {
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
  return seen;
}

/** たどったファイルの表への書き込み（表の名前 → 箇所の一覧） */
function jobWrites(seen, perFile, extraAccesses) {
  const writes = new Map();
  for (const f of seen) {
    for (const a of [
      ...(perFile.get(f)?.accesses ?? []),
      ...extraAccesses.filter((x) => x.file === f),
    ]) {
      if (a.kind === "table" && WRITE_OPS.has(a.op)) {
        if (!writes.has(a.name)) writes.set(a.name, []);
        writes.get(a.name).push(ref(a));
      }
    }
  }
  return writes;
}

/**
 * 取得のジョブ（scrape の registry）ごとに、入口の api/cron のファイルと、そこから import でたどれる書き込みを返す。
 * 入口: api/cron/{job の _ を - にした名前}.js。無ければ、ジョブの名前の文字列を持つ api/cron のファイルが1つだけのとき。
 * @param {string[]} jobNames
 * @param {Map<string, { accesses: unknown[], imports: string[], strings?: Set<string> }>} perFile
 */
export function scrapeJobWriters(jobNames, perFile, extraAccesses = []) {
  const files = new Set(perFile.keys());
  const cronFiles = [...files].filter((f) => /^api\/cron\/[^/]+\.js$/.test(f));
  const jobs = [];
  const unresolved = [];
  for (const job of [...jobNames].sort()) {
    const entry = findJobEntry(job, files, cronFiles, perFile);
    if (!entry) {
      unresolved.push({
        job,
        reason: "入口の api/cron のファイルが決まらない",
      });
      continue;
    }
    const seen = reachableFiles(entry, perFile, files);
    const writes = jobWrites(seen, perFile, extraAccesses);
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

/** 部品の表。`${file}#${fn}` → Map<`${paramIndex}:${kind}:${op}`, def>。足せたら true（既にあれば false） */
function createHelperTable(perFile) {
  const helpers = new Map();
  const addHelper = (key, def) => {
    if (!helpers.has(key)) helpers.set(key, new Map());
    const k = `${def.paramIndex}:${def.kind}:${def.op}`;
    if (helpers.get(key).has(k)) return false;
    helpers.get(key).set(k, def);
    return true;
  };
  for (const [file, p] of perFile)
    for (const d of p.helperDefs ?? []) addHelper(`${file}#${d.fn}`, d);
  return { helpers, addHelper };
}

/** 呼ぶ関数の部品の表の鍵。同じファイルの関数か、相対 import の名前つき import で解決する */
function createCalleeKey(perFile, files, helpers) {
  return (file, name) => {
    const local = `${file}#${name}`;
    if (helpers.has(local)) return local;
    const bindings = perFile.get(file)?.importBindings ?? {};
    if (!Object.hasOwn(bindings, name)) return null;
    const b = bindings[name];
    const target = resolveImport(file, b.source, files);
    return target ? `${target}#${b.imported}` : null;
  };
}

/** 1つの呼び出しが部品の引数をそのまま渡すなら、呼んでいる関数も部品として足す。足せたら true */
function propagateCall(file, c, { helpers, addHelper }, calleeKey) {
  if (!c.encl) return false;
  const key = calleeKey(file, c.callee);
  if (!key) return false;
  let changed = false;
  for (const d of helpers.get(key)?.values() ?? []) {
    const param = c.args[d.paramIndex]?.param;
    if (param !== null && param !== undefined)
      changed =
        addHelper(`${file}#${c.encl}`, {
          ...d,
          fn: c.encl,
          paramIndex: param,
        }) || changed;
  }
  return changed;
}

/** 包む部品（引数をそのまま渡す関数）を不動点までたどる */
function propagateWrappers(perFile, table, calleeKey) {
  for (let changed = true, round = 0; changed && round < 10; round += 1) {
    changed = false;
    for (const [file, p] of perFile)
      for (const c of p.callSites ?? [])
        changed = propagateCall(file, c, table, calleeKey) || changed;
  }
}

/** 部品 d の呼び出し c が渡す文字列の名前を、写しにあるものだけ読み書きにする */
function helperCallAccesses(file, c, d, known) {
  const out = [];
  for (const name of c.args[d.paramIndex]?.lits ?? []) {
    const ok =
      d.kind === "table"
        ? known.knownTables.has(name)
        : known.knownFunctions.has(name);
    if (!ok) continue;
    out.push({
      kind: d.kind,
      name,
      op: d.op,
      via: `helper:${c.callee}`,
      file,
      line: c.line,
      columns: [],
      writeColumns: WRITE_OPS.has(d.op) && d.op !== "delete" ? ["?"] : [],
    });
  }
  return out;
}

/** 同じ呼び出しで同じ表・操作は1つに */
function dedupeHelperAccesses(out) {
  const seen = new Set();
  return out.filter((a) => {
    const k = `${a.file}:${a.line}:${a.kind}:${a.name}:${a.op}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 表・RPC の名前を引数で受け取る部品（`upsertChangedRows(client, "表", …)`・`fetchAll(client, "表")` 等）の
 * 呼び出しを、呼び手のファイル:行の読み書きにする。部品を包む部品（引数をそのまま渡す関数）もたどる。
 * 呼ぶ関数は、同じファイルの関数か、相対 import の名前つき import で解決する。
 * @param {Map<string, { helperDefs?: Array<{ fn: string, paramIndex: number, kind: string, op: string }>, callSites?: Array<{ callee: string, line: number, encl: string | null, args: Array<{ lits: string[] | null, param: number | null }> }>, importBindings?: Record<string, { source: string, imported: string }> }>} perFile
 * @param {{ knownTables: Set<string>, knownFunctions: Set<string> }} known
 */
export function resolveHelperAccesses(perFile, known) {
  const files = new Set(perFile.keys());
  const table = createHelperTable(perFile);
  const calleeKey = createCalleeKey(perFile, files, table.helpers);
  propagateWrappers(perFile, table, calleeKey);
  const out = [];
  for (const [file, p] of perFile) {
    for (const c of p.callSites ?? []) {
      const key = calleeKey(file, c.callee);
      if (!key) continue;
      for (const d of table.helpers.get(key)?.values() ?? [])
        out.push(...helperCallAccesses(file, c, d, known));
    }
  }
  return dedupeHelperAccesses(out);
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

/** 名前の文字列の箇所（読み込んだファイルの分と他の言語の分）。部品の呼び出しで拾った行の近くは、読み書きとして数えたので外す */
function collectMentions(perFile, otherMentions, helperAccesses) {
  return [
    ...[...perFile.values()].flatMap((p) => p.mentions ?? []),
    ...(otherMentions ?? []),
  ]
    .filter(
      (m) =>
        !helperAccesses.some(
          (a) =>
            a.file === m.file &&
            a.kind === m.kind &&
            a.name === m.name &&
            Math.abs(a.line - m.line) <= 3,
        ),
    )
    .sort(byRef);
}

const mentionRefs = (mentions, kind, name) =>
  mentions.filter((m) => m.kind === kind && m.name === name).map(ref);

/** トリガーの関数（public.f() の f）→ その表 */
function buildTriggerTables(snapshot) {
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
  return triggerTables;
}

/** 関数の本体が読む・書く表と呼ぶ関数（名前 → 本体）。同じ名前の多重定義は合わせる */
function buildFnBody(snapshot, relationNames, functionNames) {
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
  return fnBody;
}

/** ビューの定義が読む表（DROP は依存で止まるか、CASCADE でビューごと消える） */
function buildViewBody(snapshot, relationNames, functionNames) {
  const viewBody = new Map();
  for (const rel of snapshot.relations) {
    if (!Array.isArray(rel.viewDefinition)) continue;
    viewBody.set(
      rel.name,
      sqlTableRefs(
        rel.viewDefinition.join("\n"),
        relationNames,
        functionNames,
        rel.name,
      ),
    );
  }
  return viewBody;
}

/** 列の名前が RPC・ビューの本文に出るかを見る本文（コメントと文字列を外した本文で語として） */
function buildSqlText(snapshot) {
  const sqlText = new Map();
  for (const fn of snapshot.functions)
    sqlText.set(
      `rpc:${fn.name}`,
      `${sqlText.get(`rpc:${fn.name}`) ?? ""}\n${stripSqlNoise(fn.definition.join("\n"))}`,
    );
  for (const rel of snapshot.relations)
    if (Array.isArray(rel.viewDefinition))
      sqlText.set(
        `view:${rel.name}`,
        stripSqlNoise(rel.viewDefinition.join("\n")),
      );
  return sqlText;
}

/** 検査の固定入力のファイル（verify-*.js 等）の箇所には test を付ける。写しにある名前だけを拾っている */
const ledgerEntry = (a, columns) => ({
  ref: ref(a),
  op: a.op,
  via: a.via,
  columns,
  ...(isFixtureLike(a.file) ? { test: true } : {}),
});

/** 本体（bodies の key 側）が name を含む名前の一覧 */
const namesWhere = (bodies, key, name) =>
  [...bodies.entries()]
    .filter(([, b]) => b[key].includes(name))
    .map(([n]) => n)
    .sort();

/** 表の列ごとの読み手・書き手の箇所と、写しに無い列の名前 */
function collectColumnRefs(rel, mine) {
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
  return { columns, unknownColumns };
}

function buildTableEntry(rel, src) {
  const { all, fnBody, viewBody, sqlText, mentions, extraReaders } = src;
  const mine = all.filter((a) => a.kind === "table" && a.name === rel.name);
  const readers = mine.filter((a) => !WRITE_OPS.has(a.op));
  const writers = mine.filter((a) => WRITE_OPS.has(a.op));
  const { columns, unknownColumns } = collectColumnRefs(rel, mine);
  const viaRpc = namesWhere(fnBody, "reads", rel.name);
  const writtenByRpc = namesWhere(fnBody, "writes", rel.name);
  const readByView = namesWhere(viewBody, "reads", rel.name);
  const sqlReaders = [
    ...viaRpc.map((n) => `rpc:${n}`),
    ...writtenByRpc.map((n) => `rpc:${n}`),
    ...readByView.map((n) => `view:${n}`),
  ];
  for (const c of Object.keys(columns)) {
    const re = new RegExp(`\\b${c}\\b`, "i");
    columns[c].sql = sortStr(
      sqlReaders.filter((k) => re.test(sqlText.get(k) ?? "")),
    );
  }
  return {
    kind: rel.kind,
    rlsEnabled: rel.rlsEnabled,
    access: relationAccess(rel),
    readers: readers.map((a) => ledgerEntry(a, a.columns)),
    writers: writers.map((a) => ledgerEntry(a, a.writeColumns)),
    readByRpc: viaRpc,
    writtenByRpc,
    readByView,
    columns,
    columnsNotInSnapshot: [...unknownColumns].sort(),
    mentions: mentionRefs(mentions, "table", rel.name),
    external: extraReaders.filter(
      (e) => e.kind === "table" && e.name === rel.name,
    ),
  };
}

function buildTables(snapshot, src) {
  const tables = {};
  for (const rel of [...snapshot.relations].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  ))
    tables[rel.name] = buildTableEntry(rel, src);
  return tables;
}

function buildRpcs(snapshot, src, triggerTables) {
  const { all, fnBody, mentions, extraReaders } = src;
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
      mentions: mentionRefs(mentions, "rpc", name),
      triggerOn: [...(triggerTables.get(name) ?? [])].sort(),
      calledByRpc: namesWhere(fnBody, "calls", name),
      reads: body.reads,
      writes: body.writes,
      calls: body.calls,
      external: extraReaders.filter((e) => e.kind === "rpc" && e.name === name),
    };
  }
  return rpcs;
}

/** コードが使うのに写しに無い名前（種類:名前 → 箇所） */
function buildNotInSnapshot(all, relationNames, functionNames) {
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
  return notInSnapshot;
}

/** 取得のジョブが書く表に、そのジョブの名前を付ける（どの表にも scrapeJobs を持たせる） */
function attachScrapeJobs(tables, scrapeJobs) {
  for (const j of scrapeJobs) {
    for (const t of Object.keys(j.writes)) {
      if (tables[t]) {
        tables[t].scrapeJobs ??= [];
        tables[t].scrapeJobs.push(j.job);
      }
    }
  }
  for (const t of Object.values(tables)) t.scrapeJobs ??= [];
}

const countTablesWithoutReaders = (tables) =>
  Object.values(tables).filter(
    (t) =>
      t.readers.length === 0 &&
      // data_health_* は件数・鮮度の監視で、使う読み手ではない
      t.readByRpc.filter((n) => !n.startsWith("data_health_")).length === 0 &&
      t.readByView.length === 0 &&
      t.mentions.length === 0 &&
      t.external.length === 0,
  ).length;

const countRpcsWithoutCallers = (rpcs) =>
  Object.values(rpcs).filter(
    (r) =>
      r.callers.length === 0 &&
      r.calledByRpc.length === 0 &&
      r.mentions.length === 0 &&
      r.triggerOn.length === 0 &&
      r.external.length === 0,
  ).length;

function buildCounts(l) {
  const { all, tables, rpcs, mentions } = l;
  return {
    tables: Object.keys(tables).length,
    rpcs: Object.keys(rpcs).length,
    sourceFiles: l.perFile.size,
    filesWithAccess: new Set(all.map((a) => a.file)).size,
    tableReaders: all.filter((a) => a.kind === "table" && !WRITE_OPS.has(a.op))
      .length,
    tableWriters: all.filter((a) => a.kind === "table" && WRITE_OPS.has(a.op))
      .length,
    rpcCallers: all.filter((a) => a.kind === "rpc").length,
    nameMentions: mentions.length,
    tablesWithoutReaders: countTablesWithoutReaders(tables),
    rpcsWithoutCallers: countRpcsWithoutCallers(rpcs),
    external: l.extraReaders.length,
    notInSnapshot: Object.keys(l.notInSnapshot).length,
    unresolved: l.unresolved.length,
    parseErrors: l.parseErrors.length,
    uncoveredFiles: l.uncoveredFiles.length,
  };
}

/**
 * 台帳を組み立てる。
 * @param {{ perFile: Map<string, { accesses: Array<Record<string, unknown>>, unresolved: unknown[], imports: string[], parseError?: string }>, snapshot: any, extra: any, scrapeJobNames: string[], uncoveredFiles: string[], otherMentions?: Array<{ kind: string, name: string, file: string, line: number }> }} input
 */
export function buildLedger({
  perFile,
  snapshot,
  extra,
  scrapeJobNames,
  uncoveredFiles,
  otherMentions,
}) {
  const relationNames = new Set(snapshot.relations.map((r) => r.name));
  const functionNames = new Set(snapshot.functions.map((f) => f.name));
  const helperAccesses = resolveHelperAccesses(perFile, {
    knownTables: relationNames,
    knownFunctions: functionNames,
  });
  const all = [
    ...[...perFile.values()].flatMap((p) => p.accesses),
    ...helperAccesses,
  ].sort(byRef);
  const mentions = collectMentions(perFile, otherMentions, helperAccesses);
  const src = {
    all,
    mentions,
    fnBody: buildFnBody(snapshot, relationNames, functionNames),
    viewBody: buildViewBody(snapshot, relationNames, functionNames),
    sqlText: buildSqlText(snapshot),
    extraReaders: extra?.readers ?? [],
  };
  const tables = buildTables(snapshot, src);
  const rpcs = buildRpcs(snapshot, src, buildTriggerTables(snapshot));
  const notInSnapshot = buildNotInSnapshot(all, relationNames, functionNames);
  const scrape = scrapeJobWriters(scrapeJobNames, perFile, helperAccesses);
  attachScrapeJobs(tables, scrape.jobs);
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
    counts: buildCounts({
      ...src,
      perFile,
      tables,
      rpcs,
      notInSnapshot,
      unresolved,
      parseErrors,
      uncoveredFiles,
    }),
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

/** 見出しと、機械生成の注記 */
function renderHeader(L, ledger) {
  L.push("# データの読み手の台帳");
  L.push("");
  L.push(
    "> 機械生成（`node scripts/maintenance/generate-data-readers.js`）。手で書き換えない。表・列・RPC を変える・消す前に、ここで読み手と書き手を確かめる。master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す。PR には含めない（ADR-0078）。作業中の枝の影響を見るときは手元で作り直して読み、コミットせずに戻す。機械で拾えない repo の外の読み手（hq 等）は `docs/reference/data-readers.extra.json` に手で足す。",
  );
  L.push(">");
  L.push(
    `> 入力: \`src/\`・\`api/\`・\`scripts/\`・\`sns-video-studio/\` の JS/TS（構文木で \`.from()\`・\`.select()\`・\`.rpc()\` 等と \`/rest/v1/\` を拾う）と、本番スキーマの写し（\`docs/reference/schema-snapshot.json\`、取得 ${ledger.snapshotCapturedAt}）。権限・RPC の本体はこの写しの時点のもの。`,
  );
  L.push("");
}

/** 件数の表 */
function renderCounts(L, ledger) {
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
      "読み手の見つからない表（RPC・ビュー経由・名前の文字列・外も無し。data_health_* の監視だけのものは含む）",
    rpcsWithoutCallers:
      "呼び手の見つからない RPC（RPC 経由・名前の文字列・トリガー・外も無し）",
    external: "外の読み手（手で足した行）",
    notInSnapshot: "コードが使うのに写しに無い名前",
    unresolved: "名前が式で拾えなかった箇所",
    parseErrors: "構文木にできなかったファイル",
    uncoveredFiles: "対象外の言語のファイル（Python 等）",
  };
  for (const [k, v] of Object.entries(ledger.counts))
    L.push(`| ${labels[k] ?? k} | ${v} |`);
  L.push("");
}

/** 表の一覧の表 */
function renderTableSummary(L, ledger) {
  L.push("## 表");
  L.push("");
  L.push(
    "読み手・書き手は箇所の数。権限の「anon 可」は anon に SELECT の GRANT があり、RLS が無いか anon・PUBLIC 向けの SELECT のポリシーがあるもの。service_role は RLS を通らないので「service だけ」でも service のキーからは読める。",
  );
  L.push("");
  L.push(
    "| 表 | 種類 | 権限 | 読み手 | 書き手 | 本体で読む RPC・ビュー | 本体で書く RPC | 取得のジョブ | 外の読み手 |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const [name, t] of Object.entries(ledger.tables)) {
    L.push(
      `| [${name}](#t-${name}) | ${t.kind} | ${t.access.summary} | ${t.readers.length} | ${t.writers.length} | ${cell(shortList([...t.readByRpc, ...t.readByView.map((v) => `view:${v}`)], 3))} | ${cell(shortList(t.writtenByRpc, 3))} | ${cell(shortList(t.scrapeJobs, 3))} | ${t.external.map((e) => cell(`${e.repo}:${e.reader}`)).join(", ")} |`,
    );
  }
  L.push("");
}

/** RPC の一覧の表 */
function renderRpcSummary(L, ledger) {
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
}

/** 取得のジョブの表 */
function renderScrapeSummary(L, ledger) {
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
}

/** コードが使うのに写しに無い名前 */
function renderNotInSnapshot(L, ledger) {
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
}

/** 拾えなかったもの */
function renderUnresolved(L, ledger) {
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
}

/** 表1つ分の詳細の頭（権限・RPC・ジョブ・外の読み手・名前の文字列） */
function renderTableFacts(L, t) {
  L.push(
    `- 権限: ${t.access.summary}（anon: ${t.access.anon.join("・") || "なし"} / authenticated: ${t.access.authenticated.join("・") || "なし"}、RLS ${t.rlsEnabled ? "有効" : "無効"}）`,
  );
  if (t.readByView.length)
    L.push(`- 定義で読むビュー: ${t.readByView.join(", ")}`);
  if (t.readByRpc.length) L.push(`- 本体で読む RPC: ${t.readByRpc.join(", ")}`);
  if (t.writtenByRpc.length)
    L.push(`- 本体で書く RPC: ${t.writtenByRpc.join(", ")}`);
  if (t.scrapeJobs.length) L.push(`- 取得のジョブ: ${t.scrapeJobs.join(", ")}`);
  for (const e of t.external)
    L.push(
      `- 外の読み手: ${e.repo} \`${e.reader}\`（${e.access}${e.columns ? `、列 ${e.columns.join(", ")}` : ""}）${e.detail ? ` ${e.detail}` : ""}（${e.source}、${e.addedAt}）`,
    );
  if (t.columnsNotInSnapshot.length)
    L.push(
      `- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: ${t.columnsNotInSnapshot.join(", ")}`,
    );
  if (t.mentions.length)
    L.push(
      `- 名前の文字列（\`.from(式)\` 等の先で読む・書く見込み）: ${t.mentions.map((m) => `\`${m}\``).join(", ")}`,
    );
}

/** 箇所の1行 */
const fmtAccess = (a) =>
  `\`${a.ref}\` ${a.op}${a.via !== "client" ? `(${a.via})` : ""}${a.columns.length ? ` [${a.columns.join(", ")}]` : ""}${a.test ? " （検査）" : ""}`;

/** 表1つ分の読み手・書き手の箇所 */
function renderTableAccesses(L, t) {
  L.push(`- 読み手（${t.readers.length}）: ${t.readers.length ? "" : "なし"}`);
  for (const a of t.readers) L.push(`  - ${fmtAccess(a)}`);
  L.push(`- 書き手（${t.writers.length}）: ${t.writers.length ? "" : "なし"}`);
  for (const a of t.writers) L.push(`  - ${fmtAccess(a)}`);
}

/** 列の読まれ方の注記 */
function renderColumnNote(L, t) {
  const externalColumns = new Set(t.external.flatMap((e) => e.columns ?? []));
  const unread = Object.entries(t.columns)
    .filter(
      ([k, v]) =>
        v.readers.length === 0 && v.sql.length === 0 && !externalColumns.has(k),
    )
    .map(([k]) => k);
  const unknownReader =
    t.readers.some(
      (a) =>
        a.columns.includes("*") ||
        a.columns.includes("?") ||
        a.columns.length === 0,
    ) ||
    t.mentions.length > 0 ||
    t.external.some((e) => !e.columns);
  if (unknownReader) {
    L.push(
      '- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる',
    );
  } else if (unread.length) {
    L.push(
      `- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: ${unread.join(", ")}`,
    );
  }
}

/** 表1つ分の詳細 */
function renderTableDetail(L, name, t) {
  L.push(`### <a id="t-${name}"></a>${name}`);
  L.push("");
  renderTableFacts(L, t);
  renderTableAccesses(L, t);
  renderColumnNote(L, t);
  L.push("");
}

/** 表ごとの読み手・書き手 */
function renderTableDetails(L, ledger) {
  L.push("## 表ごとの読み手・書き手");
  L.push("");
  for (const [name, t] of Object.entries(ledger.tables))
    renderTableDetail(L, name, t);
}

/** 台帳の Markdown。JSON と同じ中身を、人と AI が先に読む形にする */
export function renderMarkdown(ledger) {
  const L = [];
  renderHeader(L, ledger);
  renderCounts(L, ledger);
  renderTableSummary(L, ledger);
  renderRpcSummary(L, ledger);
  renderScrapeSummary(L, ledger);
  renderTableDetails(L, ledger);
  renderNotInSnapshot(L, ledger);
  renderUnresolved(L, ledger);
  return L.join("\n");
}
