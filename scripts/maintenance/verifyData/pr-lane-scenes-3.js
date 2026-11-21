/**
 * verify-pr-lane.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { loadMoveOnly, classify } from "../pr-lane.js";
import { moveOnlyReason, moveOnlyPaths } from "../prLaneMoveOnly.js";

let rulesOf;
let moveOnly;
export let MOVE_BASE, MOVE_HEAD, MOVE_TO;

// ---- 移すだけ（BOA-1433 RA02b）: split-data-layer.mjs が字のまま移した PR は H3・H9 を外す（prLaneMoveOnly.js） ----
// fixture の import は文字列の中に置く（行の頭に相対の import を書くと verify-relative-imports が参照先を探す）
export const SVC = "src/services/supabaseDataService.js";

export const SQ = "src/services/scheduleQueries.js";

const lines = (...ls) => ls.join("\n") + "\n";

export const moveChanges = [
  { status: "M", path: SVC },
  { status: "A", path: SQ },
];

export const reader =
  ({ base = MOVE_BASE, head = MOVE_HEAD, to = MOVE_TO } = {}) =>
  (side, p) =>
    p === SVC ? (side === "base" ? base : head) : p === SQ ? to : null;

export const why = (texts, changes = moveChanges) =>
  moveOnlyReason(moveOnly, changes, reader(texts));

export const moveRun = (texts, changes = moveChanges) => {
  const moved = moveOnlyPaths(moveOnly, changes, reader(texts));
  const added = ['    return "的中率" + b(v);'];
  const r = classify({
    changes,
    patches: new Map(
      changes.map((c) => [
        c.path,
        { added: c.path === SQ ? added : [], removed: [] },
      ]),
    ),
    trees: [],
    moved,
  });
  return { moved, r };
};

/** { の中身を割った 1/7 */
export function prlHuman1() {
  const ok = moveRun({});
  assert.equal(why({}), null, "字のまま移す→移すだけ");
  assert.deepEqual([...ok.moved].sort(), [SQ, SVC]);
  assert.equal(
    ok.r.lane,
    "light",
    `字のまま移す→軽（${JSON.stringify(ok.r.hits)}）`,
  );
  const oneChar = moveRun({ to: MOVE_TO.replace("n + m +", "n - m +") });
  assert.equal(oneChar.moved.size, 0, "移して1字変える→移すだけでない");
  assert.deepEqual(
    rulesOf(oneChar.r),
    ["H3", "H9"],
    "移して1字変える→重（H3・H9）",
  );
  const extra = lines("export function getNew() {", "  return 1;", "}");
  assert.match(why({ to: MOVE_TO + extra }), /getNew/, "新しい関数を足す");
  // 最後の単位の後ろの注釈（どの単位にも入らず比べられなかった。11/11 窓口の調べ neg1）
  const tail = "// 手で足した注釈\n";
  assert.match(why({ to: MOVE_TO + tail }), /注釈だけ/, "to の末に注釈を足す");
  assert.match(
    why({ head: MOVE_HEAD + tail }),
    /注釈だけ/,
    "殻の末に注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("\n};\n", "\n  // 手で足した注釈\n};\n") }),
    /注釈だけ/,
    "object の最後のメンバーの後ろに注釈を足す",
  );
  assert.equal(why({ to: MOVE_TO + "\n\n" }), null, "末の空行は移すだけのまま");
  assert.match(
    why({ to: MOVE_TO + "/*\n * x\n */\n" }),
    /注釈だけ/,
    "to の末に複数行の注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("\n};\n", "\n  // 手で足した注釈\n\n};\n") }),
    /注釈だけ/,
    "object の末に注釈と空行を足す",
  );
  // 審査（11/11）重大1: `/* a */ code /* b */` の行は注釈でない（import・export の前に置くとコードを隠せた）
  const hidden = "/* a */ globalThis.evil = 1; /* b */\n";
  const toHead = (t) => MOVE_TO.replace("\n\nimport {", `\n\n${t}import {`);
  assert.match(
    why({ to: toHead(hidden) }),
    /注釈の後ろに字/,
    "to の import の前に隠す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", `${hidden}import { c }`) }),
    /注釈の後ろに字/,
    "殻の import の前に隠す",
  );
  assert.match(
    why({
      head: MOVE_HEAD.replace(
        "export { clearCache }",
        `${hidden}export { clearCache }`,
      ),
    }),
    /注釈の後ろに字/,
    "殻の export の前に隠す",
  );
  assert.match(
    why({ to: toHead("/*\n x */ globalThis.evil = 1;\n") }),
    /注釈の後ろに字/,
    "複数行の注釈の閉じの後ろに隠す",
  );
  // 中1: import・export の注釈（名前だけで比べていた）
  assert.match(
    why({ to: toHead("// 足した\n") }),
    /import に注釈/,
    "to の import の前に注釈",
  );
  assert.match(
    why({
      to: MOVE_TO.replace(
        "import { a, b }",
        "import {\n  a, // 足した\n  b,\n}",
      ),
    }),
    /import に注釈/,
    "to の import の行末に注釈",
  );
}

/** { の中身を割った 2/7 */
export function prlHuman2() {
  assert.match(
    why({
      to: MOVE_TO.replace(
        "import { a, b }",
        "import {\n  a,\n  /*\n  b,\n  */\n}",
      ),
    }),
    /文の中のブロックの注釈/,
    "to の import の名前を注釈で消す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", "// 足した\nimport { c }") }),
    /殻の import・export の注釈/,
    "殻の import の前に注釈を足す",
  );
  assert.match(
    why({
      head: MOVE_HEAD.replace(
        "export { clearCache }",
        "// 足した\nexport { clearCache }",
      ),
    }),
    /殻の import・export の注釈/,
    "殻の export の前に注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", "import { c /* x */ }") }),
    /行の中の注釈/,
    "殻の import の行の中に注釈",
  );
  // 再審査（11/11）重大: base にある `/**`・`*/` を殻の import の中に差し込み、名前を注釈にして消す
  const blockBase = MOVE_BASE.replace("/** 頭の注釈 */", "/**\n * h\n */");
  assert.match(
    why({
      base: blockBase,
      head: MOVE_HEAD.replace("/** 頭の注釈 */\n", "").replace(
        'import { getX, getY } from "./scheduleQueries.js";',
        'import {\n  /**\n  getX,\n  */\n  getY,\n} from "./scheduleQueries.js";',
      ),
    }),
    /注釈/,
    "殻の import の名前を base の注釈の字で囲む",
  );
  // 本物の殻と同じ形: 複数行の import の中の `//` の注釈を殻にそのまま残すのは移すだけのまま
  const slashBase = MOVE_BASE.replace(
    'import { c } from "../utils/c.js";',
    'import {\n  // c の注釈\n  // 2行目\n  c,\n} from "../utils/c.js";',
  );
  const slashHead = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";',
    'import {\n  // c の注釈\n  // 2行目\n  c,\n} from "../utils/c.js";',
  );
  assert.equal(
    why({ base: slashBase, head: slashHead }),
    null,
    "殻の import の中の // の注釈はそのまま残してよい",
  );
  // 審査の重大1: 行の順と単位の境を見る（行の多重集合では通ってしまう形）
  const swap = MOVE_TO.replace(
    "    const n = a(v) + K.size;\n    const m = J.size;",
    "    const m = J.size;\n    const n = a(v) + K.size;",
  );
  assert.match(why({ to: swap }), /getX/, "単位の中の文を入れ替える");
  const hop = MOVE_TO.replace("    const m = J.size;\n", "").replace(
    "  }\nexport function getY(v) {\n",
    "  }\nexport function getY(v) {\n    const m = J.size;\n",
  );
  assert.match(why({ to: hop }), /getX|getY/, "文を別の関数へ移す");
  const order = MOVE_TO.replace(
    "const K = new Map();\nconst J = new Set();",
    "const J = new Set();\nconst K = new Map();",
  );
  assert.match(why({ to: order }), /const の順/, "上の const の順を変える");
  // 審査の重大2: import と export は名前・元・as まで base と同じか、この PR の to から
  const src = MOVE_TO.replace('"../utils/a.js"', '"../utils/a2.js"');
  assert.match(why({ to: src }), /import/, "import の元を差し替える");
  const alias = MOVE_TO.replace("import { a, b }", "import { a, c as b }");
  assert.match(why({ to: alias }), /import/, "as で別の物を同じ名前にする");
  const side = MOVE_TO.replace(
    "\nconst K",
    '\nimport "../utils/side.js";\nconst K',
  );
  assert.match(why({ to: side }), /副作用/, "副作用だけの import を足す");
  const reexp = MOVE_HEAD.replace("{ clearCache }", "{ clearCache, getX }");
  return { reexp };
}

function prl3Scene1() {
  MOVE_BASE = lines(
    "/** 頭の注釈 */",
    'import { a, b } from "../utils/a.js";',
    'import { c } from "../utils/c.js";',
    "",
    "const K = new Map();",
    "const J = new Set();",
    "",
    "export function clearCache() {",
    "  K.clear();",
    "}",
    "",
    "/** 殻 */",
    "export const supabaseDataService = {",
    "  /**",
    "   * X の注釈",
    "   */",
    "  async getX(v) {",
    "    const n = a(v) + K.size;",
    "    const m = J.size;",
    "    return n + m + this.getY(v);",
    "  },",
    "  getY(v) {",
    '    return "的中率" + b(v);',
    "  },",
    "  getZ(v) {",
    "    return c(v);",
    "  },",
    "};",
  );
  MOVE_HEAD = lines(
    "/** 頭の注釈 */",
    'import { c } from "../utils/c.js";',
    'import { getX, getY } from "./scheduleQueries.js";',
    'export { clearCache } from "./scheduleQueries.js";',
    "",
    "/** 殻 */",
    "export const supabaseDataService = {",
    "  getX,",
    "  getY,",
    "  getZ(v) {",
    "    return c(v);",
    "  },",
    "};",
  );
  MOVE_TO = lines(
    "// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。",
    "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
    "",
    'import { a, b } from "../utils/a.js";',
    "",
    "const K = new Map();",
    "const J = new Set();",
    "",
    "export function clearCache() {",
    "  K.clear();",
    "}",
    "/**",
    " * X の注釈",
    " */",
    "export async function getX(v) {",
    "    const n = a(v) + K.size;",
    "    const m = J.size;",
    "    return n + m + getY(v);",
    "  }",
    "export function getY(v) {",
    '    return "的中率" + b(v);',
    "  }",
  );
  moveOnly = loadMoveOnly();
}

/** verify から呼ぶ入口。env は verify 側の束縛（rulesOf） */
export function runPrLaneScenes3(env) {
  ({ rulesOf } = env);
  prl3Scene1();
}
