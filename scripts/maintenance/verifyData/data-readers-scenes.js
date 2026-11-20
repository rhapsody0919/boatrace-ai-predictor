/**
 * verify-data-readers.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-data-readers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  validateExtra,
  buildLedger,
  extractAccesses,
  renderMarkdown,
  resolveHelperAccesses,
  parseRestPath,
  pythonMentions,
} from "../../lib/dataReaders.js";

let check, known;
let ledger;

// --- 外の読み手の形 ---
const miniSnapshot = {
  capturedAt: "2026-01-01T00:00:00.000Z",
  relations: [
    {
      name: "races",
      kind: "table",
      rlsEnabled: true,
      grants: [{ grantee: "anon", privileges: ["SELECT"] }],
      policies: [{ command: "SELECT", permissive: true, roles: ["anon"] }],
      columns: [{ name: "race_id" }, { name: "race_date" }],
      triggers: [{ function: "public.trg()" }],
    },
    {
      name: "v_r",
      kind: "view",
      rlsEnabled: false,
      grants: [],
      policies: [],
      columns: [{ name: "race_id" }],
      triggers: [],
      viewDefinition: [" SELECT race_id", "   FROM races"],
    },
  ],
  functions: [
    {
      name: "get_x",
      kind: "function",
      securityDefiner: false,
      grants: [],
      definition: [
        "CREATE FUNCTION get_x() AS $$ SELECT race_date FROM races $$",
      ],
    },
    {
      name: "trg",
      kind: "function",
      securityDefiner: false,
      grants: [],
      definition: ["CREATE FUNCTION trg() AS $$ BEGIN END $$"],
    },
  ],
};

const goodExtra = {
  readers: [
    {
      kind: "table",
      name: "races",
      columns: ["race_id"],
      reader: "x.py",
      repo: "hq",
      access: "read",
      source: "BOA-1",
      addedAt: "2026-10-27",
    },
  ],
};

function scene1() {
  check(
    "外の読み手: 正しい形は誤り無し",
    validateExtra(goodExtra, miniSnapshot),
    [],
  );
  check(
    "外の読み手: 写しに無い表・列・欠けた欄",
    validateExtra(
      {
        readers: [
          {
            kind: "table",
            name: "ghost",
            reader: "x",
            repo: "hq",
            access: "read",
            source: "s",
            addedAt: "2026-10-27",
          },
          { ...goodExtra.readers[0], columns: ["nope"], addedAt: "10/27" },
        ],
      },
      miniSnapshot,
    ),
    [
      "readers[0].name の表 ghost が写しに無い",
      "readers[1].columns の nope が races に無い",
      "readers[1].addedAt は YYYY-MM-DD",
    ],
  );
  // --- 組み立て ---
  ledger = buildLedger({
    perFile: new Map([
      [
        "src/a.js",
        extractAccesses(
          `supabase.from("races").select("race_id, bogus"); supabase.rpc("get_x"); supabase.rpc("gone");`,
          "src/a.js",
        ),
      ],
    ]),
    snapshot: miniSnapshot,
    extra: goodExtra,
    scrapeJobNames: [],
    uncoveredFiles: ["scripts/ml/x.py"],
  });
  check(
    "組み立て: 列の読み手・写しに無い列",
    [
      ledger.tables.races.columns.race_id.readers,
      ledger.tables.races.columns.race_date.readers,
      ledger.tables.races.columnsNotInSnapshot,
    ],
    [["src/a.js:1"], [], ["bogus"]],
  );
  check(
    "組み立て: RPC の本体が読む表・トリガー",
    [
      ledger.tables.races.readByRpc,
      ledger.rpcs.trg.triggerOn,
      ledger.rpcs.get_x.callers.length,
    ],
    [["get_x"], ["races"], 1],
  );
  check(
    "組み立て: 写しに無い RPC",
    ledger.notInSnapshot.map((n) => `${n.kind}:${n.name}`),
    ["rpc:gone"],
  );
  check("組み立て: 外の読み手が表に付く", ledger.tables.races.external.length, 1);
  check(
    "組み立て: Markdown に表と外の読み手が出る",
    ["| [races](#t-races) |", "hq:x.py", "scripts/ml/x.py"].map((s) =>
      renderMarkdown(ledger).includes(s),
    ),
    [true, true, true],
  );
  check(
    "組み立て: RPC・ビューの本文に出る列・定義で読むビュー",
    [ledger.tables.races.columns.race_date.sql, ledger.tables.races.readByView],
    [["rpc:get_x"], ["v_r"]],
  );
}

function scene2() {
  // --- 名前を引数で受け取る部品（upsertChangedRows(client, "表") 等）を呼び手で数える ---
  {
    const files = new Map([
      [
        "scripts/lib/rows.js",
        extractAccesses(
          `export async function upsertRows(client, table, rows) {
    const old = await Promise.all(rows.map((r) => client.from(table).select("*").eq("id", r.id)));
    return client.from(table).upsert(rows);
  }
  export function wrap(c, t) { return upsertRows(c, t, []); }`,
          "scripts/lib/rows.js",
          known,
        ),
      ],
      [
        "scripts/daily/job.js",
        extractAccesses(
          `import { upsertRows, wrap } from "../lib/rows.js";
  await upsertRows(client, "races", rows);
  await wrap(client, "race_entries");
  await upsertRows(client, "not_a_table", rows);`,
          "scripts/daily/job.js",
          known,
        ),
      ],
    ]);
    check(
      "部品の中の .from(引数) は unresolved にしない（無名の関数の中も）",
      files.get("scripts/lib/rows.js").unresolved,
      [],
    );
    check(
      "部品の呼び出しを呼び手の行の読み書きにする（包む部品もたどる・写しに無い名前は捨てる）",
      resolveHelperAccesses(files, known).map(
        (a) => `${a.file}:${a.line}:${a.name}:${a.op}`,
      ),
      [
        "scripts/daily/job.js:2:races:select",
        "scripts/daily/job.js:2:races:upsert",
        "scripts/daily/job.js:3:race_entries:select",
        "scripts/daily/job.js:3:race_entries:upsert",
      ],
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・known） */
export function runDataReadersScenes1(env) {
  ({ check, known } = env);
  scene1();
  scene2();
}

function scene3() {
  check(
    "文の中の /rest/v1/* は読み書きでも式でもない",
    parseRestPath("/rest/v1/* の素通し"),
    null,
  );
  // --- Python の名前の文字列 ---
  check(
    "Python: 表?select・rpc/・コメントの行は除く",
    pythonMentions(
      `r = get("predictions?select=race_id")\n# "races"\npost("rpc/get_x", {})\nx = "hello"`,
      "scripts/ml/a.py",
      known,
    ).map((m) => `${m.kind}:${m.name}:${m.line}`),
    ["table:predictions:1", "rpc:get_x:3"],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・known） */
export function runDataReadersScenes2(env) {
  ({ check, known } = env);
  scene3();
}
