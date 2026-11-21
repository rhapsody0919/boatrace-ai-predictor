#!/usr/bin/env node
/**
 * verify-data-readers.js — データの読み手の台帳（docs/reference/data-readers.{json,md}）の抽出と組み立てを検査する。
 *
 * 抽出（scripts/lib/dataReaders.js）は構文木で `.from()`・`.select()`・`.rpc()`・`/rest/v1/` を拾う。
 * 抽出が壊れると台帳が黙って薄くなる（読み手が居るのに「読み手なし」に見え、表を消す判断を誤る）ので、
 * 固定の入力で1つずつ確かめる。続けて、今のリポジトリで台帳が作れること（DB に触れない、書き込まない）、
 * 同じ入力で同じ出力になること、手で足す外の読み手（data-readers.extra.json）が写しにある名前を指すことを確かめる。
 *
 * コミット済みの台帳と今のコードの一致は見ない。台帳は機械生成の文書（generated-docs.js の GENERATED_DOCS）で、
 * PR には含めず、master へのマージ後に regenerate-generated-docs.yml が作り直す（ADR-0078。行番号まで持つので
 * ほぼ全 PR で変わり、PR に含めると並行する PR が同じファイルで衝突する）。
 */
import {
  extractAccesses,
  functionAccess,
  parseRestPath,
  parseSelect,
  relationAccess,
  resolveImport,
  scrapeJobWriters,
  sqlTableRefs,
} from "../lib/dataReaders.js";
import { generate } from "./generate-data-readers.js";
import { runDataReadersScenes1, runDataReadersScenes2 } from "./verifyData/data-readers-scenes.js";

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

const known = {
  knownTables: new Set(["races", "race_entries", "sns_drafts", "predictions"]),
  knownFunctions: new Set(["get_x", "get_y", "approve_x"]),
};
const pick = (src, file = "src/a.js") =>
  extractAccesses(src, file, known).accesses.map(
    ({ kind, name, op, via, line, columns, writeColumns }) => ({
      kind,
      name,
      op,
      via,
      line,
      columns,
      writeColumns,
    }),
  );

// --- select の文字列 ---
check(
  "select: 列・別名・キャスト・JSON・埋め込み",
  parseSelect("a, b:c, d::text, e->x, rel!fk(x, y), al:r2!inner(*), count()"),
  {
    columns: ["a", "c", "d", "e"],
    embeds: [
      { name: "rel", columns: ["x", "y"], embeds: [] },
      { name: "r2", columns: ["*"], embeds: [] },
    ],
  },
);
check("select: 空は *", parseSelect("*"), { columns: ["*"], embeds: [] });

// --- クライアントの連鎖 ---
check(
  "from→select→eq の列と埋め込み",
  pick(`supabase
  .from("races")
  .select("race_id, venue_code, race_entries(racer_id)")
  .eq("race_date", d)
  .order("race_number");`),
  [
    {
      kind: "table",
      name: "races",
      op: "select",
      via: "client",
      line: 2,
      columns: ["race_date", "race_id", "race_number", "venue_code"],
      writeColumns: [],
    },
    {
      kind: "table",
      name: "race_entries",
      op: "select",
      via: "embed",
      line: 2,
      columns: ["racer_id"],
      writeColumns: [],
    },
  ],
);
check(
  "insert の列・upsert の onConflict",
  pick(`await db.from("races").insert({ race_id: 1, venue_code: 2 });
await db.from("race_entries").upsert(rows, { onConflict: "race_id,boat" });`),
  [
    {
      kind: "table",
      name: "races",
      op: "insert",
      via: "client",
      line: 1,
      columns: [],
      writeColumns: ["race_id", "venue_code"],
    },
    {
      kind: "table",
      name: "race_entries",
      op: "upsert",
      via: "client",
      line: 2,
      columns: ["boat", "race_id"],
      writeColumns: ["?"],
    },
  ],
);
check(
  "update→eq は書き手（列は書く・絞り込みは読む）",
  pick(`db.from("races").update({ status: "x" }).eq("race_id", id);`),
  [
    {
      kind: "table",
      name: "races",
      op: "update",
      via: "client",
      line: 1,
      columns: ["race_id"],
      writeColumns: ["status"],
    },
  ],
);
check(
  "Array.from・Buffer.from・storage.from・コメントは拾わない",
  pick(`Array.from("races"); Buffer.from("races");
supabase.storage.from("races").upload(x);
// supabase.from("races").select("*")
const s = 'supabase.from("races")';`),
  [],
);
const dyn = extractAccesses(
  `supabase.from(table).select("*"); supabase.rpc(fn);`,
  "src/b.js",
  known,
);
check(
  "名前が変数のものは unresolved",
  dyn.unresolved.map((u) => u.reason),
  ["表の名前が変数（.from(式)）", "RPC の名前が変数（.rpc(式)）"],
);
check(
  "1回だけ宣言した const の名前は引く（三項も）",
  pick(`const RPC = flag ? "get_x" : "get_y";
const T = "races";
supabase.rpc(RPC); supabase.from(T).select("race_id");`).map(
    (a) => `${a.kind}:${a.name}:${a.op}`,
  ),
  ["rpc:get_x:call", "rpc:get_y:call", "table:races:select"],
);
check(
  "2回宣言した名前は引かない",
  extractAccesses(
    `function a(){ const T = "races"; } function b(){ const T = "x"; supabase.from(T).select(); }`,
    "src/c.js",
    known,
  ).unresolved.length,
  1,
);

// --- REST ---
check(
  "REST のパス: 列と on_conflict",
  parseRestPath(
    "/rest/v1/sns_drafts?id=eq.\u0000&select=id,status&order=created_at.desc&on_conflict=id",
  ),
  {
    dynamic: false,
    isRpc: false,
    name: "sns_drafts",
    columns: ["id", "status", "created_at"],
    onConflict: ["id"],
    embeds: [],
  },
);
check(
  "REST のパス: 名前の無い前置きだけは読み書きでない",
  parseRestPath("/rest/v1/"),
  null,
);
check("REST のパス: 名前が式", parseRestPath("/rest/v1/\u0000?x=1"), {
  dynamic: true,
  isRpc: false,
});
check(
  "fetch の method で読み書きを分ける・RPC・包みの相対パス",
  pick(`await fetch(\`\${URL}/rest/v1/sns_drafts?id=eq.\${id}\`, { method: "PATCH", body });
await fetch(\`\${URL}/rest/v1/predictions?select=race_id\`);
const name = "get_x";
await fetch(\`\${URL}/rest/v1/rpc/\${name}\`, { method: "POST" });
await db("rpc/approve_x", { method: "POST" });
await db(\`sns_drafts?select=id\`);
db("unknown_table?x=1");`).map(
    (a) => `${a.kind}:${a.name}:${a.op}:${a.via}:${a.columns.join("|")}`,
  ),
  [
    "table:sns_drafts:update:rest:id",
    "table:predictions:select:rest:race_id",
    "rpc:get_x:call:rest:",
    "rpc:approve_x:call:rest:",
    "table:sns_drafts:rest:rest:id",
  ],
);
check(
  "検査の固定入力のファイルは写しにある名前だけ",
  pick(
    `db.from("fake_table").select("*"); db.from("races").select("race_id");`,
    "scripts/maintenance/verify-x.js",
  ).map((a) => a.name),
  ["races"],
);
check(
  "TypeScript と JSX を読める",
  pick(
    `const f = async (id: number): Promise<void> => { await supabase.from("races").select("race_id"); };`,
    "sns-video-studio/x.ts",
  ).length +
    pick(
      `export const C = () => <div onClick={() => supabase.rpc("get_x")} />;`,
      "src/C.jsx",
    ).length,
  2,
);
check(
  "名前の文字列（rpc は常に、表は名前が式の箇所があるファイルだけ）",
  extractAccesses(
    `const fns = [{ name: "get_x" }]; db.rpc(fn.name); const t = "races";`,
    "scripts/lib/h.js",
    known,
  ).mentions.map((m) => `${m.kind}:${m.name}`),
  ["rpc:get_x", "table:races"],
);

// --- RPC の本体 ---
check(
  "RPC の本体: 読む・書く・呼ぶ（コメントと文字列は外す）",
  sqlTableRefs(
    `CREATE OR REPLACE FUNCTION public.f(p text) RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  -- FROM ghost
  INSERT INTO public.c (x) SELECT x FROM a JOIN b ON true WHERE y = 'FROM e';
  DELETE FROM d WHERE x IN (SELECT g(1));
  UPDATE "a" SET x = 1;
END $function$`,
    new Set(["a", "b", "c", "d", "e", "ghost"]),
    new Set(["f", "g"]),
    "f",
  ),
  { reads: ["a", "b"], writes: ["a", "c", "d"], calls: ["g"] },
);

// --- 権限 ---
const rel = (grants, rlsEnabled, policies) => ({
  grants,
  rlsEnabled,
  policies,
});
check(
  "anon に SELECT の GRANT と PUBLIC のポリシー → anon 可",
  relationAccess(
    rel([{ grantee: "anon", privileges: ["SELECT"] }], true, [
      { command: "SELECT", permissive: true, roles: ["PUBLIC"] },
    ]),
  ).summary,
  "anon 可",
);
check(
  "GRANT があってもポリシーが無ければ service だけ",
  relationAccess(rel([{ grantee: "anon", privileges: ["SELECT"] }], true, []))
    .summary,
  "service だけ",
);
check(
  "RLS 無効で GRANT あり → anon 可",
  relationAccess(
    rel([{ grantee: "anon", privileges: ["SELECT", "INSERT"] }], false, []),
  ).anon,
  ["SELECT", "INSERT"],
);
check(
  "関数: PUBLIC の EXECUTE → anon 可",
  functionAccess({ grants: [{ grantee: "PUBLIC", privileges: ["EXECUTE"] }] })
    .summary,
  "anon 可",
);
check(
  "関数: service_role だけ",
  functionAccess({
    grants: [{ grantee: "service_role", privileges: ["EXECUTE"] }],
  }).summary,
  "service だけ",
);

// --- import とジョブ ---
const files = new Set([
  "api/cron/race-info.js",
  "scripts/lib/a.js",
  "scripts/lib/b/index.js",
]);
check(
  "相対 import の解決（拡張子・index）",
  [
    resolveImport("api/cron/race-info.js", "../../scripts/lib/a.js", files),
    resolveImport("scripts/lib/a.js", "./b", files),
    resolveImport("scripts/lib/a.js", "node:fs", files),
  ],
  ["scripts/lib/a.js", "scripts/lib/b/index.js", null],
);
const perFile = new Map([
  [
    "api/cron/race-info.js",
    { accesses: [], imports: ["../../scripts/lib/a.js"] },
  ],
  ["scripts/lib/a.js", { accesses: [], imports: ["./b"] }],
  [
    "scripts/lib/b/index.js",
    {
      accesses: [
        {
          kind: "table",
          name: "races",
          op: "upsert",
          file: "scripts/lib/b/index.js",
          line: 3,
        },
      ],
      imports: [],
    },
  ],
]);
check(
  "ジョブ: 入口から import でたどった書き込み",
  scrapeJobWriters(["race_info", "nope"], perFile),
  {
    jobs: [
      {
        job: "race_info",
        entry: "api/cron/race-info.js",
        reachableFiles: 3,
        writes: { races: ["scripts/lib/b/index.js:3"] },
      },
    ],
    unresolved: [
      { job: "nope", reason: "入口の api/cron のファイルが決まらない" },
    ],
  },
);

// ---- 後半の場面（verifyData/data-readers-scenes.js） ----
runDataReadersScenes1({ check, known });

// --- REST の埋め込み・URLSearchParams の select・宣言の行の二重・文の中の /rest/v1/* ---
check(
  "REST の select の埋め込みと URLSearchParams の select",
  pick(`await fetch(\`\${U}/rest/v1/races?select=race_id,race_entries(racer_id)\`);
async function list() {
  const params = new URLSearchParams();
  params.set("select", "id, predictions(top_pick)");
  return fetch(\`\${U}/rest/v1/sns_drafts?\${params}\`);
}`).map((a) => `${a.name}:${a.via}:${a.columns.join("|")}`),
  [
    "race_entries:embed:racer_id",
    "races:rest:race_id",
    "predictions:embed:top_pick",
    "sns_drafts:rest:id",
  ],
);
check(
  "テンプレートの式で使う const は宣言の行で数えない",
  pick(`const base = "sns_drafts?select=id";
await fetch(\`\${U}/rest/v1/\${base}\`);`).map((a) => a.line),
  [2],
);

// ---- 後半の場面（verifyData/data-readers-scenes.js） ----
runDataReadersScenes2({ check, known });

if (failures.length) {
  console.error(
    `NG: データの読み手の台帳の抽出が期待どおりでない（${failures.length}/${checked}）`,
  );
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

// --- 今のリポジトリで作れること・同じ入力で同じ出力 ---
try {
  const first = generate();
  const second = generate();
  if (first.json !== second.json || first.md !== second.md) {
    console.error(
      "NG: 同じ入力で台帳の出力が変わった（並び・時刻に依存していないか）",
    );
    process.exit(1);
  }
  const c = first.ledger.counts;
  if (c.parseErrors > 0) {
    console.error(
      `NG: 構文木にできないファイルがある: ${first.ledger.parseErrors.map((p) => p.file).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `OK: データの読み手の台帳（固定入力 ${checked} 件、表 ${c.tables}・RPC ${c.rpcs}・表の読み手 ${c.tableReaders}・書き手 ${c.tableWriters}・RPC の呼び手 ${c.rpcCallers}）`,
  );
} catch (e) {
  console.error(`NG: 台帳を作れない: ${e.message}`);
  process.exit(1);
}
