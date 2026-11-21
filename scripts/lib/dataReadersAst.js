import { parse } from "@babel/parser";

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

export {
  IDENT,
  objectKeys,
  propertyValue,
  memberName,
  isCall,
  chainAfter,
  walk,
  enclosingFetchMethod,
  collectConstStrings,
  staticStrings,
  templateTexts,
  enclosingFunction,
  collectTemplateIdents,
  parseSource,
};
