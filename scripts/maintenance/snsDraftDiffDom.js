// snsDraftDiff.js のDOM の部（実ReactのDOM操作。レイアウト・可読性は別の--draft-diff-uiで検証する）。verify-sns-bundle-import.js → snsDraftDiff.js から呼ぶ。文は分ける前の snsDraftDiff.js のまま（100行の線で関数に割り、外の名前は引数で受ける）。

import assert from "node:assert/strict";

async function sceneInline({ React, reactRoot, DraftDiffView, Panel, dom, a, b, draft, draftContent }) {
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
}

async function sceneVersion({ React, reactRoot, Panel, draft, draftContent }) {
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
}

export async function runDraftDiffDom({ a, b, draft, draftContent, build, pathToFileURL, originalFetch }) {
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
    await sceneInline({ React, reactRoot, DraftDiffView, Panel, dom, a, b, draft, draftContent });
    await sceneVersion({ React, reactRoot, Panel, draft, draftContent });
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
}
