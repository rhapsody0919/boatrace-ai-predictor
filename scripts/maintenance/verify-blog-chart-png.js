/**
 * ブログの図の PNG の書き出し（ADR 0099、docs/design/blog-charts/contract.md 8節）の再現テスト。外部接続なし。
 *
 * 1. 大きさの固定の一覧（src/utils/blogChartPng.js）が整数の画素になり、BlogChart.css の [data-chart-export] の
 *    幅・高さと同じ（片方だけ変えると、撮る枠と組む枠がずれて切れる）
 * 2. 本番の URL の判定: 無い PNG は rewrite で 200（206）の index.html が返るので、content-type と先頭8バイトの両方で見る
 * 3. 撮る図の一覧（planBlogChartPngs）: 記事ごとにまとめる・置き場が無ければ空・id か article が無い JSON は止める
 * 4. 朝夜のまとめの行（blog-chart-png-digest.js）: 足された・変わった JSON だけ・配られていない理由を status.json から添える
 * 5. status.json の照合（failedSnapshotGroups）が図の PNG の失敗を拾う
 * 6. まとめの窓は前回のコミットから本番に配られた版までの2点の diff（マージ直後のビルド中の図を「無い」と出して次の窓から落とさない。/code-review 指摘1）
 * 7. 記事の途中で落ちたら、その記事の PNG を1枚も書かない（status と配信物を食い違わせない。/code-review 指摘2）
 *
 * 使い方: node scripts/maintenance/verify-blog-chart-png.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOG_CHART_PNG_PRESETS,
  blogChartPngPath,
  blogChartPngSize,
  isPngResponse,
} from "../../src/utils/blogChartPng.js";
import { exportBlogChartPngs, planBlogChartPngs } from "../lib/blogChartPng.js";
import {
  changedChartIds,
  digestLines,
  gitDiffArgs,
  resolveSince,
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
  assert.match(lines[3], /本番に無い/);
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

test("まとめの窓: 前回のコミットから本番に配られた版までの2点の diff。名前の変更は A で拾う", () => {
  assert.equal(
    resolveSince("3255c4a51", "abcdef1234", () => "x"),
    "3255c4a51",
  );
  const calls = [];
  const sha = resolveSince("2026-10-20T21:00+09:00", "abcdef1234", (args) => {
    calls.push(args);
    return "1111111\n";
  });
  assert.equal(sha, "1111111");
  // 時刻のときも上限は配られた版の履歴
  assert.deepEqual(calls[0], [
    "rev-list",
    "-1",
    "--before=2026-10-20T21:00+09:00",
    "abcdef1234",
  ]);
  assert.throws(() => resolveSince("2000-01-01", "abcdef1234", () => ""));
  const args = gitDiffArgs("1111111", "abcdef1234");
  assert.deepEqual(args.slice(0, 2), ["diff", "--no-renames"]);
  assert.ok(args.includes("--diff-filter=AM"));
  assert.deepEqual(args.slice(4, 6), ["1111111", "abcdef1234"]);
});

/** 偽のページ。failOn の図で撮影の形に入るときに落ちる。overflow の図ははみ出す */
function fakePage(failOn, overflow = null) {
  return {
    setViewportSize: async () => {},
    goto: async () => {},
    waitForSelector: async () => {},
    screenshot: async () => Buffer.from(PNG_HEAD),
    evaluate: async (fn, arg) => {
      if (fn.name === "enterExportMode") {
        if (arg?.id === failOn) throw new Error("Target page closed");
        const over = arg?.id === overflow ? 5 : 0;
        return { found: true, state: "ready", overflowY: over, overflowX: 0 };
      }
      if (fn.name === "leaveExportMode") return undefined;
      return true;
    },
  };
}

test("記事の途中で落ちたら、その記事の PNG を書かず失敗に数える", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "blog-chart-png-"));
  const r = await exportBlogChartPngs({
    openPage: async () => fakePage("a-y"),
    baseUrl: "http://localhost",
    plan: [
      { article: "a", ids: ["a-x", "a-y"] },
      { article: "b", ids: ["b-z"] },
    ],
    outDir,
  });
  assert.equal(
    existsSync(path.join(outDir, "blog-charts/a-x.portrait.png")),
    false,
  );
  assert.equal(
    existsSync(path.join(outDir, "blog-charts/b-z.portrait.png")),
    true,
  );
  assert.deepEqual(r.files.sort(), [
    "/blog-charts/b-z.landscape.png",
    "/blog-charts/b-z.portrait.png",
  ]);
  assert.deepEqual(r.failed.map((f) => f.id).sort(), [
    "a-x.landscape",
    "a-x.portrait",
    "a-y.landscape",
    "a-y.portrait",
  ]);
});

test("枠からはみ出す図は書かず、失敗でなく skipped に入れる。ページは大きさごとの倍率・ライトで開く", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "blog-chart-png-"));
  const opened = [];
  const r = await exportBlogChartPngs({
    openPage: async (options) => {
      opened.push(options);
      return fakePage(null, "a-y");
    },
    baseUrl: "http://localhost",
    plan: [{ article: "a", ids: ["a-x", "a-y"] }],
    outDir,
  });
  assert.equal(
    existsSync(path.join(outDir, "blog-charts/a-y.portrait.png")),
    false,
  );
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.skipped.map((f) => f.id).sort(), [
    "a-y.landscape",
    "a-y.portrait",
  ]);
  assert.equal(r.files.length, 2);
  // 倍率を渡し忘れると、400×500 の小さい PNG が黙って作られる（代わりの審査 P3-2）
  assert.deepEqual(opened, [
    { deviceScaleFactor: 2.7, colorScheme: "light" },
    { deviceScaleFactor: 2, colorScheme: "light" },
  ]);
});

test("図が無ければページを開かない", async () => {
  let opened = 0;
  const r = await exportBlogChartPngs({
    openPage: async () => {
      opened += 1;
      return fakePage(null);
    },
    baseUrl: "http://localhost",
    plan: [],
    outDir: mkdtempSync(path.join(tmpdir(), "blog-chart-png-")),
  });
  assert.equal(opened, 0);
  assert.equal(r.total, 0);
});
