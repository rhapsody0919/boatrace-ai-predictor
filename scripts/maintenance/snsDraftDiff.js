import assert from "node:assert/strict";
import {
  characterDiff,
  numericDiff,
  draftContent,
  compareDraftSnapshots,
} from "../../src/utils/snsDraftDiff.js";
const before = "件数30、🛥️で確認";
const after = "件数31、🛥️で確認";
const parts = characterDiff(before, after);
assert.equal(
  parts
    .filter((p) => p.kind !== "added")
    .map((p) => p.text)
    .join(""),
  before,
);
assert.equal(
  parts
    .filter((p) => p.kind !== "removed")
    .map((p) => p.text)
    .join(""),
  after,
);
assert.deepEqual(
  parts.filter((p) => p.kind !== "same"),
  [
    { kind: "removed", text: "0" },
    { kind: "added", text: "1" },
  ],
);
assert.deepEqual(
  numericDiff(
    { n: 0, nested: { v: 30 }, ignored: "text" },
    { n: null, nested: { v: 31 }, ignored: "changed", added: 2 },
  ),
  [
    { path: "/added", before: undefined, after: 2 },
    { path: "/n", before: 0, after: null },
    { path: "/nested/v", before: 30, after: 31 },
  ],
);
const draft = {
  title: "展望",
  caption_text: "確認",
  hashtags: ["#龍神レーダー"],
  source_data: { n: 30 },
};
const a = {
  content: draftContent(draft),
  media: { video: { path: "same.mp4", sha256: "a" } },
};
const b = {
  content: draftContent({ ...draft, source_data: { n: 31 } }),
  media: { video: { path: "same.mp4", sha256: "b" } },
};
assert.equal(compareDraftSnapshots(a, b).media[0].state, "replaced");
assert.equal(
  compareDraftSnapshots(a, {
    ...b,
    media: { video: { path: "same.mp4", sha256: null } },
  }).media[0].state,
  "unknown",
);
assert.equal(compareDraftSnapshots(a, b).numbers.length, 1);
assert.deepEqual(characterDiff("同じ", "同じ"), [
  { kind: "same", text: "同じ" },
]);
console.log(
  "[OK] draft diff: character / numeric / same-path file replacement / unknown hash",
);

// 実SQL、認証前DB不接続、行ロック下の版照合。CIの既存bundleゲートから呼ぶ。
const { PGlite } = await import("@electric-sql/pglite");
const { readFile } = await import("node:fs/promises");
const db = new PGlite();
try {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const name of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "138_sns_external_operations.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
    "147_sns_draft_diff.sql",
  ]) {
    if (
      name === "147_sns_draft_diff.sql" &&
      process.argv.includes("--without-diff-migration")
    )
      continue;
    try {
      await db.exec(
        await readFile(
          new URL(`../../docs/db-migration/${name}`, import.meta.url),
          "utf8",
        ),
      );
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  const first = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows[0];
    } catch (e) {
      throw new Error(e.message);
    }
  };
  const old = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,source_data) VALUES(gen_random_uuid(),'short','x','ja','旧版','件数30','{\"n\":30}') RETURNING *",
  );
  const read = async (id) =>
    (await first("SELECT read_sns_draft_diff($1) AS data", [id])).data;
  const save = async (row, media = {}) =>
    (
      await first("SELECT save_sns_draft_diff($1,$2,$3) AS data", [
        row.draft.id,
        row.revision,
        { content: draftContent(row.draft), media },
      ])
    ).data;
  let row = await read(old.id);
  await save(row);
  assert.equal((await read(old.id)).previous, null);
  // 承認の瞬間を保存。本文変更・失効後も最後の承認版は残る。
  await db.query(
    "UPDATE sns_drafts SET approved_at=now(),status='approved' WHERE id=$1",
    [old.id],
  );
  await db.query(
    "UPDATE sns_drafts SET title='新タイトル',caption_text='件数31',source_data='{\"n\":31}' WHERE id=$1",
    [old.id],
  );
  await assert.rejects(() => save(row), /表示した版が変わりました/);
  row = await read(old.id);
  const saved = await save(row);
  assert.equal(saved.previous.content.caption_text, "件数30");
  assert.equal(saved.approved.content.caption_text, "件数30");
  assert.equal(saved.current.content.caption_text, "件数31");
  assert.equal(
    (await save(await read(old.id))).previous.content.caption_text,
    "件数30",
    "再読込で基準を動かさない",
  );
  const child = await first(
    "INSERT INTO sns_drafts(content_group_id,parent_draft_id,format,platform,language,caption_text) VALUES($1,$2,'short','x','ja','件数32') RETURNING *",
    [old.content_group_id, old.id],
  );
  row = await read(child.id);
  assert.equal(row.previous.content.caption_text, "件数31");
  assert.equal(row.approved.content.caption_text, "件数30");
  // 同一パスのファイル置換は、過去を再hashせず保存されたhashで比較。
  await save(row, { video: { path: "same.mp4", sha256: "a" } });
  const overwritten = await save(await read(child.id), {
    video: { path: "same.mp4", sha256: "b" },
  });
  assert.equal(overwritten.previous.media.video.sha256, "a");
  assert.equal(
    compareDraftSnapshots(overwritten.previous, overwritten.current).media[0]
      .state,
    "replaced",
  );
  // 表示後に媒体が変わっても、承認版のhashは送信snapshotから採る。
  const owner = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const approvedAt = "2026-10-08T12:00:00Z";
  await db.query(
    "UPDATE sns_drafts SET video_storage_path='same.mp4' WHERE id=$1",
    [old.id],
  );
  await save(await read(old.id), {
    video: { path: "same.mp4", sha256: "old-display" },
  });
  await db.query(
    "INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at) VALUES($1,'cancelled',$2,'{}','actual-hash',$3,$4,$4)",
    [
      old.id,
      { media: [{ path: "same.mp4", sha256: "actual-approved" }] },
      owner,
      approvedAt,
    ],
  );
  await db.query(
    "UPDATE sns_drafts SET approved_at=$2,x_approved_hash='actual-hash',status='approved' WHERE id=$1",
    [old.id, approvedAt],
  );
  assert.equal(
    (await read(old.id)).approved.media.video.sha256,
    "actual-approved",
  );
  await db.query(
    "UPDATE sns_drafts SET approved_at='2026-10-08T13:00:00Z',x_approved_hash=NULL WHERE id=$1",
    [old.id],
  );
  assert.equal(
    (await read(old.id)).approved.media,
    null,
    "送信snapshotのない通常承認に古いhashを流用しない",
  );
  // 不正な系統、cycle、一般ロールからの読込を拒否。
  await db.query("UPDATE sns_drafts SET parent_draft_id=id WHERE id=$1", [
    child.id,
  ]);
  await assert.rejects(() => read(child.id), /履歴を確認できません/);
  await db.exec("SET ROLE anon");
  await assert.rejects(() => read(old.id), /permission denied/);
  await db.exec("RESET ROLE");
  console.log(
    "[OK] draft diff SQL: last displayed / approved / parent / overwrite / stale / cycle / RLS",
  );
} finally {
  await db.close();
}
const { captureDraftDiff } = await import("../../api/_lib/snsDraftDiff.js");
let loads = 0;
const snap = await captureDraftDiff(
  { ...draft, video_storage_path: "same.mp4", cover_image_path: "cover.png" },
  async () => {
    loads++;
    return new Uint8Array([1, 2]);
  },
);
assert.equal(loads, 2);
assert.match(snap.media.video.sha256, /^[a-f0-9]{64}$/);
const unavailable = await captureDraftDiff(
  { ...draft, video_storage_path: "same.mp4" },
  async () => {
    throw new Error("PRIVATE_DETAIL");
  },
);
assert.equal(unavailable.media.video.sha256, null);
const { build } = await import("esbuild");
const bundled = await build({
  entryPoints: ["api/admin/sns-hub/draft-diff.js"],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  logLevel: "silent",
});
assert(
  !bundled.outputFiles[0].text.includes("punycode"),
  "新APIの依存はEdge互換",
);
console.log(
  "[OK] draft diff: real-byte hash / unavailable media / Edge browser bundle",
);

// 新しいAPIのモック置換は全相対importを処理する。認証拒否では保存も媒体読込もしない。
const { pathToFileURL } = await import("node:url");
const apiFile = new URL(
  "../../api/admin/sns-hub/draft-diff.js",
  import.meta.url,
);
const moduleUrl = (code) => "data:text/javascript," + encodeURIComponent(code);
let source = await readFile(apiFile, "utf8");
source = source.replace(
  /from (["'])(\.[^"'\n]+)\1/g,
  (_m, _q, relative) =>
    `from ${JSON.stringify(new URL(relative, apiFile).href)}`,
);
const auth = moduleUrl(
  `export async function requireAdminAuth(){return new Response('denied',{status:401});}`,
);
source = source.replace(
  JSON.stringify(new URL("../../_lib/adminAuth.js", apiFile).href),
  JSON.stringify(auth),
);
const { default: handler } = await import(moduleUrl(source));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("認証前の通信は禁止");
};
try {
  assert.equal(
    (
      await handler(
        new Request(
          "https://local.invalid/api/admin/sns-hub/draft-diff?id=bad",
        ),
      )
    ).status,
    401,
  );
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "[OK] draft diff API: auth before DB / complete import replacement",
);
const mock = moduleUrl(`
 export async function requireAdminAuth(){return null;}
 export function isConfigured(){return true;}
 export function isValidUuid(id){return id==='valid';}
 export function jsonResponse(body,status=200){return Response.json(body,{status});}
 export async function loadXMedia(){return globalThis.__snsDiffMock.bytes || new Uint8Array([1]);}
 export const xSendStore={
  async readDraftDiff(){return globalThis.__snsDiffMock.row;},
  async saveDraftDiff(_id,_revision,snapshot){globalThis.__snsDiffMock.saves++; if(globalThis.__snsDiffMock.fail)throw new Error('PRIVATE_DETAIL'); return {...globalThis.__snsDiffMock.row,current:snapshot};}
 };
`);
let apiSource = await readFile(apiFile, "utf8");
apiSource = apiSource.replace(
  /from (["'])(\.[^"'\n]+)\1/g,
  (_m, _q, relative) =>
    `from ${JSON.stringify(new URL(relative, apiFile).href)}`,
);
for (const file of ["adminAuth", "snsHubHelpers", "snsXSendStore"])
  apiSource = apiSource.replace(
    JSON.stringify(new URL(`../../_lib/${file}.js`, apiFile).href),
    JSON.stringify(mock),
  );
const { default: mockHandler } = await import(moduleUrl(apiSource));
try {
  globalThis.__snsDiffMock = {
    row: { draft, revision: "r", previous: null, approved: null },
    saves: 0,
  };
  let response = await mockHandler(
    new Request("https://local.invalid/draft-diff?id=valid"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(globalThis.__snsDiffMock.saves, 1);
  // 承認画面の140 hashは同一Storageパスの実バイト交換でも失効する。
  const { createXSnapshot } = await import("../../api/_lib/snsXSend.js");
  const { mobileVersion } = await import("../../api/_lib/snsMobileApproval.js");
  const mediaDraft = {
    ...draft,
    platform: "x",
    language: "ja",
    video_storage_path: "same.mp4",
  };
  globalThis.__snsDiffMock.row.draft = mediaDraft;
  globalThis.__snsDiffMock.bytes = new Uint8Array([1]);
  const versionHash = await mobileVersion(
    "r",
    await createXSnapshot(mediaDraft, async () => new Uint8Array([1])),
  );
  const versionRequest = () =>
    new Request(
      `https://local.invalid/draft-diff?id=valid&versionHash=${versionHash}`,
    );
  globalThis.__snsDiffMock.bytes = new Uint8Array([2]);
  response = await mockHandler(versionRequest());
  assert.equal(response.status, 409, "同一パスA→Bの差分要求を拒否");
  assert.deepEqual(await response.json(), {
    error: "最新の版に更新されています。再読み込みしてください",
    code: "draft_version_changed",
  });
  assert.equal(globalThis.__snsDiffMock.saves, 1, "不一致版を保存しない");
  globalThis.__snsDiffMock.bytes = new Uint8Array([1]);
  response = await mockHandler(versionRequest());
  assert.equal(response.status, 200, "同じ版は表示できる");
  assert.equal(globalThis.__snsDiffMock.saves, 2);
  globalThis.__snsDiffMock.row.revision = "changed";
  assert.equal(
    (await mockHandler(versionRequest())).status,
    409,
    "DB revision変更も拒否",
  );
  globalThis.__snsDiffMock.row.revision = "r";
  assert.equal(
    (
      await mockHandler(
        new Request("https://local.invalid/draft-diff?id=valid&versionHash="),
      )
    ).status,
    409,
  );
  globalThis.__snsDiffMock.saves = 1;
  globalThis.__snsDiffMock.row.draft = {
    ...draft,
    external_operation_state: "reconcile",
  };
  response = await mockHandler(
    new Request("https://local.invalid/draft-diff?id=valid"),
  );
  assert.equal(response.status, 200);
  assert.equal(
    globalThis.__snsDiffMock.saves,
    1,
    "138の行保護中は補助保存も避ける",
  );
  globalThis.__snsDiffMock.row.draft = draft;
  globalThis.__snsDiffMock.fail = true;
  response = await mockHandler(
    new Request("https://local.invalid/draft-diff?id=valid"),
  );
  assert.equal(response.status, 503);
  assert(!(await response.text()).includes("PRIVATE_DETAIL"));
  assert.equal(
    (await mockHandler(new Request("https://local.invalid/draft-diff?id=bad")))
      .status,
    400,
  );
  assert.equal(
    (
      await mockHandler(
        new Request("https://local.invalid/draft-diff?id=valid", {
          method: "POST",
        }),
      )
    ).status,
    405,
  );
  console.log(
    "[OK] draft diff API: no-store / locked row read only / fixed failure / ID and method",
  );
} finally {
  delete globalThis.__snsDiffMock;
}

// 実ReactのDOM操作。レイアウト・可読性は別の--draft-diff-uiで検証する。
const { JSDOM } = await import("jsdom");
const React = await import("react");
const { mkdir, rm } = await import("node:fs/promises");
const output = new URL(
  `../../node_modules/.cache/sns-draft-diff-${process.pid}.mjs`,
  import.meta.url,
);
await mkdir(new URL(".", output), { recursive: true });
await build({
  entryPoints: ["src/pages/admin/sns-hub/DraftDiffPanel.jsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  packages: "external",
  loader: { ".css": "empty" },
  outfile: output.pathname,
  logLevel: "silent",
});
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://local.invalid/" },
);
const oldWindow = globalThis.window,
  oldDocument = globalThis.document,
  oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let reactRoot;
try {
  const { createRoot } = await import("react-dom/client");
  const { DraftDiffView, default: Panel } = await import(
    pathToFileURL(output.pathname)
  );
  reactRoot = createRoot(document.getElementById("root"));
  let baseline = "previous";
  const current = { ...b, content: { ...b.content, caption_text: "件数31" } };
  const previous = { ...a, content: { ...a.content, caption_text: "件数30" } };
  const render = async () =>
    React.act(async () =>
      reactRoot.render(
        React.createElement(DraftDiffView, {
          data: { current, previous, approved: null },
          baseline,
          onBaseline: (v) => {
            baseline = v;
          },
        }),
      ),
    );
  await render();
  assert.equal(document.querySelector("del").textContent, "−0");
  assert.equal(document.querySelector("ins").textContent, "＋1");
  assert(document.body.textContent.includes("差し替え"));
  const select = document.querySelector("select");
  await React.act(async () => {
    select.value = "approved";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await render();
  assert(document.body.textContent.includes("保存された承認版がありません"));
  // API失敗は本文差分なしと区別し、固定文言・再取得を提供する。
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "PRIVATE_DETAIL" }), { status: 503 });
  await React.act(async () => {
    reactRoot.render(
      React.createElement(Panel, { draft: { id: "synthetic", ...draft } }),
    );
  });
  assert(document.querySelector('[role="alert"]'));
  assert(document.body.textContent.includes("差分を再取得"));
  assert(!document.body.textContent.includes("PRIVATE_DETAIL"));
  globalThis.fetch = async () =>
    Response.json({
      data: {
        current: { content: draftContent(draft), media: {} },
        previous: null,
        approved: null,
      },
    });
  await React.act(async () => document.querySelector("button").click());
  assert(document.body.textContent.includes("比較できる直前の版がありません"));
  assert(!document.querySelector('[role="alert"]'));
  // 画面本文と取得版が違うと、差分を流用しない。
  globalThis.fetch = async () =>
    Response.json({
      data: {
        current: {
          content: draftContent({ ...draft, caption_text: "別版" }),
          media: {},
        },
        previous: null,
        approved: null,
      },
    });
  await React.act(async () =>
    reactRoot.render(
      React.createElement(Panel, { draft: { id: "next", ...draft } }),
    ),
  );
  assert(
    document.body.textContent.includes("差分の取得中に本文が変わりました"),
  );
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url, "http://local.invalid");
    return Response.json(
      { error: "PRIVATE_DETAIL", code: "draft_version_changed" },
      { status: 409 },
    );
  };
  await React.act(async () =>
    reactRoot.render(
      React.createElement(Panel, {
        draft: { id: "same", ...draft },
        versionHash: "hash-a",
      }),
    ),
  );
  assert.equal(requested.searchParams.get("versionHash"), "hash-a");
  assert(
    document.body.textContent.includes(
      "最新の版に更新されています。再読み込みしてください",
    ),
  );
  assert(!document.querySelector("select"), "版が変わったら差分を出さない");
  globalThis.fetch = async (url) => {
    requested = new URL(url, "http://local.invalid");
    return Response.json({
      data: {
        current: { content: draftContent(draft), media: {} },
        previous: null,
        approved: null,
      },
    });
  };
  await React.act(async () =>
    reactRoot.render(
      React.createElement(Panel, {
        draft: { id: "same", ...draft },
        versionHash: "hash-b",
      }),
    ),
  );
  assert.equal(
    requested.searchParams.get("versionHash"),
    "hash-b",
    "本文が同一でも版hash更新で再取得",
  );
  assert(document.querySelector("select"));
  assert(!document.querySelector('[role="alert"]'));
  const mobileSource = await readFile(
    new URL(
      "../../src/pages/admin/sns-hub/MobileApprovalPanel.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert(
    mobileSource.includes("versionHash={row.versionHash || null}"),
    "承認画面で取得したhashを渡す",
  );
  console.log(
    "[OK] draft diff DOM: inline changes / baseline select / fixed failure / retry",
  );
} finally {
  if (reactRoot) await React.act(async () => reactRoot.unmount());
  globalThis.fetch = originalFetch;
  globalThis.window = oldWindow;
  globalThis.document = oldDocument;
  globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  if (navigatorDescriptor)
    Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
  dom.window.close();
  await rm(output, { force: true });
}
