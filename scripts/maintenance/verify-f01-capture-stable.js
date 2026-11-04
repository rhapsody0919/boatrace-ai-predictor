/**
 * 完全版 f01 の撮影が決定的か（docs/design/f01-stable-capture/ の終わりの条件「同じ材料で2回作ると、全章のコマが画素で一致する」）。
 * 同じ材料で撮影用の頁を2回撮り（毎回 dev サーバーを立て直す）、全カットの画素（RGBA に戻した値）が一致することを確かめる。
 * 撮ったカットと大きさ・字の最小の大きさも出す。
 *
 * 使い方: node scripts/maintenance/verify-f01-capture-stable.js <materials.json> [<materials.json> ...]
 * ローカルの Playwright（chromium）・ffmpeg・vite が要り、撮影に1回30〜50秒かかるので tier=manual。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const files = process.argv.slice(2);
if (!files.length) {
  console.error(
    "使い方: node scripts/maintenance/verify-f01-capture-stable.js <materials.json> [...]",
  );
  process.exit(2);
}
const { f01Script } =
  await import("../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
const { captureAll } =
  await import("../../sns-video-studio/remotion/scripts/full-picture/f01-capture.mjs");

const rgba = (f) =>
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 1 << 28 },
  );

let bad = 0;
for (const file of files) {
  const m = JSON.parse(readFileSync(file, "utf8"));
  const s = f01Script(m);
  assert.ok(s.ok, `${file}: 台本を作れない（${s.reason}）`);
  const dirs = [
    mkdtempSync(join(tmpdir(), "f01-stable-a-")),
    mkdtempSync(join(tmpdir(), "f01-stable-b-")),
  ];
  try {
    const [a, b] = [
      await captureAll(m, s, dirs[0]),
      await captureAll(m, s, dirs[1]),
    ];
    assert.deepEqual(
      Object.keys(a),
      Object.keys(b),
      `${file}: 撮ったカットの並びが違う`,
    );
    const diff = Object.keys(a).filter(
      (k) => !rgba(a[k].file).equals(rgba(b[k].file)),
    );
    const sizes = Object.entries(a).map(
      ([k, v]) =>
        `${k} ${Math.round(v.clip.w)}x${Math.round(v.clip.h)} ${v.minFontPx}px`,
    );
    console.log(
      `${m.raceId}: ${Object.keys(a).length}カット、画素が違う ${diff.length}（${diff.join("・") || "なし"}）\n  ${sizes.join(" / ")}`,
    );
    if (diff.length) bad++;
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}
assert.equal(bad, 0, "同じ材料で2回撮ると画素が違うカットがある");
console.log("verify-f01-capture-stable: OK");
