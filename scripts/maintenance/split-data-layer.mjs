#!/usr/bin/env node
/**
 * src/services/supabaseDataService.js を領域ごとのファイルへ振り分ける（BOA-1432、BOA-1426 の 1/2）。
 *
 *   node scripts/maintenance/split-data-layer.mjs <領域…>   指定の領域のファイルを書く
 *   node scripts/maintenance/split-data-layer.mjs --report  書かずに領域ごとのメソッド・上の単位・行を数える
 *
 * - メソッド `async getX(a) { … }` → `export async function getX(a) { … }`。同じ領域・別の領域の
 *   `this.getY(` は `getY(`（別のファイルのものは名前付き import）。本体の字は変えない
 * - 上の単位（関数・定数）は字のまま。別のファイルから使われるものにだけ `export ` を足す
 * - 詰め方は元の並び順のまま、本体が 400 行を越える手前で次のファイルへ（import の行は数えない）
 * - supabaseDataService.js は全領域を指定したときだけ facade に書き換える
 *   （`export const supabaseDataService = { getX, … }` と既存の名前付き export の再 export）
 * - 変換の純関数は export してある。直に起動したときだけ main を呼ぶ
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import babel from "@babel/parser";

export const MAX_LINES = 400;
const SERVICE_NAME = "supabaseDataService";

// メソッドの振り分けの表。表に無いメソッドがあれば planSplit が止める
export const METHOD_TABLE = {
  core: [],
  schedule: [
    "getRaces",
    "getUpcomingSeries",
    "getSeriesOfDate",
    "getAvailableDates",
    "getRaceHistorySummary",
    "getVenuesWithTodaysRaces",
    "getTodaysRacesForVenue",
    "getMorningDigest",
  ],
  prediction: [
    "getPredictions",
    "getAccuracy",
    "getUnifiedModelAccuracy",
    "getUnifiedVolatilityAccuracy",
    "getInCautionAccuracy",
    "getUnifiedTrifectaReference",
  ],
  venue: [
    "getVenueTechniquePeriodStats",
    "getVenueCharacteristics",
    "getNationalAverageOutcomeDistribution",
    "getOutcomeDistribution",
    "getWinningTechniqueStats",
    "getCourseWinRateBaseline",
    "getTodaysVenueRanking",
    "getVenueDaySummary",
    "getVenueFirstWinRateRanking",
    "getTopStartStats",
    "getLosingTechniqueStats",
    "getStCourseBaseline",
    "getNigeSimulation",
    "getNigeOutcomeDistribution",
    "getExhibitionTimeTopStats",
    "getVenueGradeBoatStats",
    "getVenuesWithGradeStats",
  ],
  race: [
    "getRaceWinnerCourses",
    "getRaceEntryOfficialRatesBreakdown",
    "getRaceRacerFormBreakdown",
    "getRaceStPredictabilityBreakdown",
    "getRaceExhibitionTimeBreakdown",
    "getRaceEntryWeights",
    "getRaceExhibitionBasics",
    "getRaceRacerStats",
    "getRaceOfficialAvgSt",
    "getRaceOddsSnapshots",
    "getRaceFinalOdds",
    "getRaceEntriesDetail",
    "getRaceResultSummary",
    "getRaceRacerBoatReturnRate",
    "getRaceTechniqueProfileBreakdown",
    "getRaceStartTimings",
    "getRacePitReport",
    "getRaceOriginalExhibition",
  ],
  racer: [
    "getRacerFormTrend",
    "getRacerFormSummary",
    "getRacerTechniqueProfile",
    "getRacerAggregatedStats",
    "getRacerOfficialAvgSt",
    "getRacerAllPeriodStats",
    "getAllRacersLite",
    "getRacerGradeCache",
    "getAllRacersWithGrade",
    "getRacerVenueStats",
    "getRacerScopedRaceStats",
    "getRacerRaceHistory",
    "getRacerBoatReturnRate",
    "getStDeviationTrend",
    "getExhibitionTimeTrend",
    "getTodaysRacerFormRanking",
    "getRacerPeriodStats",
    "getRacerAccidentRecords",
  ],
  meet: [
    "getCurrentMeetFlyingBoats",
    "getRaceMeetPrevRuns",
    "getRacerMeetExhibitionTrendBefore",
    "getMeetOriginalExhibitionByRaceBoat",
    "getMeetScoreboard",
    "getMeetPage",
  ],
  motor: [
    "getRaceMotorBreakdown",
    "getRaceMotorFreshness",
    "getMotorPowerIndex",
    "getVenueMotorStats",
    "getVenueMotorSnapshot",
    "getVenueMotorRanks",
    "getVenueMotorList",
    "getMotorGenerationStart",
    "getMotorWakuStats",
    "getMotorRacerWakuStats",
    "getRaceMotorMaintenanceBreakdown",
  ],
};

// 上の単位は使うメソッドの領域から決める（1つの領域だけが使うならその領域、複数なら core）。
// 領域の間の呼び出しの先にしたいものだけここで決める
export const UNIT_AREA_OVERRIDE = {
  fetchVenueWinRateMap: "venue",
  getVenueMeetStart: "venue",
};

export const AREAS = Object.keys(METHOD_TABLE);

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

/** AST の中の識別子の名前（プロパティ名は除く。影の変数も含むので過大に拾う） */
export function collectIdentifiers(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const n of node) collectIdentifiers(n, out);
    return out;
  }
  if (!node || typeof node.type !== "string") return out;
  if (node.type === "Identifier") out.add(node.name);
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEYS.has(k)) continue;
    if (
      k === "property" &&
      !node.computed &&
      (node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression")
    ) {
      continue;
    }
    if (
      k === "key" &&
      !node.computed &&
      !node.shorthand &&
      (node.type === "ObjectProperty" ||
        node.type === "ObjectMethod" ||
        node.type === "ClassMethod" ||
        node.type === "ClassProperty")
    ) {
      continue;
    }
    if (v && typeof v === "object") collectIdentifiers(v, out);
  }
  return out;
}

export function astHash(node) {
  const json = JSON.stringify(node, (k, v) => (SKIP_KEYS.has(k) ? undefined : v));
  return createHash("sha256").update(json).digest("hex").slice(0, 12);
}

const stripLead = (s) => s.replace(/^(?:[ \t]*\n)+/, "");

// 文の後ろと同じ行にある 1 行のコメントまで、その文に含める
function lineTail(source, end) {
  const re = /[ \t]*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/)[ \t]*(?=\n|$)/y;
  re.lastIndex = end;
  const m = re.exec(source);
  return m ? end + m[0].length : end;
}

function declaredNames(decl) {
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
    return [decl.id.name];
  }
  if (decl.type === "VariableDeclaration") {
    return decl.declarations.map((d) => {
      if (d.id.type !== "Identifier") {
        throw new Error("分割代入の最上位の宣言は振り分けできない");
      }
      return d.id.name;
    });
  }
  throw new Error(`未対応の最上位の文: ${decl.type}`);
}

/** supabaseDataService.js を import・上の単位・メソッドに分ける */
export function parseService(source) {
  const ast = babel.parse(source, { sourceType: "module" });
  const imports = [];
  const units = [];
  const methods = [];
  let header = "";
  let service = null;
  let prevEnd = 0;
  for (const node of ast.program.body) {
    const end = lineTail(source, node.end);
    const raw = source.slice(prevEnd, end);
    const text = stripLead(raw);
    const declOffset = node.start - prevEnd - (raw.length - text.length);
    prevEnd = end;

    if (node.type === "ImportDeclaration") {
      if (node.specifiers.length === 0) {
        throw new Error("副作用だけの import は振り分けできない");
      }
      if (imports.length === 0) header = source.slice(0, node.start);
      imports.push({
        raw: node.source.extra.raw,
        specs: node.specifiers.map((s) => ({
          type:
            s.type === "ImportDefaultSpecifier"
              ? "default"
              : s.type === "ImportNamespaceSpecifier"
                ? "namespace"
                : "named",
          imported: s.imported ? s.imported.name : null,
          local: s.local.name,
        })),
      });
      continue;
    }

    let decl = node;
    let exported = false;
    if (node.type === "ExportNamedDeclaration") {
      if (!node.declaration || node.specifiers.length > 0) {
        throw new Error("宣言を伴わない export は振り分けできない");
      }
      decl = node.declaration;
      exported = true;
    }

    const isService =
      exported &&
      decl.type === "VariableDeclaration" &&
      decl.declarations.length === 1 &&
      decl.declarations[0].id.name === SERVICE_NAME;
    if (isService) {
      const obj = decl.declarations[0].init;
      if (!obj || obj.type !== "ObjectExpression") {
        throw new Error(`${SERVICE_NAME} が object ではない`);
      }
      service = { start: node.start, end };
      let prevM = obj.start + 1;
      for (const prop of obj.properties) {
        if (
          prop.type !== "ObjectMethod" ||
          prop.kind !== "method" ||
          prop.computed ||
          prop.key.type !== "Identifier"
        ) {
          throw new Error(`メソッドでない項目がある（${prop.type}）`);
        }
        const comma = /\s*,/y;
        comma.lastIndex = prop.end;
        const cm = comma.exec(source);
        methods.push({
          name: prop.key.name,
          prefix: stripLead(source.slice(prevM, prop.start)),
          body: source.slice(prop.start, prop.end),
          start: prop.start,
          node: prop,
        });
        prevM = cm ? prop.end + cm[0].length : prop.end;
      }
      continue;
    }

    units.push({
      names: declaredNames(decl),
      text,
      declOffset,
      exported,
      start: node.start,
      node,
    });
  }
  if (!service) throw new Error(`${SERVICE_NAME} の object が見つからない`);
  return { header, imports, units, methods, service };
}

/** `async getX(a) {…}` の頭を `export async function getX(a) {…}` にする */
export function methodToFunction(body, name) {
  const m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(body);
  if (!m || m[2] !== name) throw new Error(`メソッドの頭が読めない: ${name}`);
  return `export ${m[1] ? "async " : ""}function ${name}(${body.slice(m[0].length)}`;
}

/** `this.getY` → `getY`。メソッドでないものを指していれば止める */
export function replaceThis(text, methodNames) {
  return text.replace(/\bthis\.([A-Za-z_$][\w$]*)/g, (all, n) => {
    if (!methodNames.has(n)) throw new Error(`this.${n} は振り分けできない`);
    return n;
  });
}

/** 同じ名前の上の単位を呼ぶだけのメソッドか */
export function isDelegation(body, name) {
  return new RegExp(
    `^(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+${name}\\([^)]*\\);?\\s*\\}$`,
  ).test(body);
}

/** メソッド名 → 領域。表に無いメソッドがあれば止める */
export function assignMethodAreas(names, table = METHOD_TABLE) {
  const map = new Map();
  for (const [area, list] of Object.entries(table)) {
    for (const n of list) map.set(n, area);
  }
  const missing = names.filter((n) => !map.has(n));
  if (missing.length > 0) {
    throw new Error(`表に無いメソッド: ${missing.join(", ")}`);
  }
  return new Map(names.map((n) => [n, map.get(n)]));
}

/** 並び順のまま、maxLines を越える手前で次のグループへ（items は lines を持つ） */
export function packItems(items, maxLines = MAX_LINES) {
  const groups = [];
  let cur = [];
  let lines = 0;
  for (const it of items) {
    if (cur.length > 0 && lines + it.lines > maxLines) {
      groups.push(cur);
      cur = [];
      lines = 0;
    }
    cur.push(it);
    lines += it.lines;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export function fileNameOf(area, index) {
  if (area === "core") return index === 0 ? "coreCache" : `coreFetch${index === 1 ? "" : index + 1}`;
  return index === 0 ? `${area}Queries` : `${area}Queries${index + 1}`;
}

function renderImport(imp, used) {
  const sp = imp.specs.filter((s) => used.has(s.local));
  if (sp.length === 0) return null;
  const def = sp.find((s) => s.type === "default");
  const ns = sp.find((s) => s.type === "namespace");
  const named = sp
    .filter((s) => s.type === "named")
    .map((s) => (s.imported === s.local ? s.local : `${s.imported} as ${s.local}`));
  const parts = [];
  if (def) parts.push(def.local);
  if (ns) parts.push(`* as ${ns.local}`);
  if (named.length > 0) parts.push(`{ ${named.join(", ")} }`);
  return `import ${parts.join(", ")} from ${imp.raw};`;
}

/** ファイルの間の import の循環を 1 つ返す（無ければ null） */
export function findCycle(edges) {
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const c = visit(m);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of edges.keys()) {
    if (!state.has(n)) {
      const c = visit(n);
      if (c) return c;
    }
  }
  return null;
}

/** 全体の計画。ファイルの中身・facade・対応表・領域ごとの数を返す */
export function planSplit(
  source,
  { table = METHOD_TABLE, maxLines = MAX_LINES, unitArea = UNIT_AREA_OVERRIDE } = {},
) {
  const parsed = parseService(source);
  const methodNames = new Set(parsed.methods.map((m) => m.name));
  const methodArea = assignMethodAreas([...methodNames], table);
  const unitNames = new Set(parsed.units.flatMap((u) => u.names));

  const items = [];
  const delegates = [];
  for (const u of parsed.units) {
    items.push({
      kind: "unit",
      name: u.names[0],
      names: u.names,
      text: u.text,
      declOffset: u.declOffset,
      exported: u.exported,
      start: u.start,
      idents: collectIdentifiers(u.node),
      hash: astHash(u.node),
    });
  }
  for (const m of parsed.methods) {
    if (unitNames.has(m.name)) {
      if (!isDelegation(m.body, m.name)) {
        throw new Error(`メソッドと上の単位の名前が衝突: ${m.name}`);
      }
      delegates.push({ name: m.name, hash: astHash(m.node), start: m.start });
      continue;
    }
    const idents = collectIdentifiers(m.node);
    for (const t of m.body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)/g)) idents.add(t[1]);
    const text =
      m.prefix + methodToFunction(replaceThis(m.body, methodNames), m.name);
    items.push({
      kind: "method",
      name: m.name,
      names: [m.name],
      text,
      start: m.start,
      area: methodArea.get(m.name),
      idents,
      hash: astHash(m.node),
    });
  }
  for (const it of items) it.lines = it.text.split("\n").length;

  const defined = new Set(items.flatMap((i) => i.names));
  for (const it of items) {
    it.refs = new Set(
      [...it.idents].filter((n) => defined.has(n) && !it.names.includes(n)),
    );
  }

  // 上の単位の領域: 使うメソッドの領域（単位を経由する使い方も含む）
  const unitItems = new Map();
  for (const it of items) {
    if (it.kind === "unit") for (const n of it.names) unitItems.set(n, it);
  }
  const userAreas = new Map(items.filter((i) => i.kind === "unit").map((i) => [i, new Set()]));
  const areasOf = (it) =>
    it.kind === "method"
      ? [it.area]
      : unitArea[it.name]
        ? [unitArea[it.name]]
        : [...userAreas.get(it)];
  for (let changed = true; changed; ) {
    changed = false;
    for (const it of items) {
      for (const r of it.refs) {
        const target = unitItems.get(r);
        if (!target) continue;
        for (const a of areasOf(it)) {
          if (!userAreas.get(target).has(a)) {
            userAreas.get(target).add(a);
            changed = true;
          }
        }
      }
    }
  }
  for (const it of items) {
    if (it.kind !== "unit") continue;
    const s = userAreas.get(it);
    it.area = unitArea[it.name] ?? (s.size === 1 ? [...s][0] : "core");
  }

  // 領域ごとに詰める
  const areaNames = ["core", ...Object.keys(table).filter((a) => a !== "core")];
  const owner = new Map();
  const files = [];
  for (const area of areaNames) {
    const its = items.filter((i) => i.area === area).sort((a, b) => a.start - b.start);
    packItems(its, maxLines).forEach((group, idx) => {
      const file = { name: fileNameOf(area, idx), area, items: group };
      files.push(file);
      for (const it of group) for (const n of it.names) owner.set(n, file.name);
    });
  }
  for (const d of delegates) d.file = owner.get(d.name);

  // 別のファイルから使われる単位には export を足す
  const needExport = new Set(delegates.map((d) => d.name));
  for (const f of files) {
    for (const it of f.items) {
      for (const r of it.refs) {
        if (owner.get(r) !== f.name && unitItems.has(r)) needExport.add(r);
      }
    }
  }

  const edges = new Map(files.map((f) => [f.name, new Set()]));
  for (const f of files) {
    const used = new Set();
    for (const it of f.items) for (const n of it.idents) used.add(n);
    const byFile = new Map();
    for (const it of f.items) {
      for (const r of it.refs) {
        const o = owner.get(r);
        if (o === f.name) continue;
        if (!byFile.has(o)) byFile.set(o, new Set());
        byFile.get(o).add(r);
        edges.get(f.name).add(o);
      }
    }
    const lines = [`// split-data-layer.mjs が ${SERVICE_NAME}.js から移した（領域: ${f.area}）`, ""];
    for (const imp of parsed.imports) {
      const line = renderImport(imp, used);
      if (line) lines.push(line);
    }
    for (const [o, names] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`import { ${[...names].sort().join(", ")} } from "./${o}.js";`);
    }
    const body = f.items.map((it) =>
      it.kind === "unit" && !it.exported && it.names.some((n) => needExport.has(n))
        ? `${it.text.slice(0, it.declOffset)}export ${it.text.slice(it.declOffset)}`
        : it.text,
    );
    f.content = `${lines.join("\n")}\n\n${body.join("\n\n")}\n`;
  }

  // facade: 元の並び順のメソッドと、既存の名前付き export の再 export
  const members = [
    ...items.filter((i) => i.kind === "method"),
    ...delegates,
  ].sort((a, b) => a.start - b.start);
  const importsByFile = new Map();
  for (const m of members) {
    const o = owner.get(m.name);
    if (!importsByFile.has(o)) importsByFile.set(o, []);
    importsByFile.get(o).push(m.name);
  }
  const reexports = new Map();
  for (const u of parsed.units) {
    if (!u.exported) continue;
    const o = owner.get(u.names[0]);
    if (!reexports.has(o)) reexports.set(o, []);
    reexports.get(o).push(...u.names);
  }
  const facade = [
    parsed.header.trimEnd(),
    "",
    ...[...importsByFile].map(([o, ns]) => `import { ${ns.join(", ")} } from "./${o}.js";`),
    "",
    ...[...reexports].map(([o, ns]) => `export { ${ns.join(", ")} } from "./${o}.js";`),
    "",
    `export const ${SERVICE_NAME} = {`,
    ...members.map((m) => `  ${m.name},`),
    "};",
    "",
  ].join("\n");

  const mapping = [
    ...items.map((i) => ({ kind: i.kind === "unit" ? "単位" : "メソッド", name: i.name, file: owner.get(i.name), area: i.area, hash: i.hash })),
    ...delegates.map((d) => ({ kind: "委譲", name: d.name, file: d.file, area: files.find((f) => f.name === d.file).area, hash: d.hash })),
  ];
  const summary = areaNames.map((area) => {
    const fs = files.filter((f) => f.area === area);
    const its = fs.flatMap((f) => f.items);
    return {
      area,
      methods: its.filter((i) => i.kind === "method").length,
      units: its.filter((i) => i.kind === "unit").length,
      lines: its.reduce((n, i) => n + i.lines, 0),
      files: fs.length,
    };
  });
  return { files, facade, mapping, summary, cycle: findCycle(edges) };
}

export function main(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const areas = argv.filter((a) => !a.startsWith("--"));
  const report = flags.includes("--report");
  if (flags.some((f) => f !== "--report")) throw new Error(`知らない旗: ${flags.join(" ")}`);
  const bad = areas.filter((a) => !AREAS.includes(a));
  if (bad.length > 0) throw new Error(`知らない領域: ${bad.join(", ")}（${AREAS.join("・")}）`);
  if (!report && areas.length === 0) {
    throw new Error(`使い方: split-data-layer.mjs <領域…> | --report（領域: ${AREAS.join("・")}）`);
  }

  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/services");
  const servicePath = path.join(dir, `${SERVICE_NAME}.js`);
  const plan = planSplit(readFileSync(servicePath, "utf8"));

  if (report) {
    for (const s of plan.summary) {
      console.log(`${s.area}\tメソッド ${s.methods}\t単位 ${s.units}\t行 ${s.lines}\tファイル ${s.files}`);
    }
    console.log(plan.cycle ? `import の循環: ${plan.cycle.join(" → ")}` : "import の循環: なし");
    return;
  }

  const target = areas.length === 0 ? AREAS : areas;
  for (const f of plan.files.filter((x) => target.includes(x.area))) {
    writeFileSync(path.join(dir, `${f.name}.js`), f.content);
  }
  if (AREAS.every((a) => target.includes(a))) {
    writeFileSync(servicePath, plan.facade);
  } else {
    console.error(`全領域を指定していないので ${SERVICE_NAME}.js は書き換えない`);
  }
  for (const m of plan.mapping.filter((x) => target.includes(x.area))) {
    console.log(`${m.kind}\t${m.name}\t${m.file}.js\t${m.hash}`);
  }
  if (plan.cycle) console.error(`import の循環: ${plan.cycle.join(" → ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
