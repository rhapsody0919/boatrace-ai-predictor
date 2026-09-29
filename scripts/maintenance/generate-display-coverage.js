#!/usr/bin/env node
/**
 * 表示カバレッジ台帳を、マイグレーションと src/ から機械生成する。
 *
 * ## なぜ要るか
 *
 * プロジェクトのゴールは「公式サイト（boatrace.jp）・各会場の公式サイト・ボートレース日和で
 * 取得しているデータを全て表示できるようにする」ことだが、2026-09-28に棚卸ししたところ、
 * **表示側の到達度を追跡する文書が1つも無かった**。取得側には棚卸しマップが3本ある
 * （docs/design/scraping-vercel-consolidation/ の data-catalog.md・job-inventory.md・
 * orchestration.md）のに、表示側は docs/design/scraping-full-coverage/spec.md が
 * 「データの見せ方（UI）は完全に対象外」と明記していて、対応する文書が意図的に作られていない。
 *
 * その結果、次が長く気づかれずに残った（2026-09-28実測）。
 *   - 取得しているのに画面から読む箇所が無いテーブル（`venue_entry_course_stats`・`prediction_odds`）
 *   - 匿名SELECT権限が無いため画面から読めない新規取得テーブル（FR-4が使いたい7本）
 *   - Linearの子チケットが実態より古い（今節成績タブは実装済みなのに Backlog のまま）
 *
 * 手で書いた台帳では同じことが起きる。取得側は台帳を持っていたのに、
 * orchestration.md 自身が「WS4bが『未着手』のままだが実際には21ジョブがliveで稼働していた。
 * **この乖離自体が、オーケストレーションの記録として直すべき点**」と書いている。
 * そこでER図（generate-er-diagram.js）・共通ロジック索引（generate-lib-index.js）と同じく
 * **ソースから生成する**方式にする。生成物はPRに含めず、masterへのマージ後に
 * regenerate-generated-docs.yml が作り直してコミットする（ADR-0078。PRに含めると、
 * 並行するPRが同じファイルでコンフリクトするため）。
 *
 * ## 何を見るか
 *
 * 外部ネットワーク・実DB・実時刻に依存しない静的な突き合わせだけを行う（CIに載せるため）。
 *   1. `docs/db-migration/*.sql` から、テーブル・ビューの定義を集める
 *   2. `src/` から `.from("…")` と `.rpc("…")` を集め、どのテーブルが画面から読まれているかを判定する
 *      （RPC経由の場合は、そのRPCの本体が参照しているテーブルを辿る）
 *   3. 匿名（anon）へのSELECT権限の記述が、マイグレーションにあるかを見る
 *
 * **本番DBの実際の権限は見ない。** マイグレーションが適用済みかどうかは別問題で、
 * それは scripts/maintenance/check-anon-access.js（実接続・manual tier）の担当。
 * 本スクリプトが答えるのは「リポジトリ上の意図として、取得したデータが画面に繋がっているか」。
 *
 * ## 判定しないこと
 *
 * 「そのテーブルを**表示すべきか**」は判定しない。取得だけが目的のもの（検証用・学習用・
 * アーカイブ）もあるため、意図的に表示しないものは display-coverage-exceptions.json に
 * 理由付きで登録し、生成物にその理由が出るようにしている。
 *
 * 使い方: node scripts/maintenance/generate-display-coverage.js [--dry-run]
 *   --dry-run: 生成と例外登録の検査までを行い、書き込まない（verify-display-coverage.js が使う）
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const MIGRATION_DIR = path.join(ROOT, "docs/db-migration");
const SRC_DIR = path.join(ROOT, "src");
const API_DIR = path.join(ROOT, "api");
const EXCEPTIONS_PATH = path.join(
  __dirname,
  "display-coverage-exceptions.json",
);
export const OUT_PATH = path.join(ROOT, "docs/reference/display-coverage.md");

/**
 * SQLからコメントを落とす。マイグレーションはロールバック手順を `--` コメントで
 * 併記している（081など）ため、外さないと DROP TABLE や GRANT を誤検出する。
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function unqualify(name) {
  return name.replace(/^public\./i, "").toLowerCase();
}

async function readMigrations() {
  const files = (await fs.readdir(MIGRATION_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const out = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(MIGRATION_DIR, file), "utf8");
    out.push({ file, sql: stripSqlComments(raw) });
  }
  return out;
}

/**
 * テーブル・ビューの定義と、匿名SELECT権限の記述を集める。
 * 同じ名前が複数のマイグレーションに出る場合は、最初に定義したファイルを「定義元」とする。
 */
export function collectRelations(migrations) {
  const relations = new Map();
  // 関係ごとの CREATE / DROP を出現順に並べ、最後の操作で存在を決める。
  // 「作る → 消す」「消してから作り直す」がどちらも同じファイル内に現れるため、
  // ファイル単位の有無だけでは判定できない。
  const lastOp = new Map(); // name -> { seq, type }

  const noteOp = (name, type, seq) => {
    const key = unqualify(name);
    const prev = lastOp.get(key);
    if (!prev || seq > prev.seq) lastOp.set(key, { seq, type });
  };

  const ensure = (name, kind, file) => {
    const key = unqualify(name);
    if (!relations.has(key)) {
      relations.set(key, {
        name: key,
        kind,
        definedIn: file,
        grantAnon: null,
        selectPolicy: null,
      });
    }
    return relations.get(key);
  };

  migrations.forEach(({ file, sql }, fileIndex) => {
    // ファイル内の文字位置を足して、ファイルをまたいで単調増加する並び順を作る
    const seqOf = (index) => fileIndex * 1e9 + index;

    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi,
    )) {
      ensure(m[1], "table", file);
      noteOp(m[1], "create", seqOf(m.index));
    }
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi,
    )) {
      ensure(m[1], "view", file);
      noteOp(m[1], "create", seqOf(m.index));
    }
    // DROP は `DROP TABLE a, b CASCADE;` のように複数を並べられる。
    // 1つ目だけ拾うと2件目以降が「存在するのに読まれていない」として台帳に残る。
    for (const m of sql.matchAll(
      /drop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?([a-z0-9_.,\s]+?)\s*(?:cascade|restrict)?\s*(?:;|$)/gi,
    )) {
      for (const rel of m[1].split(",")) {
        const name = rel.trim();
        if (name) noteOp(name, "drop", seqOf(m.index));
      }
    }

    // GRANT SELECT / GRANT ALL ON <rel> TO … anon …
    // GRANT ALL も SELECT を含むため権限ありとして扱う（`ALL TABLES IN SCHEMA …` の
    // 形は関係名に一致しないので、下の relations.get で自然に落ちる）
    for (const m of sql.matchAll(
      /grant\s+(?:select|all)\s*(?:\([^)]*\))?\s+on\s+(?:table\s+)?([a-z0-9_.,\s]+?)\s+to\s+([a-z0-9_,\s]+)/gi,
    )) {
      const roles = m[2].toLowerCase();
      if (!/\banon\b/.test(roles)) continue;
      for (const rel of m[1].split(",")) {
        const key = unqualify(rel.trim());
        if (!key) continue;
        const entry = relations.get(key);
        if (entry && !entry.grantAnon) entry.grantAnon = file;
      }
    }

    // CREATE POLICY … ON <rel> [FOR SELECT] … — 文末の ; までを1ブロックとして見る
    for (const m of sql.matchAll(
      /create\s+policy\s+(?:"[^"]*"|[a-z0-9_]+)\s+on\s+([a-z0-9_.]+)([\s\S]*?);/gi,
    )) {
      const body = m[2].toLowerCase();
      // FOR 句が無いポリシーは ALL（=SELECTも含む）
      const forClause = body.match(
        /\bfor\s+(select|insert|update|delete|all)\b/,
      );
      if (forClause && !["select", "all"].includes(forClause[1])) continue;
      const key = unqualify(m[1]);
      const entry = relations.get(key);
      if (entry && !entry.selectPolicy) entry.selectPolicy = file;
    }
  });

  // 最後の操作が DROP のものは、今は存在しないので対象外
  return [...relations.values()].filter(
    (r) => lastOp.get(r.name)?.type !== "drop",
  );
}

/**
 * 1ファイル分のコードから、参照しているテーブル名とRPC名を取り出す（純関数）。
 * verify-display-coverage.js が固定入力で検証する。
 *
 * `knownRelations` を渡すと、PostgREST の **nested select**（親テーブルの `.select()` の中に
 * `子テーブル ( 列, 列 )` と書いて join する形）も拾う。この形は `.from()` に子テーブル名が
 * 現れないため、`.from()` だけを見ていると**読んでいるのに「読んでいない」と誤判定する**。
 * 2026-09-28に `prediction_odds` で実際に起きた（`supabaseDataService.js:1328` で
 * `prediction_odds ( updated_at, … )` として読み、:1404 で値を使っている）。
 * 既知の関係名に限って拾うことで、`return (`・`if (` のような同じ形の行を除ける。
 */
export function extractCodeReferences(code, knownRelations = null) {
  const tables = new Set();
  const rpcs = new Set();
  for (const m of code.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
    tables.add(m[1]);
  }
  if (knownRelations) {
    // 行頭のインデント + テーブル名 + "(" で終わる行（select文字列の中の子テーブル）
    for (const m of code.matchAll(/^[ \t]+([a-z][a-z0-9_]*)\s*\(\s*$/gm)) {
      if (knownRelations.has(m[1])) tables.add(m[1]);
    }
  }
  // `.rpc(` の直後に改行が入る書き方が実在するため、空白・改行をまたいで拾う
  for (const m of code.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
    rpcs.add(m[1]);
  }
  // REST直叩き。rpc/ を先に判定しないと "rpc" 自体をテーブル名として拾ってしまう
  for (const m of code.matchAll(/rest\/v1\/rpc\/([a-z0-9_]+)/g)) {
    rpcs.add(m[1]);
  }
  for (const m of code.matchAll(/rest\/v1\/(?!rpc\b)([a-z0-9_]+)/g)) {
    tables.add(m[1]);
  }
  return { tables: [...tables], rpcs: [...rpcs] };
}

async function listFiles(dir, exts) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, exts)));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * 画面（src/）とAPI（api/、Vercel Functions）が読んでいるテーブル・RPCを集める。
 *
 * 読み方が2通りあるため両方拾う。
 *   - Supabaseクライアント経由: `.from("t")` / `.rpc("f")`（src/ が使う。
 *     `.rpc(` の直後に改行が入る書き方が実在するので空白をまたぐ）
 *   - REST直叩き: `rest/v1/t` / `rest/v1/rpc/f`（api/ のEdge Functionsが使う。
 *     Supabaseクライアントを持ち込まず fetch している）
 */
async function collectCodeReferences(knownRelations) {
  const surfaces = [
    { dir: SRC_DIR, label: "画面" },
    { dir: API_DIR, label: "API" },
  ];
  const tables = new Map(); // table -> Set<surfaceラベル>
  const rpcs = new Map(); // rpc名 -> Set<surfaceラベル>

  const add = (map, key, label) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(label);
  };

  for (const { dir, label } of surfaces) {
    let files = [];
    try {
      files = await listFiles(dir, [".js", ".jsx", ".ts", ".tsx"]);
    } catch {
      continue; // ディレクトリが無い構成でも壊れないようにする
    }
    for (const file of files) {
      const code = await fs.readFile(file, "utf8");
      const found = extractCodeReferences(code, knownRelations);
      for (const t of found.tables) add(tables, t, label);
      for (const f of found.rpcs) add(rpcs, f, label);
    }
  }
  return { tables, rpcs };
}

/**
 * 関数定義の直後にあるドル引用符の本体を切り出す（純関数）。
 *
 * 引用符のタグは `$$` だけでなく `$function$`・`$data_health$` のように名前付きもありうる
 * （docs/db-migration に実在する）。**開きタグと同じタグ**で閉じるまでを本体とする。
 * タグが見つからない場合は null を返す。文字数で打ち切る近似にすると、後続の
 * 無関係なSQLを本体として読み、別テーブルの参照をこの関数のものとして誤って記録する。
 */
export function extractFunctionBody(sqlFromFunctionStart) {
  const open = sqlFromFunctionStart.match(/\$([a-zA-Z_]*)\$/);
  if (!open) return null;
  const tag = open[0];
  const bodyStart = open.index + tag.length;
  const end = sqlFromFunctionStart.indexOf(tag, bodyStart);
  if (end === -1) return null;
  return sqlFromFunctionStart.slice(bodyStart, end);
}

/**
 * RPCの本体が参照しているテーブルを辿る。
 * FROM / JOIN に現れる識別子を拾う近似で、CTE名・エイリアスは既知のテーブル名に
 * 一致しない限り落ちる（relationNames で絞るため誤検出しにくい）。
 *
 * **同じRPCが複数のマイグレーションで定義されている場合は、最後の定義だけを見る。**
 * 全定義を合算すると、`CREATE OR REPLACE` で参照をやめたテーブルを「RPC経由で読んでいる」と
 * 報告し続け、表示に繋がっていないのに「要判断」から消えてしまう（BOA-363・BOA-431 で
 * 同型の事故が2回起きている）。
 */
function collectRpcTableReads(migrations, rpcNames, relationNames) {
  const reads = new Map(); // table -> Set<rpc名>
  for (const rpc of rpcNames) {
    const fnRe = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${rpc}\\s*\\(`,
      "gi",
    );
    // 最後の定義を探す（マイグレーションは番号順に並んでいる。1ファイル内に複数あれば最後のもの）
    let latest = null;
    for (const { sql } of migrations) {
      fnRe.lastIndex = 0;
      for (const m of sql.matchAll(fnRe)) latest = sql.slice(m.index);
    }
    if (!latest) continue;
    const body = extractFunctionBody(latest);
    if (body === null) continue;
    for (const m of body.matchAll(
      /\b(?:from|join)\s+(?:public\.)?([a-z0-9_]+)/gi,
    )) {
      const key = m[1].toLowerCase();
      if (!relationNames.has(key)) continue;
      if (!reads.has(key)) reads.set(key, new Set());
      reads.get(key).add(rpc);
    }
  }
  return reads;
}

/**
 * Markdownの表のセルを安全にする（純関数）。
 * 例外理由に `|` を書くと列がずれて表が壊れるため、`/` に置き換える
 * （generate-lib-index.js の formatRow と同じ扱い）。
 */
export function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

function renderMarkdown({ rows, exceptions, counts, rpcNames }) {
  const lines = [];
  lines.push("# 表示カバレッジ台帳（機械生成）");
  lines.push("");
  lines.push(
    "**このファイルは手で編集しない。PRにも含めない。** `node scripts/maintenance/generate-display-coverage.js` が生成し、",
  );
  lines.push(
    "masterへのマージ後に `regenerate-generated-docs.yml` が作り直してコミットする（ADR-0078）。",
  );
  lines.push("");
  lines.push(
    "ゴール「公式サイト・各会場の公式サイト・ボートレース日和で取得しているデータを全て表示できるようにする」に対し、",
  );
  lines.push(
    "**取得したデータが画面に繋がっているか**を、マイグレーションと `src/` の静的な突き合わせで見る。",
  );
  lines.push(
    "本番DBの実際の権限は見ない（それは `scripts/maintenance/check-anon-access.js`、実接続が要るため manual tier）。",
  );
  lines.push("");
  lines.push("## 集計");
  lines.push("");
  lines.push("| 区分 | 件数 |");
  lines.push("|---|---|");
  lines.push(`| テーブル・ビューの定義 | ${counts.total} |`);
  lines.push(`| 読んでいる（テーブルを直接） | ${counts.direct} |`);
  lines.push(`| 読んでいる（RPC経由のみ） | ${counts.viaRpc} |`);
  lines.push(
    `| 画面から読んでいない（例外登録あり） | ${counts.unreadExcepted} |`,
  );
  lines.push(
    `| **画面から読んでいない（例外登録なし＝要判断）** | **${counts.unreadUnexplained}** |`,
  );
  lines.push(
    `| 画面から読んでいるが匿名SELECT権限の記述が無い | ${counts.readWithoutGrant} |`,
  );
  lines.push("");
  lines.push(
    "「例外登録なし」は、取得したのに表示に繋がっていない候補。表示するか、`scripts/maintenance/display-coverage-exceptions.json` に理由を書いて例外にするかのどちらかを選ぶ。",
  );
  lines.push("");
  lines.push(
    "「匿名SELECT権限の記述が無い」は、**画面（`src/`）が匿名キーで直接読んでいるのに** `GRANT SELECT … TO anon` もSELECTポリシーもマイグレーションに無いもの。076（BOA-370）が新規テーブルの既定権限を剥奪したため、**076以降に定義されたテーブル**に限って見る。`api/` のEdge Functions経由の読み取りと、RPC経由（`SECURITY DEFINER` がありうる）は対象外。",
  );
  lines.push("");
  if (rpcNames.length > 0) {
    lines.push(
      `画面が呼んでいるRPC: ${rpcNames.map((n) => `\`${n}\``).join(" / ")}`,
    );
    lines.push("");
  }

  const sections = [
    [
      "要判断: 画面から読んでいない（例外登録なし）",
      (r) => r.status === "unread",
    ],
    ["画面から読んでいない（例外登録あり）", (r) => r.status === "excepted"],
    ["画面から読んでいる", (r) => r.status === "read"],
  ];

  for (const [title, filter] of sections) {
    const group = rows.filter(filter);
    lines.push(`## ${title}（${group.length}件）`);
    lines.push("");
    if (group.length === 0) {
      lines.push("なし。");
      lines.push("");
      continue;
    }
    lines.push("| 名前 | 種別 | 定義元 | 画面からの参照 | 匿名SELECT | 備考 |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of group) {
      const note = exceptions[r.name] ?? (r.grantNote || "");
      const cells = [
        `\`${r.name}\``,
        r.kind === "view" ? "ビュー" : "表",
        r.definedIn,
        r.refLabel,
        r.grantLabel,
        note,
      ];
      lines.push(`| ${cells.map(escapeCell).join(" | ")} |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const migrations = await readMigrations();
  const relations = collectRelations(migrations);
  const relationNames = new Set(relations.map((r) => r.name));
  const { tables: codeTables, rpcs } = await collectCodeReferences(relationNames);
  const rpcNames = [...rpcs.keys()].sort();
  const rpcReads = collectRpcTableReads(migrations, rpcNames, relationNames);
  const exceptions = JSON.parse(
    await fs.readFile(EXCEPTIONS_PATH, "utf8"),
  ).tables;

  const rows = relations
    .map((r) => {
      const direct = codeTables.get(r.name);
      const viaRpc = rpcReads.get(r.name);
      const parts = [];
      if (direct) parts.push(`${[...direct].sort().join("・")}が直接`);
      if (viaRpc) {
        const byRpc = [...viaRpc]
          .sort()
          .map(
            (rpc) => `${rpc}(${[...(rpcs.get(rpc) ?? [])].sort().join("・")})`,
          );
        parts.push(`RPC経由: ${byRpc.join(", ")}`);
      }
      const refLabel = parts.length > 0 ? parts.join(" / ") : "なし";
      const grantLabel = r.grantAnon
        ? `GRANT（${r.grantAnon}）`
        : r.selectPolicy
          ? `ポリシー（${r.selectPolicy}）`
          : "記述なし";
      const isRead = Boolean(direct || viaRpc);
      const status = isRead
        ? "read"
        : Object.hasOwn(exceptions, r.name)
          ? "excepted"
          : "unread";
      // 匿名SELECT権限が要るのは「画面（src/）が匿名キーで直接読む」場合だけ。
      // api/ のEdge Functionsはservice_role等で読むため対象外、RPCも SECURITY DEFINER が
      // ありうるため対象外。また076（BOA-370）が新規テーブルの既定権限を剥奪する前に
      // 作られたテーブルは既定権限のままなので、076以降の定義に限って見る。
      // 連番は3桁が基本だが `013b_…` のような枝番や `add-defense-distribution.sql` の
      // ような連番なしも実在する。番号が読めないときは検査する側に倒す（見逃しを作らない）。
      const definedNumber = Number(r.definedIn.match(/^(\d+)/)?.[1] ?? NaN);
      const needsExplicitGrant =
        Boolean(direct?.has("画面")) &&
        (!Number.isFinite(definedNumber) || definedNumber >= 76);
      const grantNote =
        needsExplicitGrant && !r.grantAnon && !r.selectPolicy
          ? "画面が匿名キーで直接読むが GRANT SELECT … TO anon もSELECTポリシーも無い（076以降は明示が必要）"
          : "";
      return { ...r, refLabel, grantLabel, status, grantNote, isRead };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = {
    total: rows.length,
    direct: rows.filter((r) => r.refLabel.includes("が直接")).length,
    viaRpc: rows.filter((r) => r.refLabel.startsWith("RPC経由")).length,
    unreadExcepted: rows.filter((r) => r.status === "excepted").length,
    unreadUnexplained: rows.filter((r) => r.status === "unread").length,
    readWithoutGrant: rows.filter((r) => r.isRead && r.grantNote).length,
  };

  const markdown = renderMarkdown({ rows, exceptions, counts, rpcNames });

  // 例外に書かれているのに実在しないテーブルは、リネーム・削除の取り残し
  const stale = Object.keys(exceptions).filter((t) => !relationNames.has(t));

  // 抽出が壊れると台帳が静かに空になる。PRでは生成物を比較しない（ADR-0078）ため、
  // 空の台帳を「生成できた」と扱わないよう、書き込む前に落とす
  if (counts.total === 0) {
    console.error(
      "NG: テーブル・ビューの定義を1件も拾えませんでした。docs/db-migration/ の読み込みか抽出ロジックが壊れています",
    );
    process.exit(1);
  }

  if (dryRun) {
    // 例外に実在しないテーブルが残っているのはソース側（例外登録）の誤り。
    // PRで落として直させる。master上の再生成（書き込みモード）では注意の表示に留め、
    // 台帳の更新自体は止めない（2本のPRの組み合わせで起きうるため）
    if (stale.length > 0) {
      console.error(
        `NG: display-coverage-exceptions.json に、実在しないテーブルが${stale.length}件あります: ${stale.join(", ")}`,
      );
      process.exit(1);
    }
    console.log(
      `OK: 表示カバレッジ台帳を生成できる（書き込みはしない。${counts.total}件のうち、` +
        `画面から読んでいない・例外登録なしが${counts.unreadUnexplained}件、` +
        `権限の記述が無いのに読んでいるものが${counts.readWithoutGrant}件）。`,
    );
    return;
  }

  await fs.writeFile(OUT_PATH, markdown, "utf8");
  console.log(
    `生成しました: ${path.relative(ROOT, OUT_PATH)}（${counts.total}件）`,
  );
  console.log(
    `  画面から読んでいない・例外登録なし: ${counts.unreadUnexplained}件`,
  );
  console.log(
    `  画面が読んでいるが匿名SELECT権限の記述が無い: ${counts.readWithoutGrant}件`,
  );
  if (stale.length > 0) {
    console.log(
      `  注意: 例外に書かれているが実在しないテーブル: ${stale.join(", ")}`,
    );
  }
}

// verify-display-coverage.js が純関数だけを import できるよう、直接実行時のみ走らせる
if (process.argv[1]?.endsWith("generate-display-coverage.js")) {
  main();
}
