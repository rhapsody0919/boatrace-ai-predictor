// Chromiumを起動できない環境でも、実Reactコンポーネントの状態連携を検証する。
// JSDOMはレイアウト・動画再生・Storage媒体の同一性を検証しない。
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { MemoryRouter } from "react-router-dom";

let createRoot, Admin, Panel, RaceReview, XSendPanel, root, container, dom;
const originalFetch = globalThis.fetch,
  originalInterval = globalThis.setInterval,
  originalClear = globalThis.clearInterval;
const originalTimeout = globalThis.setTimeout,
  originalClearTimeout = globalThis.clearTimeout;
const timers = new Set();
const timeouts = new Set(),
  gates = [];
const bundle = `${process.cwd()}/node_modules/.cache/sns-mobile-dom-${process.pid}.mjs`;
before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  await mkdir(new URL(".", pathToFileURL(bundle)), { recursive: true });
  const baseline = process.env.SNS_MOBILE_TEST_BASELINE;
  await build({
    stdin: {
      contents: `export {default as Admin} from './src/pages/admin/SnsHubAdmin.jsx'; export {default as Panel, MobileRaceReview as RaceReview} from './src/pages/admin/sns-hub/MobileApprovalPanel.jsx'; export {default as XSendPanel} from './src/pages/admin/sns-hub/XSendPanel.jsx';`,
      resolveDir: process.cwd(),
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    packages: "external",
    loader: { ".css": "empty" },
    outfile: bundle,
    plugins: baseline
      ? [
          {
            name: "baseline-ui",
            setup(builder) {
              builder.onLoad(
                {
                  filter:
                    /(?:SnsHubAdmin|MobileApprovalPanel|XSendPanel)\.jsx$/,
                },
                (args) => ({
                  contents: execFileSync(
                    "git",
                    [
                      "show",
                      `${baseline}:${args.path.slice(process.cwd().length + 1)}`,
                    ],
                    { encoding: "utf8" },
                  ),
                  loader: "jsx",
                }),
              );
            },
          },
        ]
      : [],
  });
  ({ Admin, Panel, RaceReview, XSendPanel } = await import(
    pathToFileURL(bundle)
  ));
  globalThis.setInterval = (fn) => {
    timers.add(fn);
    return fn;
  };
  globalThis.clearInterval = (fn) => timers.delete(fn);
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = originalTimeout(fn, ms, ...args);
    timeouts.add(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    timeouts.delete(timer);
    originalClearTimeout(timer);
  };
});
afterEach(async () => {
  for (const release of gates.splice(0)) release();
  await flush();
  if (root) await act(async () => root.unmount());
  root = null;
  for (const timer of timeouts) originalClearTimeout(timer);
  timeouts.clear();
  container?.remove();
  timers.clear();
  globalThis.fetch = originalFetch;
});
after(async () => {
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  delete globalThis.window;
  delete globalThis.document;
  dom.window.close();
  await rm(bundle, { force: true });
});
const row = () => ({
  draft: {
    id: "draft",
    content_group_id: "group",
    platform: "x",
    language: "ja",
    format: "short",
    title: "レース確認",
    status: "approved",
    caption_text: "修正前の本文",
    risk_flags: [],
    source_data: { race_id: "2026-10-08-11-10" },
    created_at: "2026-10-08T00:00:00Z",
  },
  holds: [],
  versionHash: "version",
  job: null,
});
const owner = { id: "owner", display_name: "本人" };
const button = (name, scope = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name,
  );
const select = (label) =>
  [...document.querySelectorAll("label")]
    .find((el) => el.firstChild.textContent === label)
    ?.querySelector("select");
async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++)
      await new Promise((resolve) => setImmediate(resolve));
  });
}
async function click(el) {
  assert.ok(el, "操作要素が存在");
  assert.equal(el.disabled, false, "操作可能");
  await act(async () => el.click());
  await flush();
}
async function choose(el, value) {
  assert.ok(el);
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await flush();
}
async function mount(component) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(component));
  await flush();
}
async function race() {
  await choose(select("レース"), "group");
  await choose(select("承認者"), "owner");
}
function mock(getRow, override = () => null) {
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url, "http://localhost");
    assert.equal(u.hostname, "localhost", "外部通信は禁止");
    const result = await override(u, options);
    if (result) return result;
    if (u.pathname.endsWith("/mobile-approval"))
      return Response.json(
        u.searchParams.has("group")
          ? { data: [getRow()] }
          : { data: [{ id: "group", raceId: "2026-10-08-11-10" }] },
      );
    if (u.pathname.endsWith("/drafts"))
      return Response.json({ data: [getRow().draft] });
    if (u.pathname.endsWith("/approvers"))
      return Response.json({ data: [owner] });
    if (u.pathname.endsWith("/x-send"))
      return Response.json({
        data: { connected: false, job: null, control: { paused: true } },
      });
    assert.ok(
      u.pathname.startsWith("/api/admin/sns-hub/"),
      "既知の管理モックだけ",
    );
    return Response.json({ data: [] });
  };
}
for (const outcome of ["success", "post-lost", "race-get-failed", "409"])
  test(
    `F01 DOM: ${outcome}で手動導線・親一覧・操作前pollを同期`,
    { timeout: 10000 },
    async () => {
      let current = row(),
        started = false,
        finished = false,
        draftReads = 0,
        holdPoll = false,
        releasePoll,
        releasePost;
      const poll = new Promise((resolve) => {
          releasePoll = resolve;
        }),
        post = new Promise((resolve) => {
          releasePost = resolve;
        });
      gates.push(releasePoll, releasePost);
      mock(
        () => current,
        async (u, options) => {
          if (u.pathname.endsWith("/drafts")) {
            draftReads++;
            if (finished && outcome === "race-get-failed")
              return Response.json({ error: "一覧取得失敗" }, { status: 503 });
          }
          if (u.pathname.endsWith("/x-send")) {
            if (holdPoll && !started) {
              holdPoll = false;
              await poll;
              return Response.json({
                data: {
                  connected: false,
                  job: null,
                  control: { paused: true },
                },
              });
            }
            if (finished && outcome !== "success")
              return Response.json({ error: "状態取得失敗" }, { status: 503 });
            if (started)
              return Response.json({
                data: {
                  connected: false,
                  job: { state: "queued" },
                  control: { paused: true },
                },
              });
          }
          if (
            u.pathname.endsWith("/mobile-approval") &&
            options.method === "POST"
          ) {
            started = true;
            current = {
              ...current,
              job: { state: "queued" },
              draft: { ...current.draft, caption_text: "修正後の本文" },
            };
            await post;
            finished = true;
            if (outcome === "post-lost") throw new Error("応答消失");
            return Response.json(
              outcome === "409"
                ? { error: "確認した版が変わりました" }
                : { data: { state: "queued" } },
              { status: outcome === "409" ? 409 : 200 },
            );
          }
          if (
            finished &&
            outcome === "race-get-failed" &&
            u.pathname.endsWith("/mobile-approval") &&
            u.searchParams.has("group")
          )
            return Response.json({ error: "レース取得失敗" }, { status: 503 });
        },
      );
      await mount(
        React.createElement(MemoryRouter, null, React.createElement(Admin)),
      );
      await click(
        [...document.querySelectorAll(".sns-hub-tab-btn")].find((b) =>
          /^X \(/.test(b.textContent),
        ),
      );
      await click(button("投稿準備完了 (1)"));
      const card = document.querySelector(".draft-card");
      const expand = button("▼ 詳細・操作を見る", card);
      if (expand) await click(expand);
      const manual = () =>
        [...card.querySelectorAll("a")].find(
          (a) => a.textContent === "Xを開く",
        );
      assert.ok(manual(), "初期の手動導線");
      await race();
      holdPoll = true;
      await act(async () => {
        for (const timer of timers) timer();
      });
      await click(button("この版のXだけ承認"));
      assert.equal(started, true);
      const manualAtStart = Boolean(manual());
      releasePoll();
      await flush();
      const manualAfterStale = Boolean(manual());
      releasePost();
      await flush();
      assert.equal(manualAtStart, false, "スマホ操作開始で手動導線を閉じる");
      assert.equal(manualAfterStale, false, "古いpollで導線を戻さない");
      assert.ok(draftReads > 1, "失敗を含め親一覧を再取得");
      assert.equal(manual(), undefined, "未確定・queuedで導線を閉じ続ける");
      if (outcome === "success")
        assert.ok(
          card.textContent.includes("修正後の本文") &&
            card.textContent.includes("X送信: 予約・待機中"),
        );
      else assert.ok(document.querySelector('[role="alert"]'));
    },
  );
for (const failRead of [false, true])
  test(`F02 DOM: fired=falseの警告は後続GET${failRead ? "失敗" : "成功"}でも残る`, async () => {
    const current = row();
    current.draft.status = "pending_review";
    let revised = false;
    mock(
      () => current,
      (u) => {
        if (u.pathname.endsWith("/redo")) {
          revised = true;
          current.draft.status = "revision_requested";
          return Response.json({
            data: current.draft,
            routine: { fired: false, reason: "未設定" },
          });
        }
        if (revised && failRead && u.pathname.endsWith("/mobile-approval"))
          return Response.json({ error: "レース取得失敗" }, { status: 503 });
      },
    );
    await mount(React.createElement(Panel, { approvers: [owner] }));
    await race();
    const input = document.querySelector("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set.call(input, "出典を修正");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click(button("この投稿の修正を依頼"));
    assert.ok(
      [...document.querySelectorAll('[role="alert"]')].some((el) =>
        el.textContent.includes("修正処理を起動できませんでした"),
      ),
    );
    if (!failRead) assert.equal(button("この投稿の修正を依頼").disabled, true);
  });
for (const type of ["video", "image"])
  test(`F05 DOM: X ${type}の欠落・読込前・読込成功・失敗・新しい版を検査`, async () => {
    let current = row();
    current.draft[
      type === "video" ? "video_storage_path" : "cover_image_path"
    ] = `x/only.${type === "video" ? "mp4" : "png"}`;
    mock(() => current);
    await mount(React.createElement(Panel, { approvers: [owner] }));
    await race();
    assert.equal(
      button("この版のXだけ承認").disabled,
      true,
      "署名プレビュー欠落",
    );
    current = {
      ...current,
      versionHash: "version2",
      [type === "video" ? "videoUrl" : "imageUrl"]: "http://localhost/media",
    };
    await choose(select("レース"), "");
    await race();
    let media = document.querySelector(type === "video" ? "video" : "img");
    assert.ok(media, "X添付を表示");
    assert.equal(media.getAttribute("src"), "http://localhost/media");
    assert.equal(
      button("この版のXだけ承認").disabled,
      true,
      "読込前は承認不可",
    );
    await act(async () =>
      media.dispatchEvent(
        new window.Event(type === "video" ? "loadeddata" : "load"),
      ),
    );
    assert.equal(
      button("この版のXだけ承認").disabled,
      false,
      "読込成功で承認可能",
    );
    await act(async () => media.dispatchEvent(new window.Event("error")));
    assert.equal(
      button("この版のXだけ承認").disabled,
      true,
      "読込失敗で承認不可",
    );
    current = { ...current, versionHash: "version3" };
    await choose(select("レース"), "");
    await race();
    media = document.querySelector(type === "video" ? "video" : "img");
    assert.equal(
      button("この版のXだけ承認").disabled,
      true,
      "別版に読込済みを流用しない",
    );
    await act(async () =>
      media.dispatchEvent(
        new window.Event(type === "video" ? "loadeddata" : "load"),
      ),
    );
    assert.equal(button("この版のXだけ承認").disabled, false);
  });
test("F05 DOM: X本文だけは添付を要求しない", async () => {
  mock(row);
  await mount(React.createElement(Panel, { approvers: [owner] }));
  await race();
  assert.equal(button("この版のXだけ承認").disabled, false);
});
test("修正理由はチャネルごとに分離し、一方への入力が他方に混入しない", async () => {
  const xRow = row();
  const ytRow = {
    ...row(),
    draft: {
      ...row().draft,
      id: "draft-youtube",
      platform: "youtube",
      video_storage_path: "youtube/a.mp4",
    },
  };
  await mount(
    React.createElement(RaceReview, {
      rows: [xRow, ytRow],
      approvers: [owner],
      onApprove: () => {},
      onRevision: () => {},
      busy: false,
    }),
  );
  const textareas = [...document.querySelectorAll("textarea")];
  assert.equal(textareas.length, 2, "チャネルごとにtextareaが1つずつ存在");
  const [xInput, ytInput] = textareas;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set.call(xInput, "Xだけの修正理由");
    xInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flush();
  assert.equal(xInput.value, "Xだけの修正理由");
  assert.equal(ytInput.value, "", "X側の入力がYouTube側に混入しない");
});
test("MobileApprovalPanel側の操作が割り込んでも、X送信の親一覧更新(onChanged)は必ず呼ばれる", async () => {
  let changedCalls = 0;
  let epoch = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url, "http://localhost");
    if (
      u.pathname.endsWith("/x-send") &&
      (!options.method || options.method === "GET")
    ) {
      return Response.json({
        data: {
          connected: true,
          job: null,
          control: { paused: false, budget_microusd: 0, reserved_microusd: 0 },
        },
      });
    }
    if (u.pathname.endsWith("/x-send") && options.method === "POST") {
      // 承認のPOSTが完了する間に、MobileApprovalPanel側の操作でepochが進んだ状態を模す。
      epoch = 1;
      return Response.json({ data: { state: "queued" } });
    }
    throw new Error(`未知のリクエスト: ${u.pathname}`);
  };
  const draft = { id: "draft-x", platform: "x", status: "pending_review" };
  await mount(
    React.createElement(XSendPanel, {
      draft,
      approverId: "owner",
      onChanged: () => {
        changedCalls++;
      },
      onStateChange: () => {},
      externalOperation: { epoch: 0, pending: false },
      getExternalOperation: () => ({ epoch, pending: false }),
    }),
  );
  await click(button("承認して公開"));
  assert.equal(
    changedCalls,
    1,
    "epochが割り込んで変わっていても親の一覧更新は呼ばれる",
  );
});
