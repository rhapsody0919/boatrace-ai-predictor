/**
 * verify-schema-snapshot.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-schema-snapshot.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { serializeSnapshot, buildSnapshot, appliedLedgerState } from "../../lib/schemaSnapshot.js";

let check, throwsWith, LEDGER, db, raw, opts, snap, fns, f2, f1;
let shuffled, fnIndex, state;

// ---------------------------------------------------------------------------
// (b) 組み立ての失敗
// ---------------------------------------------------------------------------
const withRows = (name, rows, extra = {}) => ({
  ...raw,
  [name]: { ...raw[name], rows, ...extra },
});

const mapRows = (name, i, patch) =>
  withRows(
    name,
    raw[name].rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
  );

async function scene1() {
  check(
    "関数: ALTER した search_path が config と定義に出る、SECURITY DEFINER・volatility・md5",
    JSON.stringify(f2.config) ===
      JSON.stringify(["search_path=public, pg_temp"]) &&
      f2.definition.some((l) =>
        /SET search_path TO 'public', 'pg_temp'/.test(l),
      ) &&
      f2.securityDefiner === true &&
      f2.volatility === "stable" &&
      f1.config === null &&
      /^[0-9a-f]{32}$/.test(f1.prosrcMd5),
    JSON.stringify({ config: f2.config, def: f2.definition }),
  );
  check(
    "関数の権限: 全体の既定で PUBLIC の EXECUTE を外したものは PUBLIC が無く、付けたものはある",
    !f1.grants.some((g) => g.grantee === "PUBLIC") &&
      f2.grants.some((g) => g.grantee === "service_role"),
    JSON.stringify({ f1: f1.grants, f2: f2.grants }),
  );
  check(
    "シーケンス（identity・serial）",
    JSON.stringify(snap.sequences.map((s) => s.name)) ===
      JSON.stringify(["races_seq_seq", "races_serial_no_seq"]),
    JSON.stringify(snap.sequences.map((s) => s.name)),
  );
  check(
    "既定の権限: public（表の SELECT）と全体（関数）の両方",
    snap.defaultPrivileges.some(
      (d) =>
        d.scope === "public" &&
        d.objectType === "table" &&
        d.role === "postgres" &&
        d.grantee === "service_role",
    ) &&
      snap.defaultPrivileges.some(
        (d) =>
          d.scope === "global" &&
          d.objectType === "function" &&
          d.role === "postgres",
      ),
    JSON.stringify(snap.defaultPrivileges),
  );
  check(
    "既定の権限: 全部を外して ACL が空の行も残す（grantee null・権限なし）",
    snap.defaultPrivileges.some(
      (d) =>
        d.scope === "global" &&
        d.objectType === "type" &&
        d.role === "postgres" &&
        d.grantee === null &&
        d.privileges.length === 0,
    ),
    JSON.stringify(snap.defaultPrivileges),
  );
  check(
    "拡張の作った関数（pg_trgm）は入らない",
    (await db.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rows
      .length === 1 && !fns.some((f) => /trgm|similarity/.test(f.name)),
  );
  shuffled = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k,
      { ...v, rows: [...v.rows].reverse() },
    ]),
  );
  check(
    "問い合わせの行の並びを崩しても同じ出力（並びは組み立てが持つ）",
    serializeSnapshot(buildSnapshot(shuffled, opts)) === serializeSnapshot(snap),
  );
  check(
    "行数の目安（reltuples）を入れない",
    snap.relations.every(
      (r) => !Object.keys(r).some((k) => /tuple|estimate|rows/i.test(k)),
    ),
  );
  check(
    "打ち切り（truncated）は失敗",
    throwsWith(
      () =>
        buildSnapshot(
          withRows("columns", raw.columns.rows, { truncated: true }),
          opts,
        ),
      /打ち切られた/,
    ),
  );
}

function scene2() {
  check(
    "truncated が無い（false でない）出力も失敗",
    throwsWith(
      () =>
        buildSnapshot(
          withRows("columns", raw.columns.rows, { truncated: undefined }),
          opts,
        ),
      /打ち切られた/,
    ),
  );
  check(
    "問い合わせの欠けは失敗",
    throwsWith(
      () => buildSnapshot({ ...raw, triggers: undefined }, opts),
      /triggers の結果が無い/,
    ),
  );
  check(
    "知らない relkind は失敗",
    throwsWith(
      () =>
        buildSnapshot(
          withRows("relations", [
            ...raw.relations.rows,
            { ...raw.relations.rows[0], name: "zz", relkind: "q" },
          ]),
          opts,
        ),
      /知らない relkind/,
    ),
  );
  check(
    "一覧に無い表の列・トリガーは失敗",
    throwsWith(
      () =>
        buildSnapshot(
          withRows("columns", [
            ...raw.columns.rows,
            { ...raw.columns.rows[0], table_name: "ghost" },
          ]),
          opts,
        ),
      /列 の表 ghost/,
    ) &&
      throwsWith(
        () =>
          buildSnapshot(mapRows("triggers", 0, { table_name: "ghost" }), opts),
        /トリガー の表 ghost/,
      ),
  );
  check(
    "一覧に無い関数の権限は失敗",
    throwsWith(
      () =>
        buildSnapshot(
          withRows("grants", [
            ...raw.grants.rows,
            {
              object_type: "function",
              name: "ghost",
              identity_args: "",
              grantee: "anon",
              privileges: ["EXECUTE"],
              grantable: null,
            },
          ]),
          opts,
        ),
      /関数の権限の ghost/,
    ),
  );
  fnIndex = raw.functions.rows.findIndex((f) => f.name === "races_guard");
}

function scene3() {
  for (const [label, patch, pattern] of [
    [
      "表のコメントの JWT",
      () =>
        mapRows("relations", 0, {
          comment: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x",
        }),
      /JWT/,
    ],
    [
      "関数の本文の sb_secret_",
      () =>
        mapRows("functions", fnIndex, {
          definition: "SELECT 'sb_secret_abcdefghijklmn'",
        }),
      /Supabase の秘密鍵/,
    ],
    [
      "関数の本文の Slack の Webhook",
      () =>
        mapRows("functions", fnIndex, {
          definition:
            "PERFORM net.http_post('https://hooks.slack.com/services/T0/B0/x')",
        }),
      /Slack の Webhook/,
    ],
    [
      "既定値の URL に埋めた資格情報",
      () =>
        mapRows("columns", 0, {
          default_expr: "'postgresql://user:pass@db.example.com/x'::text",
        }),
      /URL に埋めた資格情報/,
    ],
    [
      "search_path 等以外の関数の設定（app.*）",
      () =>
        mapRows("functions", fnIndex, {
          config: ["search_path=public", "app.webhook=abc"],
        }),
      /設定 app\.webhook は写しに入れない/,
    ],
  ]) {
    check(
      `鍵の検査: ${label}は失敗`,
      throwsWith(() => buildSnapshot(patch(), opts), pattern),
    );
  }
  check(
    "台帳に適用済みが無ければ失敗",
    throwsWith(
      () => buildSnapshot(raw, { ...opts, ledger: "" }),
      /適用済みの番号が無い/,
    ),
  );
  // ---------------------------------------------------------------------------
  // (c) 台帳の読み方と鮮度（ファイルの名前が単位）
  // ---------------------------------------------------------------------------
  state = appliedLedgerState(LEDGER);
  check(
    "appliedThrough は適用済みの最大の番号、適用済みのファイルは名前の順（番号なしの行も入る）",
    state.appliedThrough === 6 &&
      JSON.stringify(state.appliedFiles) ===
        JSON.stringify(["001_a.sql", "004_d.sql", "006_f.sql", "x.sql"]),
    JSON.stringify(state),
  );
  check(
    "写しの appliedFilesAtCapture は台帳の適用済みのファイル",
    JSON.stringify(snap.appliedFilesAtCapture) ===
      JSON.stringify(state.appliedFiles) && snap.appliedThrough === 6,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・throwsWith・LEDGER・db・raw・opts・snap・fns・f2・f1） */
export async function runSchemaSnapshotScenes1(env) {
  ({ check, throwsWith, LEDGER, db, raw, opts, snap, fns, f2, f1 } = env);
  await scene1();
  scene2();
  scene3();
}
