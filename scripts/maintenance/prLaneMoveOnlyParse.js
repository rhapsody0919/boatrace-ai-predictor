/**
 * prLaneMoveOnlyParse.js - 移すだけの判定（prLaneMoveOnly.js）の字の読み方: 単位への切り分け・import と export の名前・正規化。
 * Node の組み込みも使わない（pr-lane.js の hq との約束: npm の部品なし）。BOA-1433
 */
export const ID = "[A-Za-z_$][\\w$]*";
export const SERVICE_OPEN = "export const supabaseDataService = {";
const MOVE_HEADER = [
  /^\/\/ src\/services\/supabaseDataService\.js から scripts\/maintenance\/split-data-layer\.mjs で字のまま移した（領域: [A-Za-z]+）。$/,
  /^\/\/ 本体の字下げは元のまま。手で直すときは普通の関数として直してよい$/,
];
const IMPORT_HEAD = /^import[\s{*]/;
const IMPORT_END = /(?:^import|\s|\}) ?from "[^"]+";$|^import "[^"]+";$/;
const EXPORT_LIST = /^export (?:\{|\* )/;
const LIST_END = /\}(?: from "[^"]+")?;$|^export \* (?:as \S+ )?from "[^"]+";$/;
const DECL = new RegExp(
  `^(?:export )?(?:(async )?function (${ID})\\(|class (${ID})\\b|const (${ID}) =)`,
);
export const METHOD_HEAD = new RegExp(`^ {2}(async )?(${ID})\\(`);

export class NotMove extends Error {}
export const fail = (why) => {
  throw new NotMove(why);
};

// ---- 字の切り分け ----

/** 列0の注釈の行か（ブロック注釈は閉じるまで）。行の種類の列を返す: "c" 注釈・"b" 空行・"x" コード */
function kinds(lines, indent = "") {
  let inBlock = false;
  return lines.map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      if (!inBlock && !t.endsWith("*/"))
        fail(`注釈の後ろに字がある行: ${t.slice(0, 60)}`);
      return "c";
    }
    if (t === "") return "b";
    if (!line.startsWith(indent) || line[indent.length] === " ") return "x";
    if (t.startsWith("//")) return "c";
    if (t.startsWith("/*")) {
      inBlock = !t.slice(2).includes("*/");
      if (!inBlock && !t.endsWith("*/"))
        fail(`注釈の後ろに字がある行: ${t.slice(0, 60)}`);
      return "c";
    }
    return "x";
  });
}

const isStart = (line, indent) =>
  line.startsWith(indent) && /^[^\s})\]]/.test(line.slice(indent.length));

/** 行を単位に切る（indent の字下げで始まるコードの行で始め、直前の注釈を含める。単位の後ろの空行は外す） */
export function splitUnits(lines, indent = "") {
  const k = kinds(lines, indent);
  const units = [];
  let lead = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    while (cur.lines.at(-1)?.trim() === "") cur.lines.pop();
    units.push(cur);
    cur = null;
  };
  lines.forEach((line, i) => {
    if (k[i] === "c") {
      close();
      lead.push(line);
    } else if (k[i] === "b" && !cur) {
      if (lead.length) lead.push(line);
    } else if (k[i] === "x" && isStart(line, indent)) {
      close();
      cur = { lines: [...lead, line], head: line };
      lead = [];
    } else if (cur) cur.lines.push(line);
    else fail(`単位の外の行: ${line.slice(0, 60)}`);
  });
  close();
  // 最後の単位の後ろの注釈は、どの単位にも入らず比べられない（足しても移すだけに見える）ので判定しない
  if (lead.some((l) => l.trim() !== ""))
    fail(
      `最後の単位の後ろに注釈だけの行: ${lead.find((l) => l.trim() !== "").slice(0, 60)}`,
    );
  return units;
}

/** import・export の文を1つの文に束ねる（閉じなければ移すだけと見なさない） */
function joinStatements(units) {
  return units.map((u) => {
    const code = u.lines
      .filter((l) => l.trim() !== "" && !/^\s*(?:\/\/|\/?\*)/.test(l))
      .map((l) => l.replace(/,\s*\/\/.*$/, ","));
    const text = code.join("\n");
    if (IMPORT_HEAD.test(u.head)) {
      if (
        !IMPORT_END.test(code.at(-1)) ||
        code.slice(0, -1).some((l) => IMPORT_END.test(l))
      )
        fail(`閉じない import: ${u.head}`);
      return { ...u, kind: "import", text };
    }
    if (EXPORT_LIST.test(u.head)) {
      if (!LIST_END.test(code.at(-1))) fail(`閉じない export: ${u.head}`);
      return { ...u, kind: "export", text };
    }
    if (/^export (?:\{|\*|default \{)/.test(u.head))
      fail(`読めない文: ${u.head}`);
    const m = DECL.exec(u.head);
    return {
      ...u,
      kind: m ? (m[2] ? "function" : "value") : "other",
      name: m ? (m[2] ?? m[3] ?? m[4]) : null,
    };
  });
}

export function parseModule(text) {
  return joinStatements(splitUnits(text.replace(/\n+$/, "").split("\n")));
}

// ---- import・export の名前 ----

/** import の文 → [{source, imported, local}]（副作用だけは imported: null） */
export function importSpecs(text) {
  const flat = text.replace(/\s+/g, " ").replace(/,? \}/, " }");
  const side = /^import "([^"]+)";$/.exec(flat);
  if (side) return [{ source: side[1], imported: null, local: null }];
  const m = /^import (.+?) from "([^"]+)";$/.exec(flat);
  if (!m) fail(`読めない import: ${flat.slice(0, 80)}`);
  const [, clause, source] = m;
  const re = new RegExp(
    `^(?:(${ID})(?:, |$))?(?:\\* as (${ID})$)?(?:\\{ (.*) \\}$)?$`,
  );
  const c = re.exec(clause);
  if (!c) fail(`読めない import: ${flat.slice(0, 80)}`);
  const out = [];
  if (c[1]) out.push({ source, imported: "default", local: c[1] });
  if (c[2]) out.push({ source, imported: "*", local: c[2] });
  for (const part of c[3] ? c[3].split(", ") : []) {
    const p = new RegExp(`^(${ID})(?: as (${ID}))?$`).exec(part.trim());
    if (!p) fail(`読めない import の名前: ${part}`);
    out.push({ source, imported: p[1], local: p[2] ?? p[1] });
  }
  return out;
}

/** export の文 → [{source|null, name, as}]。`export *` は name: "*" */
export function exportSpecs(text) {
  const flat = text.replace(/\s+/g, " ").replace(/,? \}/, " }");
  const star = /^export \* (?:as (\S+) )?from "([^"]+)";$/.exec(flat);
  if (star) return [{ source: star[2], name: "*", as: star[1] ?? "*" }];
  const m = /^export \{ (.*) \}(?: from "([^"]+)")?;$/.exec(flat);
  if (!m) fail(`読めない export: ${flat.slice(0, 80)}`);
  return m[1].split(", ").map((part) => {
    const p = new RegExp(`^(${ID})(?: as (${ID}))?$`).exec(part.trim());
    if (!p) fail(`読めない export の名前: ${part}`);
    return { source: m[2] ?? null, name: p[1], as: p[2] ?? p[1] };
  });
}

export const key = (o) => JSON.stringify(o);

// ---- 正規化 ----

export const stripExport = (u) => {
  const i = u.lines.indexOf(u.head);
  return u.lines.map((l, j) => (j === i ? l.replace(/^export /, "") : l));
};

/** メソッドの単位 → 移した後の関数の字（this.X の X を集める） */
export function methodAsFunction(member, thisNames) {
  const i = member.lines.indexOf(member.head);
  const out = member.lines.map((l, j) => {
    if (j < i) return l.startsWith("  ") ? l.slice(2) : l;
    let t = l.replace(new RegExp(`\\bthis\\.(${ID})`, "g"), (_, x) => {
      thisNames.add(x);
      return x;
    });
    if (j === i) t = t.replace(METHOD_HEAD, "export $1function $2(");
    return t;
  });
  out[out.length - 1] = out.at(-1).replace(/^ {2}\},/, "  }");
  return out;
}

export const same = (a, b) =>
  a.length === b.length && a.every((l, i) => l === b[i]);
/** 正規表現の記号を全部逃す（識別子を正規表現に入れるとき） */
export const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const bareRe = (n) => new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`);
/** 文字列・注釈の中でない識別子（`.` の後ろでない）の集合。字の読み方は近似（名前の検査にだけ使う） */
export const bareNames = (l) =>
  new Set(codeOnly(l).match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []);
export const codeOnly = (l) =>
  /^\s*(?:\/\/|\/?\*)/.test(l)
    ? ""
    : l
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
        .replace(/`[^`]*`/g, (t) =>
          (t.match(/\$\{[^}]*\}/g) ?? ['""']).join(" "),
        )
        .replace(/\/\/.*$/, "");

// ---- from の object ----

function asMember(u) {
  const m = METHOD_HEAD.exec(u.head);
  const short = new RegExp(`^ {2}(${ID}),$`).exec(u.head);
  const shorthand = Boolean(short) && u.lines.length === 1;
  return {
    ...u,
    name: m?.[2] ?? short?.[1] ?? null,
    method: Boolean(m),
    shorthand,
  };
}

export function serviceObject(units) {
  const objs = units.filter((u) => u.head === SERVICE_OPEN);
  if (objs.length !== 1)
    fail("supabaseDataService の object がちょうど1つでない");
  const lines = objs[0].lines;
  const i = lines.indexOf(SERVICE_OPEN);
  if (lines.at(-1) !== "};")
    fail("supabaseDataService の object の終わりが読めない");
  const members = splitUnits(lines.slice(i + 1, -1), "  ").map(asMember);
  return { unit: objs[0], lead: lines.slice(0, i + 1), members };
}

/** 委ねるだけのメソッド `  [async ]getX(a, b) {` `    return getX(a, b);` `  },` → { name, params } */
export function delegation(member) {
  const i = member.lines.indexOf(member.head);
  const m = new RegExp(`^ {2}(?:async )?(${ID})\\(([\\w$, ]*)\\) \\{$`).exec(
    member.head,
  );
  if (!m || member.lines.length !== i + 3) return null;
  const ok =
    member.lines[i + 1] === `    return ${m[1]}(${m[2]});` &&
    member.lines[i + 2] === "  },";
  return ok ? { name: m[1], params: m[2] } : null;
}

// ---- 読む ----

export function parseToFile(text) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (!MOVE_HEADER.every((re, i) => re.test(lines[i] ?? "")))
    fail("to の頭の2行が決まった注釈でない");
  const units = joinStatements(splitUnits(lines.slice(2)));
  const bad = units.find(
    (u) => !["import", "function", "value"].includes(u.kind),
  );
  if (bad) fail(`to に移す単位でない文: ${bad.head}`);
  const exports = new Set(
    units
      .filter((u) => u.name && u.head.startsWith("export "))
      .map((u) => u.name),
  );
  return { units, exports };
}

export function exportedNames(units) {
  const out = new Set();
  for (const u of units) {
    if (u.kind === "export") exportSpecs(u.text).forEach((s) => out.add(s.as));
    else if (/^export default\b/.test(u.head)) out.add("default");
    else if (u.head.startsWith("export "))
      out.add(u.name ?? new RegExp(`^export const (${ID})`).exec(u.head)?.[1]);
  }
  return out;
}
