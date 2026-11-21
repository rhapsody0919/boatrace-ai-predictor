// verify-css-class-collisions.js から移した自己テストの場面の表（衝突の検出・許可リストの照合）。判定の関数は verify 側から引数で受ける。#961 の実物の CSS を読む場面は verify 側に残す

/** 自己テストの場面（スコープ・@media・同じファイル・コメント・@keyframes）。names は findCollisions の className の列 */
const collisionCases = (names) => [
  {
    name: "スコープされていない同名 → 検出する",
    got: names([
      { file: "a.css", css: ".card { color: red; }" },
      { file: "b.css", css: ".card:hover { color: blue; }" },
    ]),
    want: ["card"],
  },
  {
    name: "親でスコープされている → 検出しない",
    got: names([
      { file: "a.css", css: ".page-a .card { color: red; }" },
      { file: "b.css", css: ".page-b > .card { color: blue; }" },
    ]),
    want: [],
  },
  {
    name: "子孫セレクタの先頭クラスは対象（.grid .item と .grid）",
    got: names([
      { file: "a.css", css: ".grid .item { color: red; }" },
      { file: "b.css", css: ".grid { display: grid; }" },
    ]),
    want: ["grid"],
  },
  {
    name: "@media の中 → 検出する",
    got: names([
      { file: "a.css", css: ".card { color: red; }" },
      {
        file: "b.css",
        css: "@media (max-width: 480px) { .card { color: blue; } }",
      },
    ]),
    want: ["card"],
  },
  {
    name: "[data-theme] や body はスコープにならない → 検出する",
    got: names([
      { file: "a.css", css: '[data-theme="dark"] .card { color: red; }' },
      { file: "b.css", css: "body .card { color: blue; }" },
    ]),
    want: ["card"],
  },
  {
    name: "同じファイル内 → 検出しない",
    got: names([
      { file: "a.css", css: ".card { color: red; } .card { color: blue; }" },
    ]),
    want: [],
  },
  {
    name: "コメント・文字列・:not() の中 → 検出しない",
    got: names([
      {
        file: "a.css",
        css: "/* .card { color: red; } */ .x { content: '.card'; }",
      },
      {
        file: "b.css",
        css: ".y:not(.card) { color: blue; } .card { color: blue; }",
      },
    ]),
    want: [],
  },
  {
    name: "@keyframes の中 → 検出しない",
    got: names([
      { file: "a.css", css: "@keyframes a { from { opacity: 0; } }" },
      { file: "b.css", css: "@keyframes b { from { opacity: 1; } }" },
    ]),
    want: [],
  },
];

/** 自己テストの場面（許可リストとの照合）。compareWithAllowlist は verify 側の判定の関数 */
const allowlistCases = (collisions, compareWithAllowlist) => [
  {
    name: "許可リストの腐敗（解消済みのクラス）→ 検出する",
    got: compareWithAllowlist(collisions, [
      { class: "card", files: ["a.css", "b.css"] },
      { class: "gone", files: ["a.css", "b.css"] },
    ]).stale.map((s) => s.className),
    want: ["gone"],
  },
  {
    name: "許可リストの腐敗（ファイルが外れた）→ 検出する",
    got: compareWithAllowlist(collisions, [
      { class: "card", files: ["a.css", "b.css", "c.css"] },
    ]).stale.flatMap((s) => s.staleFiles),
    want: ["c.css"],
  },
  {
    name: "許可済みのクラスに新しいファイルが加わる → 検出する",
    got: compareWithAllowlist(
      [{ className: "card", files: ["a.css", "b.css", "c.css"] }],
      [{ class: "card", files: ["a.css", "b.css"] }],
    ).added.flatMap((a) => a.newFiles),
    want: ["c.css"],
  },
  {
    name: "許可リストどおり → 何も出さない",
    got: Object.values(
      compareWithAllowlist(collisions, [
        { class: "card", files: ["a.css", "b.css"] },
      ]),
    ).flat(),
    want: [],
  },
];

export { collisionCases, allowlistCases };
