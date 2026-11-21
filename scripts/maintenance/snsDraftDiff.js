import assert from "node:assert/strict";
import {
  characterDiff,
  numericDiff,
  draftContent,
  compareDraftSnapshots,
} from "../../src/utils/snsDraftDiff.js";
import { runDraftDiffSql } from "./snsDraftDiffSql.js";
import { runDraftDiffApi } from "./snsDraftDiffApi.js";
import { runDraftDiffDom } from "./snsDraftDiffDom.js";
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
const { readFile } = await import("node:fs/promises");
await runDraftDiffSql({ draftContent, compareDraftSnapshots, readFile });
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
const originalFetch = globalThis.fetch;
await runDraftDiffApi({ draft, readFile, originalFetch });
// 実ReactのDOM操作。レイアウト・可読性は別の--draft-diff-uiで検証する。
await runDraftDiffDom({ a, b, draft, draftContent, build, pathToFileURL, originalFetch });
