#!/usr/bin/env node
/**
 * verify-schema-er-diagram.js — DB 全体の ER 図（docs/reference/schema-er-diagram.md）の組み立てを検査する。
 *
 * 組み立て（scripts/lib/schemaErDiagram.js）が壊れると、図が黙って薄くなる（表・外部キーが落ちる、
 * 線の向き・多重度を取り違える）。固定の入力で1つずつ確かめ、続けて今の写しで、全部の表が
 * ちょうど1つのまとまりに入ること、全部の外部キーが図に出ること、写しの並びに依らず同じ md になること、
 * mermaid の行の形が崩れていないことを確かめる。DB に触れない、書き込まない。
 *
 * コミット済みの図と今の写しの一致は見ない。図は機械生成の文書（generated-docs.js の GENERATED_DOCS）で、
 * PR には含めず、master へのマージ後に regenerate-generated-docs.yml が作り直す（ADR-0078）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMermaidErDiagram } from "../lib/erDiagramFromDdl.js";
import {
  DOMAINS,
  buildSchemaEr,
  domainOf,
  mermaidType,
  relationshipOf,
  renderDomainDiagram,
  renderSchemaErMarkdown,
} from "../lib/schemaErDiagram.js";
import { SNAPSHOT_FILE } from "../lib/schemaSnapshot.js";
import { generate } from "./generate-schema-er-diagram.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// --- 固定の入力 ---
const col = (name, notNull = true) => ({ name, type: "text", notNull });
const pk = (...columns) => ({ type: "primary_key", columns, name: "pk" });
const fk = (columns, references, referencesColumns = columns) => ({
  type: "foreign_key",
  columns,
  references,
  referencesColumns,
  name: `fk_${columns.join("_")}`,
});

// 多対1・NOT NULL
const child = {
  name: "race_entries",
  kind: "table",
  rlsEnabled: true,
  columns: [col("race_id"), col("boat_number")],
  constraints: [pk("race_id", "boat_number"), fk(["race_id"], "public.races")],
};
check(
  "多対1・NOT NULL は }o--||",
  (({ fromCardinality, toCardinality }) => [fromCardinality, toCardinality])(
    relationshipOf(child, child.constraints[1]),
  ),
  ["}o", "||"],
);
// 外部キーの列がそのまま主キー → 1対1
const oneToOne = {
  name: "race_results",
  kind: "table",
  columns: [col("race_id")],
  constraints: [pk("race_id"), fk(["race_id"], "public.races")],
};
check(
  "外部キーの列が主キーなら |o",
  relationshipOf(oneToOne, oneToOne.constraints[1]).fromCardinality,
  "|o",
);
// 一意の制約でも1対1
const uniq = {
  name: "sns_post_tracking",
  kind: "table",
  columns: [col("id"), col("draft_id")],
  constraints: [
    pk("id"),
    { type: "unique", columns: ["draft_id"], name: "u" },
    fk(["draft_id"], "public.sns_drafts", ["id"]),
  ],
};
const uniqRel = relationshipOf(uniq, uniq.constraints[2]);
check("一意の制約なら |o", uniqRel.fromCardinality, "|o");
check(
  "列の名前が違うと矢印で並べる（DDL 版と同じ書き方）",
  buildMermaidErDiagram({ tables: [], relationships: [uniqRel] }).split(
    "\n",
  )[1],
  '    sns_post_tracking |o--|| sns_drafts : "draft_id -> id"',
);
// NULL を許す外部キー → 親の側は o|
const nullable = {
  name: "bet_recommendations",
  kind: "table",
  columns: [col("race_id"), col("filter_id", false)],
  constraints: [pk("race_id"), fk(["filter_id"], "public.bet_filters")],
};
check(
  "NULL を許す外部キーは o|",
  relationshipOf(nullable, nullable.constraints[1]).toCardinality,
  "o|",
);
// 複合の外部キーの一部だけが主キー → 多
const partial = {
  name: "x",
  kind: "table",
  columns: [col("a"), col("b")],
  constraints: [pk("a"), fk(["a", "b"], "public.y")],
};
check(
  "複合の外部キーが主キーと違う集合なら }o",
  relationshipOf(partial, partial.constraints[1]).fromCardinality,
  "}o",
);
check(
  "public の外の表は . を _ に",
  relationshipOf(
    { ...child, constraints: [fk(["race_id"], "auth.users")] },
    fk(["race_id"], "auth.users"),
  ).toTable,
  "auth_users",
);

// DDL 版（generate-er-diagram.js {slug}）の書き方は、任意の欄を足す前と同じ
check(
  "DDL 版: 欄が無ければ }o--|| と isPk の PK",
  buildMermaidErDiagram({
    tables: [
      {
        name: "a",
        columns: [
          { name: "id", type: "uuid", isPk: true },
          { name: "b_id", type: "uuid" },
        ],
      },
    ],
    relationships: [
      { fromTable: "a", toTable: "b", fromColumn: "b_id", toColumn: "b_id" },
    ],
  }).split("\n"),
  [
    "erDiagram",
    '    a }o--|| b : "b_id"',
    "    a {",
    "        uuid id PK",
    "        uuid b_id",
    "    }",
  ],
);

// 型は mermaid の属性に書ける形
check(
  "型: 括弧と空白",
  mermaidType("character varying(20)"),
  "character_varying_20",
);
check("型: 配列", mermaidType("text[]"), "text_array");
check("型: カンマ", mermaidType("numeric(5,4)"), "numeric_5_4");
check("型: 空は text", mermaidType(""), "text");

// まとまりは上から順に最初に当たったもの
check("まとまり: sns_", domainOf("sns_drafts").id, "sns");
check(
  "まとまり: racer_ は選手（_stats でも）",
  domainOf("racer_period_stats").id,
  "racer",
);
check("まとまり: predictions", domainOf("predictions").id, "prediction");
check(
  "まとまり: *_predictions",
  domainOf("poirot_predictions").id,
  "prediction",
);
check("まとまり: ビュー v_", domainOf("v_production_models").id, "prediction");
check(
  "まとまり: race_notices_health は取得・運用",
  domainOf("race_notices_health").id,
  "ops",
);
check(
  "まとまり: race_history_cache は集計",
  domainOf("race_history_cache").id,
  "aggregate",
);
check("まとまり: race_entries はレース", domainOf("race_entries").id, "race");
check("まとまり: 当たらない名前はその他", domainOf("zzz").id, "other");
check(
  "まとまりの id が重ならない",
  new Set(DOMAINS.map((d) => d.id)).size,
  DOMAINS.length,
);

// 線も鍵の列も無い表（ビュー等）を図から落とさない
const lone = renderDomainDiagram({
  relations: [
    { name: "v_x", kind: "view", columns: [col("a")], constraints: [] },
  ],
  relationships: [],
});
check("線も鍵も無い表は名前だけ出す", lone.split("\n"), [
  "erDiagram",
  "    v_x",
]);

// --- 今の写し ---
const snapshot = JSON.parse(
  readFileSync(path.join(ROOT, SNAPSHOT_FILE), "utf8"),
);
const er = buildSchemaEr(snapshot);
const placed = er.domains.flatMap((d) => d.relations.map((r) => r.name));
check(
  "全部の表・ビューがまとまりに入る（数）",
  placed.length,
  snapshot.relations.length,
);
check("1つの表は1つのまとまりだけ", placed.length, new Set(placed).size);
const fkCount = snapshot.relations.reduce(
  (n, r) => n + r.constraints.filter((c) => c.type === "foreign_key").length,
  0,
);
check("全部の外部キーが線になる", er.relationships.length, fkCount);

const md = renderSchemaErMarkdown(snapshot);
const diagrams = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(
  (m) => m[1],
);
check("まとまりごとに図が1つ", diagrams.length, er.domains.length);
// 外部キーは、子の表のまとまりの図に必ず出る
for (const rel of er.relationships) {
  const d = er.domains.find((x) =>
    x.relations.some((r) => r.name === rel.fromTable),
  );
  const idx = er.domains.indexOf(d);
  const line = `    ${rel.fromTable} ${rel.fromCardinality}--${rel.toCardinality} ${rel.toTable} :`;
  if (!diagrams[idx]?.includes(line)) {
    failures.push(`外部キー ${rel.constraint} が ${d?.title} の図に無い`);
  }
  checked += 1;
}
// 全部の表の名前が、自分のまとまりの図に出る
er.domains.forEach((d, i) => {
  for (const r of d.relations) {
    checked += 1;
    if (!new RegExp(`(^|\\s)${r.name}(\\s|$)`, "m").test(diagrams[i])) {
      failures.push(`${r.name} が ${d.title} の図に無い`);
    }
  }
});
// mermaid の行の形（関係・属性の塊の開閉・属性・名前だけ）。mermaid の解析器は入れていないので、行の形だけ見る
const lineForms = [
  /^erDiagram$/,
  /^ {4}[A-Za-z_][A-Za-z0-9_]* (\}o|\|o)--(\|\||o\|) [A-Za-z_][A-Za-z0-9_]* : "[^"]+"$/,
  /^ {4}[A-Za-z_][A-Za-z0-9_]* \{$/,
  /^ {8}[A-Za-z_][A-Za-z0-9_]* [A-Za-z_][A-Za-z0-9_]*( (PK|FK|UK)(, (PK|FK|UK))*)?$/,
  /^ {4}\}$/,
  /^ {4}[A-Za-z_][A-Za-z0-9_]*$/,
];
for (const body of diagrams) {
  for (const line of body.trimEnd().split("\n")) {
    checked += 1;
    if (!lineForms.some((re) => re.test(line))) {
      failures.push(`mermaid の行の形が崩れている: ${JSON.stringify(line)}`);
    }
  }
}
// 写しの並びに依らない
const shuffled = {
  ...snapshot,
  relations: [...snapshot.relations].reverse().map((r) => ({
    ...r,
    constraints: [...r.constraints].reverse(),
  })),
};
check(
  "写しの並びに依らず同じ md",
  renderSchemaErMarkdown(shuffled) === md,
  true,
);
// 生成の入口が今のリポジトリで動く（書き込まない）
check("generate() が同じ md を返す", generate().md === md, true);

if (failures.length) {
  console.error(
    `verify-schema-er-diagram: ${failures.length} 件の失敗（${checked} 件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`verify-schema-er-diagram: ${checked} 件すべて通過`);
