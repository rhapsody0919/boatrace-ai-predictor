/**
 * verify-pr-lane.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { globalSelectors, classify, parsePatch, headerPath } from "../pr-lane.js";

let run, expect, patch;

/** 元の verify の1つの塊 { } を割った 1/2 */
function prl2Scene1() {
  const BIG = "src/pages/VenueGridPage.jsx";
  const PART = "src/components/HitRaces.jsx";
  const LINE = "<p>回収率100%は超えていません</p>";
  const files = (...entries) => new Map(entries);
  const h9 = (r) => r.hits.filter((h) => h.rule === "H9").map((h) => h.file);
  expect(
    "別のファイルへ移しただけ（字下げだけ違う）は H9 に当てない",
    [`M ${BIG}`, `M ${PART}`],
    "light",
    [],
    files(
      [BIG, { added: [], removed: [`              ${LINE}`] }],
      [PART, { added: [`      ${LINE}`, "<p>見出し</p>"], removed: [] }],
    ),
  );
  expect(
    "消したファイルから移しただけも H9 に当てない",
    [`D ${BIG}`, `M ${PART}`],
    "light",
    [],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  const fresh = expect(
    "移した上に新しい語を足せば H9（移した先に当たる）",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE, "<p>的中率で見る</p>"], removed: [] }],
    ),
  );
  assert.deepEqual(h9(fresh), [PART], "移した先だけに当たる");
  assert.match(fresh.hits.find((h) => h.rule === "H9").reason, /的中率$/);
  expect(
    "移して1字変えれば H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE.replace("100", "120")], removed: [] }],
    ),
  );
  const dup = expect(
    "元に残したまま別のファイルへ写す（複製）は H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [`  ${LINE}`], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  assert.deepEqual(h9(dup), [PART]);
  expect(
    "1行を2つのファイルへ写せば H9（消した行と1対1）",
    [`M ${BIG}`, `M ${PART}`, "M src/components/RaceCard.jsx"],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
      ["src/components/RaceCard.jsx", { added: [LINE], removed: [] }],
    ),
  );
  return { BIG, PART, LINE, files };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function prl2Scene2({ BIG, PART, LINE, files }) {
  expect(
    "移し元の行を書き換えて残せば、移し元に新しい語が入ったとして H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: ["<p>回収率は未達</p>"], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  expect(
    "語を見ないファイル（記事）から持ち込んだ行は H9",
    ["M src/data/blog-posts/guide.json", `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      ["src/data/blog-posts/guide.json", { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  // 移すだけ（moveOnly）で外すファイルは移し元の席を取らない: from → to へ字のまま移した行を、
  // パスの順が先の別のファイルにも足すと、そのファイルに当たる（審査 P0）
  {
    const FROM = "src/services/supabaseDataService.js";
    const TO = "src/services/core2.js";
    const OTHER = "src/a/New.jsx";
    const r = classify({
      changes: [
        { status: "A", path: OTHER },
        { status: "A", path: TO },
        { status: "M", path: FROM },
      ],
      patches: files(
        [OTHER, { added: [LINE], removed: [] }],
        [TO, { added: [LINE], removed: [] }],
        [FROM, { added: [], removed: [LINE] }],
      ),
      trees: [],
      moved: new Set([FROM, TO]),
    });
    assert.ok(
      r.hits.some((h) => h.rule === "H9" && h.file === OTHER),
      `移すだけのファイルの行を別のファイルへ写すと H9（${JSON.stringify(r.hits)}）`,
    );
  }
}

function prl2Scene3() {
  expect(
    "新しい CSS でも全体のセレクタを足せば H7",
    ["A src/components/race/NewTable.css"],
    "heavy",
    ["H7"],
    patch("src/components/race/NewTable.css", [
      ".new-table { color: red; }",
      "body:has(.new-table) {",
      "  overflow: hidden;",
      "}",
    ]),
  );
  expect(
    "新しい CSS の行を読めないときは H7 を安全側で当てる",
    ["A src/components/race/NewTable.css"],
    "heavy",
    ["H7"],
    new Map(),
    { trees: [], fill: false },
  );
  {
    const r = run(
      ["A src/components/race/NewTable.css"],
      patch("src/components/race/NewTable.css", [
        "h2,",
        ".x h3 {",
        "}",
        ":root { --a: 1; }",
      ]),
      { trees: [] },
    );
    assert.match(
      r.hits.find((h) => h.rule === "H7").reason,
      /全体に効くセレクタ: h2・:root$/,
      "全体のセレクタを理由に並べる（クラスで絞った .x h3 は数えない）",
    );
  }
  // 全体のセレクタの拾い方（#2285 の /code-review の指摘を固定）
  {
    const g = (css) => globalSelectors(css.split("\n"));
    assert.deepEqual(g("* { margin: 0; }\nul li > a { x: 1 }"), [
      "*",
      "ul li > a",
    ]);
    assert.deepEqual(g("/* body { */ .c { x: 1 }"), [], "コメントの中は見ない");
    assert.deepEqual(
      g("a:not(.x, .y) { color: red }\n.y:not(a) { x: 1 }"),
      ["a:not(.x, .y)"],
      "括弧の中のカンマで割らない・括弧の中のクラスは絞りに数えない",
    );
    assert.deepEqual(
      g(
        '[data-theme="dark"] h1 { x: 1 }\n#root a { x: 1 }\n.x[aria-disabled] { x: 1 }',
      ),
      ['[data-theme=""] h1', "#root a"],
      "属性・ID から始まっても、クラスで絞らなければ全体",
    );
    assert.deepEqual(g("BODY.modal-open { x: 1 }"), ["BODY.modal-open"]);
    assert.deepEqual(
      g(".c::before { content: \"{\"; }\n.d::after { content: '}'; }"),
      [],
      "文字列の中の括弧・セミコロンで割らない",
    );
    assert.deepEqual(
      g(".card { & a { color: red } a { x: 1 } }"),
      [],
      "入れ子の規則は親で絞られる",
    );
    assert.deepEqual(
      g(
        "@media (max-width: 480px) { a { x: 1 } .c { x: 1 } }\n@keyframes k { from { x: 0 } 50%, to { x: 1 } }\n@font-face { font-family: f; }",
      ),
      ["a"],
      "@media の中は見る。@keyframes・@font-face の中は見ない",
    );
  }
  expect(
    "#2258 src/locales/ja は H8",
    ["M src/locales/ja/common.json"],
    "heavy",
    ["H8"],
  );
  expect(
    "data/analysis の既存の変更は H8",
    ["M data/analysis/ai-crawler/2026-10-30.json"],
    "heavy",
    ["H8"],
  );
  expect("config/*.json", ["M config/today-variants.json"], "heavy", ["H8"]);
}

function prl2Scene4() {
  expect(
    "語が新しく入る（H9）",
    ["M src/pages/VenueGridPage.jsx"],
    "heavy",
    ["H9"],
    patch("src/pages/VenueGridPage.jsx", ["<p>回収率で見る</p>"]),
  );
  expect(
    "前からある語の行の書き換えは H9 に当てない",
    ["M src/pages/VenueGridPage.jsx"],
    "light",
    [],
    patch(
      "src/pages/VenueGridPage.jsx",
      ["<p>的中率（直近）</p>"],
      ["<p>的中率</p>"],
    ),
  );
  expect(
    "risk-rules の語（platforms: all）も H9",
    ["M src/components/HitRaces.jsx"],
    "heavy",
    ["H9"],
    patch("src/components/HitRaces.jsx", ["<p>一攫千金</p>"]),
  );
  expect(
    "記事の JSON（src/data/blog-posts/）の語は H9 に当てない",
    ["M src/data/blog-posts/kyotei-guide.json"],
    "light",
    [],
    patch("src/data/blog-posts/kyotei-guide.json", [
      '  "metaTitle": "競艇の回収率の見方",',
    ]),
  );
  expect(
    "src/data/ の記事以外の語は今までどおり H9",
    ["M src/data/morningDigestCopy.js"],
    "heavy",
    ["H9"],
    patch("src/data/morningDigestCopy.js", ['  title: "的中率",']),
  );
  {
    const s1 = prl2Scene1();
    prl2Scene2(s1);
  }
  // ---- unified diff の読み方 ----
  {
    const p = parsePatch(
      [
        "diff --git a/x.json b/x.json",
        "--- a/x.json",
        "+++ b/x.json",
        "@@ -1 +1,2 @@",
        "-old",
        "+new",
        "+++plus",
        "diff --git a/gone.txt b/gone.txt",
        "--- a/gone.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
      ].join("\n"),
    );
    assert.deepEqual(p.get("x.json"), {
      added: ["new", "++plus"],
      removed: ["old"],
    });
    assert.deepEqual(p.get("gone.txt"), { added: [], removed: ["bye"] });
    // 空白を含むパスは末尾にタブ、引用符等は C の形で引用される
    assert.equal(headerPath("b/src/a b.jsx\t"), "src/a b.jsx");
    assert.equal(headerPath('"b/src/q\\"x.jsx"'), 'src/q"x.jsx');
    assert.equal(headerPath('"b/src/\\346\\227\\245.jsx"'), "src/日.jsx");
    assert.equal(headerPath("/dev/null"), null);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（run・expect・patch） */
export function runPrLaneScenes2(env) {
  ({ run, expect, patch } = env);
  prl2Scene3();
  prl2Scene4();
}
