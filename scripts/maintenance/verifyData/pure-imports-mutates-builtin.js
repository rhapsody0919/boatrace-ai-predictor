// verify-pure-imports.js から移した「組み込みのグローバルを書き換えるか」の判定（staticString・MUTATING_CALLS・propName・mutationRootOf・isMutatingCallArg・mutatesBuiltin）。読むだけ

/** 文字列リテラルか、式を含まないテンプレートリテラルなら、その文字列。それ以外は null */
function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}

/** 第1引数の物を書き換える組み込みの関数（Object.defineProperty(Array.prototype, …) 等） */
const MUTATING_CALLS = {
  Object: ["defineProperty", "defineProperties", "assign", "setPrototypeOf"],
  Reflect: ["set", "defineProperty", "deleteProperty", "setPrototypeOf"],
};

const propName = (m) =>
  m.computed ? staticString(m.property) : m.property.name;

/**
 * 組み込みのグローバルの識別子が、書き換えの先の根になっているか。
 * 対象: 組み込み（またはその先の a.b.c）への代入・++/--・delete、
 * Object.defineProperty 等・Reflect.set 等の第1引数。別名に入れてから書き換える形は塞がない（限界）
 */
/** identifier を根にする a.b.c の一番外の MemberExpression（無ければ identifier 自身） */
function mutationRootOf(identifier) {
  let top = identifier;
  while (top.parent?.type === "MemberExpression" && top.parent.object === top)
    top = top.parent;
  return top;
}

/** Object.defineProperty(top, …)・Reflect.set(top, …) 等、第1引数の top を書き換える組み込みの呼び出しか */
function isMutatingCallArg(p, top) {
  if (p?.type !== "CallExpression" || p.arguments[0] !== top) return false;
  const c = p.callee;
  if (
    c.type === "MemberExpression" &&
    c.object.type === "Identifier" &&
    MUTATING_CALLS[c.object.name]?.includes(propName(c))
  )
    return true;
  return false;
}

function mutatesBuiltin(identifier) {
  const top = mutationRootOf(identifier);
  const p = top.parent;
  if (p?.type === "AssignmentExpression" && p.left === top) return true;
  if (p?.type === "UpdateExpression") return true;
  if (p?.type === "UnaryExpression" && p.operator === "delete") return true;
  return isMutatingCallArg(p, top);
}

export { staticString, mutatesBuiltin };
