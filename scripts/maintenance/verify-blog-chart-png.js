/**
 * ブログの図の PNG の書き出し（ADR 0099、docs/design/blog-charts/contract.md 8節）の再現テスト。外部接続なし。
 *
 * 1. 大きさの固定の一覧（src/utils/blogChartPng.js）が整数の画素になり、BlogChart.css の [data-chart-export] の
 *    幅・高さと同じ（片方だけ変えると、撮る枠と組む枠がずれて切れる）
 * 2. 本番の URL の判定: 無い PNG は rewrite で 200（206）の index.html が返るので、content-type と先頭8バイトの両方で見る
 * 3. 撮る図の一覧（planBlogChartPngs）: 記事ごとにまとめる・置き場が無ければ空・id か article が無い JSON は止める
 * 4. 朝夜のまとめの行（blog-chart-png-digest.js）: 足された・変わった JSON だけ・配られていない理由を status.json から添える
 * 5. status.json の照合（failedSnapshotGroups）が図の PNG の失敗を拾う
 *
 * 使い方: node scripts/maintenance/verify-blog-chart-png.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOG_CHART_PNG_PRESETS,
  blogChartPngPath,
  blogChartPngSize,
  isPngResponse,
} from "../../src/utils/blogChartPng.js";
import { planBlogChartPngs } from "../lib/blogChartPng.js";
import {
  changedChartIds,
  digestLines,
} from "../content/blog-chart-png-digest.js";
import { failedSnapshotGroups } from "../lib/snapshotStatus.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(
  path.join(ROOT, "src/components/blog/BlogChart.css"),
  "utf8",
);

const PNG_HEAD = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const HTML_HEAD = new TextEncoder().encode("<!doctype");

test("大きさ: portrait は 1080×1350（4:5）、landscape は 1280×720（16:9）の整数の画素", () => {
  assert.deepEqual(blogChartPngSize(BLOG_CHART_PNG_PRESETS.portrait), {
    width: 1080,
    height: 1350,
  });
  assert.deepEqual(blogChartPngSize(BLOG_CHART_PNG_PRESETS.landscape), {
    width: 1280,
    height: 720,
  });
  for (const p of Object.values(BLOG_CHART_PNG_PRESETS)) {
    assert.ok(Number.isInteger(p.cssWidth * p.scale));
    assert.ok(Number.isInteger(p.cssHeight * p.scale));
  }
});

test("大きさ: BlogChart.css の [data-chart-export] の幅・高さが一覧と同じ", () => {
  for (const [name, { cssWidth, cssHeight }] of Object.entries(
    BLOG_CHART_PNG_PRESETS,
  )) {
    const block = css.match(
      new RegExp(
        `\\.blog-chart\\[data-chart-export="${name}"\\]\\s*\\{([^}]*)\\}`,
      ),
    );
    assert.ok(block, `${name} の CSS が無い`);
    assert.match(block[1], new RegExp(`width:\\s*${cssWidth}px`), name);
    assert.match(block[1], new RegExp(`height:\\s*${cssHeight}px`), name);
  }
});

test("URL のパス: /blog-charts/{id}.{preset}.png", () => {
  assert.equal(
    blogChartPngPath("fukuoka-guide-course-win", "portrait"),
    "/blog-charts/fukuoka-guide-course-win.portrait.png",
  );
});

test("本番の判定: content-type と先頭8バイトの両方が PNG のときだけ", () => {
  assert.equal(isPngResponse("image/png", PNG_HEAD), true);
  // 無い PNG は rewrite で index.html が返る
  assert.equal(isPngResponse("text/html; charset=utf-8", HTML_HEAD), false);
  assert.equal(isPngResponse("image/png", HTML_HEAD), false);
  assert.equal(isPngResponse("text/html", PNG_HEAD), false);
  assert.equal(isPngResponse(null, PNG_HEAD), false);
  assert.equal(isPngResponse("image/png", PNG_HEAD.slice(0, 4)), false);
});

test("撮る図の一覧: 記事ごとにまとめ、置き場が無ければ空", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "blog-charts-"));
  const put = (name, obj) =>
    writeFileSync(path.join(dir, name), JSON.stringify(obj));
  put("a-x.json", { id: "a-x", article: "a" });
  put("a-y.json", { id: "a-y", article: "a" });
  put("b-z.json", { id: "b-z", article: "b" });
  writeFileSync(path.join(dir, "readme.txt"), "json ではない");
  assert.deepEqual(planBlogChartPngs(dir), [
    { article: "a", ids: ["a-x", "a-y"] },
    { article: "b", ids: ["b-z"] },
  ]);
  assert.deepEqual(planBlogChartPngs(path.join(dir, "nothing")), []);
  put("c.json", { id: "c" });
  assert.throws(() => planBlogChartPngs(dir), /c\.json: id・article が無い/);
});

test("まとめ: 足された・変わった図の JSON の id だけを取る", () => {
  const log = [
    "",
    "public/blog-charts/fukuoka-guide-course-win.json",
    "public/blog-charts/fukuoka-guide-course-win.json",
    "public/blog-charts/notes.md",
    "public/blog/fukuoka-guide.md",
  ].join("\n");
  assert.deepEqual(changedChartIds(log), ["fukuoka-guide-course-win"]);
});

test("まとめ: 配られた URL と、作られていない理由（status.json から）を出す", () => {
  assert.deepEqual(digestLines([], null), ["新しいブログの図の画像: なし"]);
  const lines = digestLines(
    [
      { id: "a-x", preset: "portrait", ok: true },
      { id: "a-x", preset: "landscape", ok: false },
      { id: "b-y", preset: "portrait", ok: false },
    ],
    { skipped: { "a-x.landscape": "枠からはみ出す（縦 42px）" }, errors: {} },
  );
  assert.equal(
    lines[1],
    "- a-x（portrait 1080×1350）: https://www.boat-ai.jp/blog-charts/a-x.portrait.png",
  );
  assert.match(lines[2], /landscape 1280×720.*枠からはみ出す/);
  assert.match(lines[3], /本番にまだ無い/);
});

test("status.json の照合が図の PNG の失敗を拾う", () => {
  assert.deepEqual(
    failedSnapshotGroups({
      blogChartPng: {
        total: 4,
        succeeded: 3,
        failedIds: ["a-x.portrait"],
        fatalError: null,
      },
    }),
    ["blogChartPng: 3/4 件。失敗: a-x.portrait"],
  );
});
