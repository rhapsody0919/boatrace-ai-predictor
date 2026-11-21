/**
 * verify-pr-lane.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { moveOnlyPaths } from "../prLaneMoveOnly.js";
import { why, MOVE_HEAD, MOVE_TO, MOVE_BASE, SVC, SQ, moveChanges, reader, moveRun, prlHuman1, prlHuman2 } from "./pr-lane-scenes-3.js";

let files, prlDead1;

/** { の中身を割った 3/7 */
function prlHuman3({ reexp }) {
  assert.match(
    why({ head: reexp }),
    /export/,
    "base で export していない名前を殻から export",
  );
  const lost = MOVE_HEAD.replace(
    'export { clearCache } from "./scheduleQueries.js";\n',
    "",
  );
  assert.match(why({ head: lost }), /clearCache/, "base の export を落とす");
  // 審査の重大3: import の頭と終わり（import(・import.meta を import と見ない、; の無い import は閉じない）
  const dyn = MOVE_TO.replace(
    "\nconst K",
    '\nimport("../utils/side.js");\nconst K',
  );
  assert.notEqual(why({ to: dyn }), null, "import( を足す");
}

/** { の中身を割った 4/7 */
function prlHuman4() {
  const meta = MOVE_TO.replace("\nconst K", "\nimport.meta.x = 1;\nconst K");
  return { meta };
}

/** { の中身を割った 5/7 */
function prlHuman5({ meta }) {
  assert.notEqual(why({ to: meta }), null, "import.meta を足す");
}

/** { の中身を割った 6/7 */
function prlHuman6() {
  const open = MOVE_TO.replace(
    'import { a, b } from "../utils/a.js";',
    'import { a, b } from "../utils/a.js"\nglobalThis.evil = 1;',
  );
  assert.notEqual(why({ to: open }), null, "; の無い import の後ろに文");
  // this.X → X は、移したメソッドを指し、局所の名前に隠れないときだけ
  const shadow = (t) => t.replace("const m = J.size;", "const getY = J.size;");
  assert.match(
    why({ base: shadow(MOVE_BASE), to: shadow(MOVE_TO) }),
    /裸の getY/,
    "this.X が局所の名前に隠れる",
  );
  const stay = (t) => t.replace("this.getY(v)", "this.getZ(v)");
  const stayTo = MOVE_TO.replace("+ getY(v)", "+ getZ(v)");
  assert.notEqual(
    why({ base: stay(MOVE_BASE), to: stayTo }),
    null,
    "this.X が殻に残るメソッド",
  );
  // 殻: 名前だけ足す・残すメンバーを変える・既存のファイルへ・読めない・設定なし・src/pure は外さない
  assert.notEqual(
    why({ head: MOVE_HEAD.replace("  getY,\n", "  getY,\n  getW,\n") }),
    null,
    "殻に名前だけ足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("return c(v)", "return c(v + 1)") }),
    /getZ/,
    "残すメンバーを変える",
  );
  const modified = [
    { status: "M", path: SVC },
    { status: "M", path: SQ },
  ];
  assert.notEqual(why({}, modified), null, "既存のファイルへ移す");
  assert.match(why({ to: null }), /読めない/, "読めない→安全側");
  assert.equal(
    moveOnlyPaths(undefined, moveChanges, reader()).size,
    0,
    "設定が無ければ外さない",
  );
  const withPure = [
    ...moveChanges,
    { status: "M", path: "src/pure/raceModel.js" },
  ];
  const pure = moveRun({}, withPure);
  assert.deepEqual(
    pure.r.hits.map((h) => `${h.rule} ${h.file}`),
    ["H3 src/pure/raceModel.js"],
    "src/pure は外さない",
  );
  // 審査（2回目）の再現: 頭の行で名前が隠れる・生の this・文字列の中の this.・注釈の後ろのコード・見えない名前・殻の import
  const param = (t) => t.replace("getY(v) {", "getY(getX) {");
  assert.notEqual(
    why({ base: param(MOVE_BASE), to: param(MOVE_TO) }),
    null,
    "頭の行の引数で名前が隠れる",
  );
  const rawThis = (t) =>
    t.replace(
      'return "的中率" + b(v);',
      'return "的中率" + b(v)\n      * this["k"];',
    );
  assert.match(
    why({ base: rawThis(MOVE_BASE), to: rawThis(MOVE_TO) }),
    /this/,
    "`*` で始まる行の this",
  );
  const strThis = (t) => t.replace('"的中率"', '"this.getY"');
  assert.match(
    why({
      base: strThis(MOVE_BASE),
      to: MOVE_TO.replace('"的中率"', '"getY"'),
    }),
    /this/,
    "文字列の中の this.",
  );
  const afterComment = MOVE_TO.replace(
    "\nconst K",
    '\n/* x */ import "../utils/side.js";\nconst K',
  );
  assert.match(why({ to: afterComment }), /注釈の後ろ/, "注釈の後ろのコード");
  const noImport = MOVE_TO.replace(
    'import { a, b } from "../utils/a.js";',
    'import { a } from "../utils/a.js";',
  );
  return { noImport };
}

/** { の中身を割った 7/7 */
function prlHuman7({ noImport }) {
  assert.match(
    why({ to: noImport }),
    /b が見えない/,
    "to で使う名前の import を外す",
  );
  const headNoImport = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";\n',
    "",
  );
  assert.match(
    why({ head: headNoImport }),
    /c が見えない/,
    "殻で使う名前の import を外す",
  );
  const headOrder = (t) =>
    t.replace(
      'import { c } from "../utils/c.js";',
      'import { c } from "../utils/c.js";\nimport "../utils/s.js";',
    );
  const swapped = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";',
    'import "../utils/s.js";\nimport { c } from "../utils/c.js";',
  );
  assert.equal(
    why({ base: headOrder(MOVE_BASE), head: headOrder(MOVE_HEAD) }),
    null,
    "副作用の import を残す",
  );
  assert.match(
    why({ base: headOrder(MOVE_BASE), head: swapped }),
    /import の順/,
    "殻の import の順を変える",
  );
  assert.match(
    why({ base: headOrder(MOVE_BASE) }),
    /副作用/,
    "殻の副作用の import を外す",
  );
  const selfImport = MOVE_TO.replace(
    "\nconst K",
    '\nimport { supabaseDataService } from "./supabaseDataService.js";\nconst K',
  );
  assert.match(why({ to: selfImport }), /import/, "to が殻を import する");
  assert.match(
    why({ to: MOVE_TO.replace("+ getY(v);", "+ this.getY(v);") }),
    /getX/,
    "to に this が残る",
  );
  const keepLet = (t) => t.replace("/** 殻 */", "let L = 0;\n\n/** 殻 */");
  assert.match(
    why({ base: keepLet(MOVE_BASE), head: keepLet(MOVE_HEAD) }),
    /宣言でない文/,
    "殻に残す上の let",
  );
  // 委ねるだけのメソッドは、上の関数を移したときだけ短い形にしてよい
  const delBase = MOVE_BASE.replace(
    "  getZ(v) {\n    return c(v);\n  },",
    "  /** Z */\n  clearCache() {\n    return clearCache();\n  },\n  getZ(v) {\n    return c(v);\n  },",
  );
  const delHead = MOVE_HEAD.replace(
    "  getZ(v) {",
    "  clearCache,\n  getZ(v) {",
  ).replace("import { getX, getY }", "import { clearCache, getX, getY }");
  assert.equal(
    why({ base: delBase, head: delHead }),
    null,
    "委ねるだけのメソッド",
  );
  const delAsync = delBase.replace(
    "  clearCache() {",
    "  async clearCache() {",
  );
  assert.notEqual(
    why({ base: delAsync, head: delHead }),
    null,
    "async のメソッドが同期の関数に委ねる",
  );
  const delArgs = delBase.replace(
    "return clearCache();",
    "return clearCache(1);",
  );
  assert.notEqual(
    why({ base: delArgs, head: delHead }),
    null,
    "引数を変えて委ねる",
  );
}

/** { の中身を割った 2/2 */
function prlDead2({ config }) {
  const reserved = new Set(config.reservedPatterns.map((r) => r.pattern));
  for (const r of config.reservedPatterns)
    assert.ok(r.reason, `reservedPatterns に理由が要る: ${r.pattern}`);
  const keys = [
    "paths", "added", "changed", "exceptAdded", "except",
    "reachFrom", "rowsOnlyAdded", "globalSelectors",
  ];
  const patterns = [
    ...config.rules.flatMap((rule) =>
      [
        ...keys.flatMap((k) => rule[k] ?? []),
        ...(rule.terms ? [...rule.terms.scan, ...rule.terms.except] : []),
        ...(typeof rule.needs === "object" ? Object.values(rule.needs).flat() : []),
      ].map((p) => [rule.id, p, ""]),
    ),
    ...[config.moveOnly.from, ...config.moveOnly.to].map((p) => ["moveOnly", p, ""]),
    ...Object.entries(config.human).flatMap(([kind, spec]) =>
      ["paths", "writerFiles", "deleted", "changedScripts", "addedRows", "registryRows", "removedRows"]
        .flatMap((k) => spec[k] ?? [])
        .map((p) => [`human.${kind}`, p, "i"]),
    ),
  ];
  assert.ok(patterns.length > 50, "型を集められていない");
  const dead = patterns.filter(
    ([, p, flags]) =>
      !reserved.has(p) && !files.some((f) => new RegExp(p, flags).test(f)),
  );
  assert.deepEqual(
    dead,
    [],
    "どのファイルにも当たらない型（移す PR は規則の型も同じ PR で直す。今は無いが残す物は reservedPatterns に理由つきで）",
  );
}

function prl4Scene1() {
  {
    prlHuman1();
    const { reexp } = prlHuman2();
    prlHuman3({ reexp });
    const { meta } = prlHuman4();
    prlHuman5({ meta });
    const { noImport } = prlHuman6();
    prlHuman7({ noImport });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（files・prlDead1） */
export function runPrLaneScenes4(env) {
  ({ files, prlDead1 } = env);
  prl4Scene1();
}

function prl4Scene2() {
  {
    const { config } = prlDead1();
    prlDead2({ config });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（files・prlDead1） */
export function runPrLaneScenes5(env) {
  ({ files, prlDead1 } = env);
  prl4Scene2();
}
