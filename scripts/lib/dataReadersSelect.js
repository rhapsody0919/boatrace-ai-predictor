import {
  IDENT,
  literalString,
  objectKeys,
  propertyValue,
  memberName,
  isCall,
  walk,
  staticStrings,
} from "./dataReadersAst.js";

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

const REST_METHOD_OP = {
  GET: "select",
  HEAD: "select",
  POST: "insert",
  PATCH: "update",
  PUT: "upsert",
  DELETE: "delete",
};

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

export {
  WRITE_OPS,
  DB_OPS,
  NON_DB_FROM_OBJECTS,
  chainColumns,
  pushEmbedAccesses,
  clientEmbedKnown,
  pushRestAccess,
};
