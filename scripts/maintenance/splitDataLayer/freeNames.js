/**
 * splitDataLayer/freeNames.js - 単位の中で宣言していない参照の名前（split-data-layer.mjs、BOA-1432）。
 * 関数・ブロック・switch・for・catch・class のスコープを見る（メソッドの中の `const VENUE_NAMES` が上の VENUE_NAMES を
 * 影にする等、字の範囲を区別しないと import を取り違えるため）。代入の左（`x = 1`・`({ a } = o)`）は参照として数える。モジュールは strict なので function の宣言はブロックのスコープ
 */
import { SKIP_KEYS, isAnyFunction, walk, bindingNames } from "./ast.js";

// 関数の本体の var（入れ子の関数に入らない）
function varNames(body) {
  const out = [];
  walk(body, (n) => {
    if (isAnyFunction(n)) return false;
    if (n.type === "VariableDeclaration" && n.kind === "var")
      n.declarations.forEach((d) => bindingNames(d.id, out));
    return undefined;
  });
  return out;
}

// 並んだ文が直に宣言する let・const・class・function
function lexicalNames(stmts) {
  const out = [];
  for (const s of stmts) {
    if (s.type === "VariableDeclaration" && s.kind !== "var")
      s.declarations.forEach((d) => bindingNames(d.id, out));
    else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id)
      out.push(s.id.name);
  }
  return out;
}

function makeWalker() {
  const free = new Set();
  const scopes = [];
  // thisShadowed: this.X の X がその位置で局所の名前に隠れる（X に置き換えると別の物を呼ぶ）。assigned: 代入の左の自由な名前
  const w = { free, thisShadowed: new Set(), assigned: new Set() };
  w.bound = (name) => scopes.some((s) => s.has(name));
  w.scoped = (names, fn) => {
    scopes.push(new Set(names));
    fn();
    scopes.pop();
  };
  w.ref = (name) => {
    if (!scopes.some((s) => s.has(name))) free.add(name);
  };
  w.visit = (n) => {
    if (Array.isArray(n)) return n.forEach(w.visit);
    if (!n || typeof n !== "object" || typeof n.type !== "string") return undefined;
    const h = HANDLERS[n.type];
    if (h) return h(n, w);
    for (const k of Object.keys(n)) if (!SKIP_KEYS.has(k)) w.visit(n[k]);
    return undefined;
  };
  // 束ねる側の型: 名前は飛ばし、既定値・計算のキーだけ参照として見る
  w.pattern = (p) => {
    if (!p || p.type === "Identifier") return undefined;
    const h = PATTERNS[p.type];
    return h ? h(p, w) : w.visit(p);
  };
  return w;
}

const PATTERNS = {
  ObjectPattern: (p, w) =>
    p.properties.forEach((q) => {
      if (q.type === "RestElement") return w.pattern(q.argument);
      if (q.computed) w.visit(q.key);
      return w.pattern(q.value);
    }),
  ArrayPattern: (p, w) => p.elements.forEach(w.pattern),
  AssignmentPattern: (p, w) => {
    w.pattern(p.left);
    w.visit(p.right);
  },
  RestElement: (p, w) => w.pattern(p.argument),
};

function fnLike(n, w) {
  if (n.computed) w.visit(n.key);
  const own = [];
  if (n.type === "FunctionExpression" && n.id) own.push(n.id.name);
  n.params.forEach((p) => bindingNames(p, own));
  const block = n.body.type === "BlockStatement";
  if (block) own.push(...varNames(n.body), ...lexicalNames(n.body.body));
  w.scoped(own, () => {
    n.params.forEach(w.pattern);
    if (block) n.body.body.forEach(w.visit);
    else w.visit(n.body);
  });
}

function forLike(n, w) {
  const head = n.type === "ForStatement" ? n.init : n.left;
  const lexical = head?.type === "VariableDeclaration" && head.kind !== "var";
  w.scoped(lexical ? lexicalNames([head]) : [], () => {
    if (n.type === "ForStatement") [n.init, n.test, n.update].forEach(w.visit);
    else if (head?.type === "VariableDeclaration") w.visit(head);
    else w.pattern(head);
    if (n.type !== "ForStatement") w.visit(n.right);
    w.visit(n.body);
  });
}

function switchLike(n, w) {
  w.visit(n.discriminant);
  w.scoped(lexicalNames(n.cases.flatMap((c) => c.consequent)), () =>
    n.cases.forEach((c) => {
      w.visit(c.test);
      c.consequent.forEach(w.visit);
    }),
  );
}

function member(n, w) {
  if (n.object.type === "ThisExpression" && !n.computed && w.bound(n.property.name))
    w.thisShadowed.add(n.property.name);
  w.visit(n.object);
  if (n.computed) w.visit(n.property);
}

function keyed(n, w) {
  if (n.computed) w.visit(n.key);
  w.visit(n.value);
}

const skip = () => undefined;

function assignTarget(t, w) {
  if (t.type === "Identifier" && !w.bound(t.name)) w.assigned.add(t.name);
}

const HANDLERS = {
  Identifier: (n, w) => w.ref(n.name),
  FunctionDeclaration: fnLike,
  FunctionExpression: fnLike,
  ArrowFunctionExpression: fnLike,
  ObjectMethod: fnLike,
  ClassMethod: fnLike,
  ClassPrivateMethod: fnLike,
  BlockStatement: (n, w) => w.scoped(lexicalNames(n.body), () => n.body.forEach(w.visit)),
  StaticBlock: (n, w) => w.scoped(lexicalNames(n.body), () => n.body.forEach(w.visit)),
  SwitchStatement: switchLike,
  ForStatement: forLike,
  ForInStatement: forLike,
  ForOfStatement: forLike,
  CatchClause: (n, w) =>
    w.scoped(n.param ? bindingNames(n.param) : [], () => {
      w.pattern(n.param);
      w.visit(n.body);
    }),
  VariableDeclaration: (n, w) =>
    n.declarations.forEach((d) => {
      w.pattern(d.id);
      w.visit(d.init);
    }),
  ClassDeclaration: (n, w) =>
    w.scoped(n.id ? [n.id.name] : [], () => [n.superClass, n.body].forEach(w.visit)),
  ClassExpression: (n, w) =>
    w.scoped(n.id ? [n.id.name] : [], () => [n.superClass, n.body].forEach(w.visit)),
  ClassProperty: keyed,
  ClassPrivateProperty: keyed,
  ObjectProperty: keyed,
  MemberExpression: member,
  OptionalMemberExpression: member,
  LabeledStatement: (n, w) => w.visit(n.body),
  AssignmentExpression: (n, w) => {
    assignTarget(n.left, w);
    w.visit(n.left);
    w.visit(n.right);
  },
  UpdateExpression: (n, w) => {
    assignTarget(n.argument, w);
    w.visit(n.argument);
  },
  Program: (n, w) => {
    const names = n.body.flatMap((s) =>
      s.type === "ImportDeclaration" ? s.specifiers.map((x) => x.local.name) : [],
    );
    const decls = n.body.map((s) => (s.type === "ExportNamedDeclaration" && s.declaration ? s.declaration : s));
    w.scoped([...names, ...lexicalNames(decls), ...varNames(n)], () =>
      n.body.forEach((s) => (s.type === "ImportDeclaration" ? undefined : w.visit(s))),
    );
  },
  ImportDeclaration: skip,
  ExportNamedDeclaration: (n, w) => {
    if (n.source) return; // 再 export は束縛を作らず読まない
    w.visit(n.declaration);
    n.specifiers.forEach((x) => w.visit(x.local));
  },
  BreakStatement: skip,
  ContinueStatement: skip,
  MetaProperty: skip,
  PrivateName: skip,
};

export function scanNames(root) {
  const w = makeWalker();
  w.visit(root);
  return { free: w.free, thisShadowed: w.thisShadowed, assigned: w.assigned };
}

export const freeNames = (root) => scanNames(root).free;
