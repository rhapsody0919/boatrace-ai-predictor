import {
  IDENT,
  literalString,
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
} from "./dataReadersAst.js";
import {
  WRITE_OPS,
  DB_OPS,
  NON_DB_FROM_OBJECTS,
  chainColumns,
  pushEmbedAccesses,
  clientEmbedKnown,
  pushRestAccess,
} from "./dataReadersSelect.js";

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
