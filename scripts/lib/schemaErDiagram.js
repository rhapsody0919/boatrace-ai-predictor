/**
 * schemaErDiagram.js — 本番スキーマの写し（docs/reference/schema-snapshot.json、ADR-0102）から、
 * DB 全体の ER 図（mermaid の erDiagram）を機能のまとまりごとに組み立てる。DB に触れない純関数だけ。
 *
 * 生成の入口は scripts/maintenance/generate-schema-er-diagram.js、検査は verify-schema-er-diagram.js。
 * 線の描き方は個別機能の ER 図（erDiagramFromDdl.js の buildMermaidErDiagram）と共通。
 *
 * 写しを入力にする理由: docs/db-migration/ の DDL を積み上げると DROP・RENAME を追えず、
 * 今は無い表が混ざる（.claude/rules/sdd-workflow.md、database-design.md の旧「テーブル関係図」）。
 */
import { buildMermaidErDiagram } from "./erDiagramFromDdl.js";

export const ER_DIAGRAM_FILE = "docs/reference/schema-er-diagram.md";

/**
 * まとまりの決め方。上から順に当て、最初に当たったまとまりに入れる（1つの表は1つのまとまりだけ）。
 * どれにも当たらない表は「その他」に入れる（落とさない）。名前の付け方で分けるので、
 * 新しい表がその他に入ったら、ここに1行足す。
 * @type {ReadonlyArray<{ id: string, title: string, test: (name: string) => boolean }>}
 */
export const DOMAINS = Object.freeze([
  {
    id: "sns",
    title: "SNS 配信",
    test: (n) => n.startsWith("sns_"),
  },
  {
    id: "racer",
    title: "選手",
    test: (n) => n.startsWith("racer_"),
  },
  {
    id: "prediction",
    title: "予想・モデル・類似レース",
    test: (n) =>
      /^(predictions|prediction_odds|models|accuracy_cache|daily_bet_summary|user_visible_summary|external_predictions)$/.test(
        n,
      ) || /^(model_|bet_|analogy_|v_)|_predictions$/.test(n),
  },
  {
    id: "ops",
    title: "取得・運用",
    test: (n) =>
      /^(scrape_|fetch_counts|kb_archive_)/.test(n) ||
      /^(raw_snapshots|race_notices_health)$/.test(n),
  },
  {
    id: "aggregate",
    title: "集計（会場・枠・技・当日のまとめ）",
    test: (n) =>
      /(_stats|_distribution|_baseline|_by_course|_frequencies|_cache|_daily|_start_dates)$/.test(
        n,
      ) || n.startsWith("morning_digest_"),
  },
  {
    id: "race",
    title: "レース・会場",
    test: (n) =>
      /^(races|venues|venue_rules|rule_applications|exhibition_data)$/.test(
        n,
      ) || n.startsWith("race_"),
  },
]);

const OTHER = Object.freeze({ id: "other", title: "その他" });

/** @param {string} name */
export function domainOf(name) {
  return DOMAINS.find((d) => d.test(name)) ?? OTHER;
}

/** "public.races" → "races"（写しは public だけ。他のスキーマは . を _ にして残す） */
function bareName(qualified) {
  return qualified.startsWith("public.")
    ? qualified.slice("public.".length)
    : qualified.replace(/\./g, "_");
}

/** mermaid の属性の型は空白・括弧・カンマを書けないので、英数字と _ だけにする */
export function mermaidType(type) {
  return (
    String(type || "text")
      .replace(/\[\]$/, "_array")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "text"
  );
}

/**
 * 外部キー1本を線にする。子の側は、外部キーの列がちょうど主キーか一意の制約なら1（|o）、そうでなければ多（}o）。
 * 親の側は、外部キーの列が全部 NOT NULL なら必ず1（||）、NULL を許す列があれば0か1（o|）。
 */
export function relationshipOf(relation, fk) {
  const cols = fk.columns;
  const sameSet = (a) =>
    a.length === cols.length && a.every((c) => cols.includes(c));
  const unique = relation.constraints.some(
    (c) =>
      (c.type === "primary_key" || c.type === "unique") && sameSet(c.columns),
  );
  const nullable = cols.some(
    (c) => relation.columns.find((col) => col.name === c)?.notNull !== true,
  );
  const fromColumn = cols.join(", ");
  const toColumn = (fk.referencesColumns ?? []).join(", ");
  return {
    fromTable: relation.name,
    toTable: bareName(fk.references),
    fromColumn,
    toColumn: toColumn || fromColumn,
    fromCardinality: unique ? "|o" : "}o",
    toCardinality: nullable ? "o|" : "||",
    constraint: fk.name,
  };
}

/** 図に出す列: 主キー・外部キー・一意の列だけ（全列は表に数だけ出す。最大 137 列の表があり、全部描くと読めない） */
function keyColumns(relation) {
  const marks = new Map();
  const add = (col, mark) => {
    const list = marks.get(col) ?? [];
    if (!list.includes(mark)) list.push(mark);
    marks.set(col, list);
  };
  for (const c of relation.constraints) {
    const mark =
      c.type === "primary_key"
        ? "PK"
        : c.type === "foreign_key"
          ? "FK"
          : c.type === "unique"
            ? "UK"
            : null;
    if (mark) for (const col of c.columns) add(col, mark);
  }
  const order = { PK: 0, FK: 1, UK: 2 };
  return relation.columns
    .filter((col) => marks.has(col.name))
    .map((col) => ({
      name: col.name,
      type: mermaidType(col.type),
      keys: marks.get(col.name).sort((a, b) => order[a] - order[b]),
    }));
}

/**
 * 写しから、まとまりごとの図の材料を作る。並びは名前の順（写しの並びに依らない）。
 * @returns {{ domains: Array<{ id: string, title: string, relations: object[], relationships: object[],
 *   outside: Array<{ name: string, domain: string }> }>, relationships: object[], counts: object }}
 */
export function buildSchemaEr(snapshot) {
  const relations = [...snapshot.relations].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const byName = new Map(relations.map((r) => [r.name, r]));
  const relationships = relations
    .flatMap((r) =>
      r.constraints
        .filter((c) => c.type === "foreign_key")
        .map((fk) => relationshipOf(r, fk)),
    )
    .sort((a, b) =>
      `${a.fromTable}\0${a.constraint}` < `${b.fromTable}\0${b.constraint}`
        ? -1
        : 1,
    );
  const domainIds = [...DOMAINS.map((d) => d.id), OTHER.id];
  const titleOf = new Map([...DOMAINS, OTHER].map((d) => [d.id, d.title]));
  const domainOfName = (name) => domainOf(name).id;
  const domains = domainIds
    .map((id) => {
      const own = relations.filter((r) => domainOfName(r.name) === id);
      const ownNames = new Set(own.map((r) => r.name));
      const touching = relationships.filter(
        (rel) => ownNames.has(rel.fromTable) || ownNames.has(rel.toTable),
      );
      const outsideNames = [
        ...new Set(
          touching
            .flatMap((rel) => [rel.fromTable, rel.toTable])
            .filter((n) => !ownNames.has(n)),
        ),
      ].sort();
      return {
        id,
        title: titleOf.get(id),
        relations: own,
        relationships: touching,
        outside: outsideNames.map((name) => ({
          name,
          domain: byName.has(name)
            ? titleOf.get(domainOfName(name))
            : "写しに無い",
        })),
      };
    })
    .filter((d) => d.relations.length > 0);
  return {
    domains,
    relationships,
    counts: {
      relations: relations.length,
      tables: relations.filter((r) => r.kind === "table").length,
      views: relations.filter((r) => r.kind === "view").length,
      foreignKeys: relationships.length,
      crossDomain: relationships.filter(
        (rel) =>
          byName.has(rel.toTable) &&
          domainOfName(rel.fromTable) !== domainOfName(rel.toTable),
      ).length,
      other: relations.filter((r) => domainOfName(r.name) === OTHER.id).length,
    },
  };
}

function primaryKeyOf(relation) {
  return (
    relation.constraints.find((c) => c.type === "primary_key")?.columns ?? []
  );
}

/** まとまり1つの mermaid 本文（```mermaid の行は含まない） */
export function renderDomainDiagram(domain) {
  const tables = domain.relations.map((r) => ({
    name: r.name,
    columns: keyColumns(r),
  }));
  const body = buildMermaidErDiagram({
    tables,
    relationships: domain.relationships,
  });
  // 線も鍵の列も無い表は、buildMermaidErDiagram が出さないので名前だけ足す（図から落とさない）
  const drawn = new Set(
    domain.relationships.flatMap((rel) => [rel.fromTable, rel.toTable]),
  );
  const bare = tables
    .filter((t) => t.columns.length === 0 && !drawn.has(t.name))
    .map((t) => `    ${t.name}`);
  return [body, ...bare].join("\n");
}

/** md 全体。入力（写し）が同じなら同じ文字列を返す（生成の時刻を入れない） */
export function renderSchemaErMarkdown(snapshot) {
  const er = buildSchemaEr(snapshot);
  const lines = [
    "# DB 全体の ER 図",
    "",
    "> 機械生成（`node scripts/maintenance/generate-schema-er-diagram.js`）。手で書き換えない。master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す。PR には含めない（ADR-0078）。",
    ">",
    `> 入力: 本番スキーマの写し \`docs/reference/schema-snapshot.json\`（取得 ${snapshot.capturedAt}、適用済みの番号の最大 ${snapshot.appliedThrough}、ADR-0102）。DB には接続しない。写しが古いと図も古い。写しの作り直しは写しの \`$comment\` を見る。`,
    ">",
    "> 図に出す列は主キー（PK）・外部キー（FK）・一意（UK）の列だけ。全部の列・型・権限は写しを、読み手・書き手は `docs/reference/data-readers.md` を見る。個別機能の新しい表の図は各 `docs/design/{slug}/plan.md`（`generate-er-diagram.js {slug}`、DDL から）。",
    "",
    "線の端の記号: 子の側 `}o` は多、`|o` は外部キーの列がそのまま主キーか一意（1対1）。親の側 `||` は外部キーの列が NOT NULL、`o|` は NULL を許す。",
    "",
    "## 件数",
    "",
    "| 項目 | 件数 |",
    "|---|---|",
    `| 表 | ${er.counts.tables} |`,
    `| ビュー | ${er.counts.views} |`,
    `| 外部キー | ${er.counts.foreignKeys} |`,
    `| まとまりをまたぐ外部キー | ${er.counts.crossDomain} |`,
    `| どのまとまりにも当たらない表（その他） | ${er.counts.other} |`,
    "",
    "まとまりは表の名前で決める（`scripts/lib/schemaErDiagram.js` の `DOMAINS`、上から順に最初に当たったもの）。その他に入った表は、そこに1行足して分ける。",
    "",
    "## まとまりの一覧",
    "",
    "| まとまり | 表・ビュー | 外部キー（まとまりの中か、外と結ぶもの） |",
    "|---|---|---|",
    ...er.domains.map(
      (d) =>
        `| [${d.title}](#d-${d.id}) | ${d.relations.length} | ${d.relationships.length} |`,
    ),
  ];
  for (const d of er.domains) {
    lines.push(
      "",
      `## <a id="d-${d.id}"></a>${d.title}`,
      "",
      "| 表 | 種類 | 列 | 主キー | RLS |",
      "|---|---|---|---|---|",
      ...d.relations.map(
        (r) =>
          `| ${r.name} | ${r.kind} | ${r.columns.length} | ${primaryKeyOf(r).join(", ") || "—"} | ${r.kind === "view" ? "—" : r.rlsEnabled ? "有効" : "無効"} |`,
      ),
    );
    if (d.outside.length) {
      lines.push(
        "",
        `他のまとまりの表（図では列を出さない）: ${d.outside.map((o) => `${o.name}（${o.domain}）`).join("、")}`,
      );
    }
    lines.push("", "```mermaid", renderDomainDiagram(d), "```");
  }
  return `${lines.join("\n")}\n`;
}
