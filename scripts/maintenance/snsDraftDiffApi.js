// snsDraftDiff.js のAPI の部（モック置換・認証前の不接続・版の照合）。verify-sns-bundle-import.js → snsDraftDiff.js から呼ぶ。文は分ける前の snsDraftDiff.js のまま（100行の線で関数に割り、外の名前は引数で受ける）。

import assert from "node:assert/strict";

const moduleUrl = (code) => "data:text/javascript," + encodeURIComponent(code);

async function authDenied({ apiFile, readFile, originalFetch }) {
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
}

async function mockHandlerOf({ apiFile, readFile }) {
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
  return mockHandler;
}

async function sceneVersionHash({ mockHandler, draft }) {
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
}

async function sceneLockedAndErrors({ mockHandler, draft }) {
  globalThis.__snsDiffMock.saves = 1;
  globalThis.__snsDiffMock.row.draft = {
    ...draft,
    external_operation_state: "reconcile",
  };
  let response = await mockHandler(
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
}

export async function runDraftDiffApi({ draft, readFile, originalFetch }) {
  // 新しいAPIのモック置換は全相対importを処理する。認証拒否では保存も媒体読込もしない。
  const apiFile = new URL(
    "../../api/admin/sns-hub/draft-diff.js",
    import.meta.url,
  );
  await authDenied({ apiFile, readFile, originalFetch });
  const mockHandler = await mockHandlerOf({ apiFile, readFile });
  try {
    await sceneVersionHash({ mockHandler, draft });
    await sceneLockedAndErrors({ mockHandler, draft });
  } finally {
    delete globalThis.__snsDiffMock;
  }
}
