/**
 * before/after の比較画像の道具（compareShotsPlan.js）の引数の解釈と撮る物の並びを守る。
 *
 * 1. 既定（375・1440、light、スクロール0、out/compare-shots、前・後）と、URL の基の末尾の / を外すこと
 * 2. 幅×明暗×パス×スクロールの全ての組を1枚ずつ並べ、ファイル名が重ならない
 * 3. 画面の高さは e2e の layout の5幅と同じ、ほかの幅は 16:10
 * 4. 足りない・形の違う引数は理由を書いて throw する（黙って既定で撮らない）
 *
 * 使い方: node scripts/maintenance/verify-compare-shots-plan.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  heightForWidth,
  parseCompareArgs,
  planShots,
  slugOfPath,
} from "./compareShotsPlan.js";

const BASE = ["--before=https://www.boat-ai.jp/", "--after=http://localhost:5173", "--paths=/blog"];

test("既定の値と URL の基の末尾の / を外す", () => {
  const opts = parseCompareArgs(BASE);
  assert.equal(opts.before, "https://www.boat-ai.jp");
  assert.equal(opts.after, "http://localhost:5173");
  assert.deepEqual(opts.paths, ["/blog"]);
  assert.deepEqual(opts.widths, [375, 1440]);
  assert.deepEqual(opts.themes, ["light"]);
  assert.deepEqual(opts.scrolls, [0]);
  assert.equal(opts.wait, null);
  assert.equal(opts.out, "out/compare-shots");
  assert.equal(opts.labelBefore, "前");
  assert.equal(opts.labelAfter, "後");
});

test("全ての組を1枚ずつ並べ、ファイル名が重ならない", () => {
  const opts = parseCompareArgs([
    ...BASE.slice(0, 2),
    "--paths=/blog,blog/nige-simulation-guide",
    "--widths=375,1920",
    "--themes=light,dark",
    "--scrolls=0,2",
    "--wait=.blog-post-content",
  ]);
  assert.deepEqual(opts.paths, ["/blog", "/blog/nige-simulation-guide"]);
  const shots = planShots(opts);
  assert.equal(shots.length, 2 * 2 * 2 * 2);
  assert.equal(new Set(shots.map((s) => s.file)).size, shots.length);
  assert.deepEqual(shots[0], {
    path: "/blog",
    width: 375,
    height: 812,
    theme: "light",
    scroll: 0,
    file: "blog-375-light-s0.jpg",
  });
  assert.equal(shots.at(-1).file, "blog-nige-simulation-guide-1920-dark-s2.jpg");
  assert.equal(opts.wait, ".blog-post-content");
});

test("画面の高さは layout の5幅と同じ、ほかは 16:10", () => {
  assert.deepEqual(
    [375, 768, 1024, 1440, 1920].map(heightForWidth),
    [812, 1024, 768, 900, 1080],
  );
  assert.equal(heightForWidth(1600), 1000);
  assert.equal(slugOfPath("/"), "top");
  assert.equal(slugOfPath("/race/2026-09-21-02-05?tab=x"), "race-2026-09-21-02-05-tab-x");
});

test("足りない・形の違う引数は理由を書いて throw する", () => {
  assert.throws(() => parseCompareArgs(BASE.slice(1)), /--before は http/);
  assert.throws(() => parseCompareArgs(BASE.slice(0, 2)), /--paths が無い/);
  assert.throws(() => parseCompareArgs([...BASE, "--themes=sepia"]), /light か dark/);
  assert.throws(() => parseCompareArgs([...BASE, "--widths=375,abc"]), /0以上の整数でない/);
  assert.throws(() => parseCompareArgs([...BASE, "--widths="]), /--widths が空/);
  assert.throws(() => parseCompareArgs([...BASE, "blog"]), /--名前=値 の形でない/);
  assert.throws(() => parseCompareArgs([...BASE, "--width=375"]), /--width は知らない引数/);
});
