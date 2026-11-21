// 実行: node --test scripts/tests/venueGuideArticles.test.js（BOA-1692）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blogPosts } from "../../src/data/blogPosts.js";
import {
  MAX_VENUE_GUIDE_ARTICLES,
  VENUE_GUIDE_CATEGORY,
  selectVenueGuideArticles,
  venueGuideTitle,
} from "../../src/pure/venueGuideArticles.js";

const { venues } = JSON.parse(
  readFileSync(new URL("../../src/locales/ja/common.json", import.meta.url)),
);
const ids = (posts) => posts.map((p) => p.id);

test("全24場で0〜3本・どれも場別攻略で tags に会場名を完全一致・開催向けの札が無い", () => {
  for (let code = 1; code <= 24; code++) {
    const name = venues[code];
    assert.ok(name, `会場 ${code} の名前が無い`);
    const posts = selectVenueGuideArticles(blogPosts, name);
    assert.ok(
      posts.length >= 0 && posts.length <= MAX_VENUE_GUIDE_ARTICLES,
      `会場 ${code}: ${posts.length}本`,
    );
    for (const p of posts) {
      assert.equal(p.category, VENUE_GUIDE_CATEGORY, `${code} ${p.id}`);
      assert.ok(p.tags.includes(name), `${code} ${p.id}`);
      assert.ok(!p.tags.includes("得点率") && !p.tags.includes("勝負駆け"));
      assert.doesNotMatch(venueGuideTitle(p.title), /\d\s*[%％]|1着率/);
    }
  }
});

test("桐生の期間比較の記事（題に1着率、本文の率が V1 の表と食い違う）は入らない", () => {
  assert.deepEqual(ids(selectVenueGuideArticles(blogPosts, "桐生")), [
    "venue-kiryu",
    "kiryu-water-wind-guide",
  ]);
});

test("戸田は venue-toda の1本、平和島は 基本ガイド→水面と風 の2本で開催向けが入らない", () => {
  assert.deepEqual(ids(selectVenueGuideArticles(blogPosts, "戸田")), [
    "venue-toda",
  ]);
  assert.deepEqual(ids(selectVenueGuideArticles(blogPosts, "平和島")), [
    "venue-heiwajima",
    "heiwajima-water-wind-guide",
  ]);
});

const post = (id, over = {}) => ({
  id,
  title: `${id}の題`,
  date: "2026-01-01",
  category: VENUE_GUIDE_CATEGORY,
  tags: ["津"],
  ...over,
});

test("会場名は完全一致（「津」が「津島」等に当たらない）・データ分析の記事は混ぜない", () => {
  const posts = [
    post("a", { tags: ["津島"] }),
    post("b", { category: "データ分析" }),
    post("c"),
  ];
  assert.deepEqual(ids(selectVenueGuideArticles(posts, "津")), ["c"]);
  assert.deepEqual(selectVenueGuideArticles(posts, ""), []);
});

test("開催向けの札（得点率・勝負駆け）と、画面の題に率・「1着率」が残る記事は出さない", () => {
  const posts = [
    post("x-meet", { tags: ["津", "得点率"] }),
    post("x-final", { tags: ["津", "勝負駆け"] }),
    post("x-rate", { title: "津の1コース1着率55.0%" }),
    post("x-metric", { title: "津の2・3コースは1着率の差が無い" }),
    post("x-cut", { title: "津の攻略｜1コース1着率55.0%" }),
  ];
  assert.deepEqual(ids(selectVenueGuideArticles(posts, "津")), ["x-cut"]);
});

test("並びは 基本ガイド→水面と風→新しい順（同じ日は id 順）で最大3本", () => {
  const posts = [
    post("tsu-old", { date: "2025-01-01" }),
    post("tsu-b", { date: "2026-05-01" }),
    post("tsu-a", { date: "2026-05-01" }),
    post("tsu-water-wind-guide", { date: "2024-01-01" }),
    post("venue-tsu", { date: "2023-01-01" }),
  ];
  assert.deepEqual(ids(selectVenueGuideArticles(posts, "津")), [
    "venue-tsu",
    "tsu-water-wind-guide",
    "tsu-a",
  ]);
});

test("題は「｜」「 - 」「 — 」のうち最初の物の前まで", () => {
  assert.equal(venueGuideTitle("戸田攻略ガイド - 荒れる｜x"), "戸田攻略ガイド");
  assert.equal(venueGuideTitle("平和島の水面｜G1 - 風"), "平和島の水面");
  assert.equal(venueGuideTitle("A — B"), "A");
  assert.equal(venueGuideTitle("区切り無し"), "区切り無し");
});
