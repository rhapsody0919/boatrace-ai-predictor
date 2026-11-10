/**
 * prLaneMoveOnly.js - 移すだけの判定（pr-lane.js から使う。BOA-1433 RA02b、hq の設計図 drafts/ryujin-target-architecture-20261110.md §5.3 RA02②）
 *
 * split-data-layer.mjs が supabaseDataService.js（from）から新しい core*.js・*Queries*.js（to）へ字のまま移した PR を見分ける。
 * pr-lane.js と同じく Node の組み込みだけ（npm の部品を使わない hq との約束）なので、構文木でなく行と単位で比べる。
 * スクリプトは本体の字をそのまま写すので、単位ごとに行の列が順まで一致すれば、AST が同じより強い（字まで同じ）。
 *
 * 単位: ファイルの上の文（列0で始まる宣言。直前の注釈を含む）と、from の `export const supabaseDataService = {` の中のメンバー
 * （字下げ2で始まる。直前の注釈を含む）。名前で対応させ、次の正規化の後の行の列が同じなら同じ単位:
 *   - 上の単位: 宣言の行の頭の `export ` を外す（to で export を足すため）
 *   - メソッド → 関数: 注釈の頭の字下げ2を外す・`  [async ]getX(` → `export [async ]function getX(`・`this.X` → `X`・終わりの `  },` → `  }`
 * 確かめること（どれかが外れれば移すだけでない＝空集合。読めない・閉じない文も空集合）:
 *   1. to の単位は、base の上の単位かメソッドのちょうど1つと同じ。to には頭の決まった2行の注釈・import・単位のほかに何も無い
 *   2. head の from は、base から移した上の単位を抜いた列と同じ（順も）。object のメンバーは base と同じ順で、移したメソッドだけ `  getX,`
 *      （委ねるだけのメソッド `getX(v) { return getX(v); }` は、上の関数 getX を移したときだけ `  getX,` にしてよい）
 *   3. import: to と head の from の import の名前（元・名前・as）は base の from の import にあるか、この PR の to から as 無しで
 *      その to が export する名前だけ。副作用だけの import は to に置かない・base の物は head に残す。to は from を import しない・to の間で循環しない
 *   4. export: head の from の export は base にあった物か、to から as 無しで base が export していた名前だけ。base が export していた名前は全部残す
 *   5. `this.X` の X はこの PR で移したメソッド・委ねるだけで消したメソッド・base で既に `  X,` だったメンバーだけで、その to から見える。
 *      移したメソッドの名前は base の上の名前・import とぶつからず、base の本文（メソッドの頭の名前の字を除く）に裸で出ない（局所の名前に隠れる・別の物を指すのを防ぐ）
 *   6. to の中の関数でない単位（const・class）は base と同じ順。to の関数に this が残らない。this. が文字列・注釈の中に無い
 *   7. base の上の名前と移したメソッドの名前は、to・殻の本文に裸で出るならそのファイルで見える（import か宣言）。殻の import の順は base のまま
 *   8. 委ねるだけのメソッドが async なら上の関数も async。上に宣言でない文（let・式の文等）があれば判定しない。`*\/` の後ろに字がある注釈の行も判定しない
 *   9. 注釈: 最後の単位の後ろに注釈だけの行を置かない。ブロックの注釈の閉じは行の末だけ（後ろにコードを隠さない）。to の import に注釈を置かない。
 *      殻の import・export の注釈は base の注釈の列から抜いただけ（順も）。単位と単位の間の空行は見ない
 */
import { dirname, posix } from "node:path";
import {
  SERVICE_OPEN,
  METHOD_HEAD,
  NotMove,
  fail,
  parseModule,
  importSpecs,
  exportSpecs,
  key,
  stripExport,
  methodAsFunction,
  same,
  bareRe,
  codeOnly,
  bareNames,
  escapeRe,
  serviceObject,
  delegation,
  parseToFile,
  exportedNames,
  listComments,
} from "./prLaneMoveOnlyParse.js";
// ---- 照合 ----

/** to の単位を base の単位に1つずつ対応させる */
function matchUnits(ctx, toFiles) {
  const used = new Set();
  for (const f of toFiles) {
    f.matched = [];
    for (const u of f.units.filter((x) => x.kind !== "import")) {
      const top = ctx.topByName.get(u.name);
      const member = ctx.methodByName.get(u.name);
      const thisNames = new Set();
      let b = null;
      if (top && same(stripExport(u), stripExport(top)))
        b = { base: top, method: false };
      else if (
        member &&
        u.kind === "function" &&
        same(u.lines, methodAsFunction(member, thisNames))
      )
        b = { base: member, method: true };
      if (!b)
        fail(
          `to の単位 ${u.name ?? u.head} が base のどの単位とも字が合わない`,
        );
      if (used.has(b.base)) fail(`base の単位 ${u.name} を2回移した`);
      if (b.method && u.lines.some((l) => /\bthis\b/.test(l)))
        fail(`${u.name} に this が残る`);
      const thisCount = (ls, f) =>
        ls.reduce((n, l) => n + (f(l).match(/\bthis\./g) ?? []).length, 0);
      if (
        b.method &&
        thisCount(b.base.lines, (l) => l) !== thisCount(b.base.lines, codeOnly)
      )
        fail(
          `${u.name} の this. が文字列・注釈の中にある（書き換えが値を変えうる）`,
        );
      used.add(b.base);
      f.matched.push({ unit: u, ...b, thisNames });
    }
  }
  return used;
}

function checkFacade(ctx, head, used) {
  const keptTop = ctx.baseTop.filter((u) => !used.has(u));
  const headTop = head.filter(
    (u) =>
      ["function", "value", "other"].includes(u.kind) &&
      u.head !== SERVICE_OPEN,
  );
  if (
    keptTop.length !== headTop.length ||
    keptTop.some((u, i) => !same(u.lines, headTop[i].lines))
  )
    fail("残す上の単位が base と同じ列でない");
  const obj = serviceObject(head);
  if (
    !same(obj.lead, ctx.obj.lead) ||
    obj.members.length !== ctx.obj.members.length
  )
    fail("object の頭かメンバーの数が base と違う");
  const dropped = new Set();
  ctx.obj.members.forEach((b, i) => {
    const h = obj.members[i];
    const d = delegation(b);
    const topD = d && ctx.topByName.get(d.name);
    const asyncOk =
      !/^ {2}async /.test(b.head) ||
      /^(?:export )?async function /.test(topD?.head ?? "");
    const delegOk =
      topD &&
      used.has(topD) &&
      asyncOk &&
      topD.head.includes(`function ${d.name}(${d.params})`);
    if (used.has(b) || delegOk) {
      if (!h.shorthand || h.name !== b.name)
        fail(`移した ${b.name} が殻で \`  ${b.name},\` でない`);
      if (!used.has(b)) dropped.add(b.name);
    } else if (!same(b.lines, h.lines))
      fail(`残すメンバー ${b.name ?? b.head} が base と違う`);
  });
  return dropped;
}

function checkImports(ctx, head, toFiles) {
  const toBySource = new Map(
    toFiles.map((f) => [`./${posix.basename(f.path)}`, f]),
  );
  const okSpec = (s, self) => {
    if (ctx.baseImportKeys.has(key(s))) return true;
    const t = toBySource.get(s.source);
    return (
      Boolean(t) &&
      t !== self &&
      s.imported === s.local &&
      t.exports.has(s.imported)
    );
  };
  const srcOrder = (units) =>
    units
      .filter((u) => u.kind === "import")
      .map((u) => importSpecs(u.text)[0].source);
  const baseOrder = srcOrder(ctx.base);
  let at = 0;
  for (const x of srcOrder(head).filter((y) => baseOrder.includes(y))) {
    const next = baseOrder.indexOf(x, at);
    if (next < 0) fail("殻の import の順が base と違う");
    at = next + 1;
  }
  const headSpecs = head
    .filter((u) => u.kind === "import")
    .flatMap((u) => importSpecs(u.text));
  for (const s of ctx.baseImportSpecs.filter((x) => x.imported === null))
    if (!headSpecs.some((h) => key(h) === key(s)))
      fail(`副作用の import ${s.source} を殻から外した`);
  for (const s of headSpecs)
    if (s.imported !== null && !okSpec(s, null))
      fail(`殻の import ${key(s)} が base に無い`);
  for (const f of toFiles) {
    f.specs = f.units
      .filter((u) => u.kind === "import")
      .flatMap((u) => importSpecs(u.text));
    for (const s of f.specs) {
      if (s.imported === null) fail(`to ${f.path} に副作用だけの import`);
      if (!okSpec(s, f))
        fail(`to ${f.path} の import ${key(s)} が base にも to にも無い`);
    }
    const locals = f.specs.map((s) => s.local);
    if (new Set(locals).size !== locals.length)
      fail(`to ${f.path} で同じ名前を2回 import する`);
    f.deps = new Set(
      f.specs.map((s) => toBySource.get(s.source)).filter(Boolean),
    );
    f.visible = new Set([
      ...f.specs.map((s) => s.local),
      ...f.units.map((u) => u.name).filter(Boolean),
    ]);
  }
  const seen = new Map();
  const visit = (f) => {
    if (seen.get(f) === 1) fail(`to の間で import が循環する: ${f.path}`);
    if (seen.get(f) === 2) return;
    seen.set(f, 1);
    f.deps.forEach(visit);
    seen.set(f, 2);
  };
  toFiles.forEach(visit);
  return { headSpecs, toBySource };
}

function checkExports(ctx, head, toBySource) {
  for (const u of head.filter((x) => x.kind === "export"))
    for (const s of exportSpecs(u.text)) {
      const t = s.source && toBySource.get(s.source);
      const fromTo =
        t &&
        s.name === s.as &&
        t.exports.has(s.name) &&
        ctx.baseExported.has(s.name);
      if (!ctx.baseExportKeys.has(key(s)) && !fromTo)
        fail(`殻の export ${key(s)} が base に無い`);
    }
  const now = exportedNames(head);
  for (const n of ctx.baseExported)
    if (!now.has(n)) fail(`base が export していた ${n} を殻が export しない`);
}

function checkNames(ctx, toFiles, used, dropped, headSpecs) {
  const movedMethods = new Set(
    ctx.obj.members.filter((m) => used.has(m)).map((m) => m.name),
  );
  const shorthands = new Set(
    ctx.obj.members.filter((m) => m.shorthand).map((m) => m.name),
  );
  for (const n of movedMethods) {
    if (ctx.moduleNames.has(n))
      fail(`移したメソッド ${n} が base の上の名前・import とぶつかる`);
    if (!headSpecs.some((s) => s.local === n))
      fail(`殻が ${n} を import しない`);
    const re = bareRe(n);
    for (const l of ctx.baseLines)
      if (re.test(codeOnly(l.replace(METHOD_HEAD, "  $1("))))
        fail(`base に裸の ${n} がある（名前が別の物を指しうる）`);
  }
  for (const f of toFiles) {
    for (const m of f.matched)
      for (const x of m.thisNames)
        if (
          !(movedMethods.has(x) || dropped.has(x) || shorthands.has(x)) ||
          !f.visible.has(x)
        )
          fail(`${m.unit.name} の this.${x} が移したメソッドを指さない`);
    const order = f.matched
      .filter((m) => !m.method && m.unit.kind === "value")
      .map((m) => ctx.baseTop.indexOf(m.base));
    if (order.some((v, i) => i > 0 && v < order[i - 1]))
      fail(`to ${f.path} の const の順が base と違う`);
  }
}

// 単位の中で同じ名前を宣言していれば局所の名前（base と字が同じなので同じ物を指す）
const declaresLocally = (u, n) =>
  u.lines.some((l) =>
    new RegExp(`\\b(?:const|let|var|function|class) ${escapeRe(n)}\\b`).test(l),
  );

/** base の上の名前と移したメソッドの名前が裸で出たら、そのファイルで見える（import か自分の単位）こと */
function checkVisible(ctx, head, toFiles, headSpecs, movedMethods) {
  const watch = new Set([...ctx.moduleNames, ...movedMethods]);
  const headVisible = new Set([
    ...headSpecs.map((s) => s.local),
    ...head.map((u) => u.name).filter(Boolean),
  ]);
  const files = [
    { path: "殻", visible: headVisible, units: head },
    ...toFiles.map((f) => ({
      path: f.path,
      visible: f.visible,
      units: f.units,
    })),
  ];
  for (const f of files)
    for (const u of f.units.filter(
      (x) => x.kind !== "import" && x.kind !== "export",
    ))
      for (const l of u.lines)
        for (const n of bareNames(l))
          if (watch.has(n) && !f.visible.has(n) && !declaresLocally(u, n))
            fail(`${f.path} で ${n} が見えない（import も宣言も無い）`);
}

/** xs が ys から字を抜いただけの列か（順も同じ） */
const isSubsequence = (xs, ys) => {
  let j = 0;
  for (const x of xs) {
    while (j < ys.length && ys[j] !== x) j++;
    if (j === ys.length) return false;
    j++;
  }
  return true;
};

function check(moveOnly, changes, readText) {
  if (!moveOnly) fail("設定に moveOnly が無い");
  const from = changes.filter((c) => new RegExp(moveOnly.from).test(c.path));
  const to = changes.filter((c) =>
    moveOnly.to.some((p) => new RegExp(p).test(c.path)),
  );
  if (from.length !== 1 || from[0].status !== "M")
    fail("from がちょうど1つの変更でない");
  const dir = dirname(from[0].path);
  if (
    to.length === 0 ||
    to.some((c) => c.status !== "A" || dirname(c.path) !== dir)
  )
    fail("to が from の隣の新しいファイルでない");
  const read = (side, p) => {
    const t = readText(side, p);
    if (typeof t !== "string") fail(`読めない: ${side}:${p}`);
    return t;
  };
  const baseText = read("base", from[0].path);
  const base = parseModule(baseText);
  const head = parseModule(read("head", from[0].path));
  const toFiles = to.map((c) => ({
    path: c.path,
    ...parseToFile(read("head", c.path)),
  }));
  if ([...base, ...head].some((u) => u.kind === "other"))
    fail(
      "上に宣言でない文（let・式の文・分割の const 等）がある（単位の境を決められない）",
    );
  // import・export は名前だけで比べるので、注釈は別に見る: 殻の注釈は base の注釈の列から抜いただけ（順も）
  if (!isSubsequence(listComments(head), listComments(base)))
    fail("殻の import・export の注釈が base に無い（足した・順を変えた）");
  const obj = serviceObject(base);
  const baseTop = base.filter(
    (u) => ["function", "value", "other"].includes(u.kind) && u !== obj.unit,
  );
  const baseImportSpecs = base
    .filter((u) => u.kind === "import")
    .flatMap((u) => importSpecs(u.text));
  const ctx = {
    base,
    obj,
    baseTop,
    baseLines: baseText.split("\n"),
    baseImportSpecs,
    baseImportKeys: new Set(baseImportSpecs.map(key)),
    baseExportKeys: new Set(
      base
        .filter((u) => u.kind === "export")
        .flatMap((u) => exportSpecs(u.text))
        .map(key),
    ),
    baseExported: exportedNames(base),
    topByName: new Map(baseTop.filter((u) => u.name).map((u) => [u.name, u])),
    methodByName: new Map(
      obj.members.filter((m) => m.method).map((m) => [m.name, m]),
    ),
    moduleNames: new Set(
      [
        ...baseTop.map((u) => u.name),
        ...baseImportSpecs.map((s) => s.local),
      ].filter(Boolean),
    ),
  };
  const used = matchUnits(ctx, toFiles);
  const dropped = checkFacade(ctx, head, used);
  const { headSpecs, toBySource } = checkImports(ctx, head, toFiles);
  checkExports(ctx, head, toBySource);
  checkNames(ctx, toFiles, used, dropped, headSpecs);
  const moved = ctx.obj.members.filter((m) => used.has(m)).map((m) => m.name);
  checkVisible(ctx, head, toFiles, headSpecs, moved);
  return new Set([from[0].path, ...to.map((c) => c.path)]);
}

/** 移すだけでない理由（試験と調べ用）。移すだけなら null */
export function moveOnlyReason(moveOnly, changes, readText) {
  try {
    check(moveOnly, changes, readText);
    return null;
  } catch (e) {
    return e instanceof NotMove ? e.message : `判定の失敗: ${e?.message ?? e}`;
  }
}

/**
 * 移すだけの PR なら、H3・H9 を外してよいパスの集合（from と to の全部）。違えば・読めなければ空（安全側）。
 * @param {{from: string, to: string[]}|undefined} moveOnly config/pr-path-rules.json の moveOnly
 * @param {{status: string, path: string}[]} changes
 * @param {(side: "base"|"head", path: string) => string|null} readText 読めなければ null
 */
export function moveOnlyPaths(moveOnly, changes, readText) {
  try {
    return check(moveOnly, changes, readText);
  } catch {
    return new Set();
  }
}
