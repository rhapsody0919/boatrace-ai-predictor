/**
 * verify-pr-size.js の場面（2/2: 試験のファイルに本体を置いた変異と改名）。verify ではない。
 * check は verify 側の物を受け取る（失敗の数は verify が数える）。
 */
import { n, size } from "./pr-size-scenes.js";

let check;

const body = n(250, (i) => `export const rule${i} = (x) => x + ${i};`);

function sceneMutation() {
  for (const [label, test, spec] of [
    [
      "verify に本体（src から import）",
      "scripts/maintenance/verify-rules.js",
      'import { rule1 } from "../../scripts/maintenance/verify-rules.js";',
    ],
    [
      "verify に本体（拡張子を省いた import）",
      "scripts/maintenance/verify-rules.js",
      "import { rule1 } from '../maintenance/verify-rules';",
    ],
    [
      "spec に本体（require）",
      "e2e/rules.spec.js",
      'const { rule1 } = require("../e2e/rules.spec.js");',
    ],
    [
      "verify に本体（new URL）",
      "scripts/maintenance/verify-rules.js",
      'const u = new URL("./verify-rules.js", import.meta.url);',
    ],
  ]) {
    const r = size([
      ["A", test, body],
      ["M", "src/pages/Venue.jsx", [spec, "const a = rule1(1);"]],
    ]);
    check(
      `変異は数える: ${label}`,
      r.lines === 252 && r.counted.some((c) => c.path === test),
      JSON.stringify(r.counted),
    );
  }
  const fromTest = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    [
      "A",
      "scripts/maintenance/verify-other.js",
      ['import { rule1 } from "./verify-rules.js";'],
    ],
    [
      "M",
      "scripts/maintenance/verify-registry.json",
      ['    { "script": "verify-rules.js" },'],
    ],
  ]);
  check(
    "新しい試験どうしの import・台帳の名は本体扱いしない",
    fromTest.lines === 0,
    JSON.stringify(fromTest.counted),
  );
}

function sceneMutationVia() {
  const via = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    [
      "A",
      "scripts/maintenance/verify-b.js",
      ['export * from "./verify-rules.js";'],
    ],
    [
      "M",
      "src/pages/Venue.jsx",
      ['import { rule1 } from "../../scripts/maintenance/verify-b.js";'],
    ],
  ]);
  check(
    "変異は数える: 新しい試験を経由して読む（読まれた試験が読む試験も数える）",
    via.lines === 252,
    JSON.stringify(via.counted),
  );
  for (const [label, line] of [
    ["複数行の import の閉じ", '} from "./verify-rules.js";'],
    [
      "名を文字で組む",
      'const p = "../maintenance/verify-rules.js"; await import(p);',
    ],
    [
      "path.join の名",
      'execFileSync("node", [path.join(dir, "verify-rules.js")]);',
    ],
  ]) {
    const r = size([
      ["A", "scripts/maintenance/verify-rules.js", body],
      ["M", "scripts/daily/run.js", [line]],
    ]);
    check(`変異は数える: ${label}`, r.lines === 251, JSON.stringify(r.counted));
  }
  const sh = size([
    ["A", "scripts/maintenance/verify-job.sh", n(100)],
    ["M", "scripts/daily/run.sh", ["bash scripts/maintenance/verify-job.sh"]],
  ]);
  check(
    "変異は数える: .sh の verify を起動する",
    sh.lines === 101,
    JSON.stringify(sh.counted),
  );
  const prefix = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    ["M", "src/a.js", ['import x from "./verify-rules-extra.js";']],
  ]);
  check(
    "名が前の部分だけ合う別のファイルは本体扱いしない",
    prefix.lines === 1,
    JSON.stringify(prefix.counted),
  );
}

function sceneMutationRename() {
  const launder = size(
    [["R", "src/pure/rules.js", ["// 1行だけ直した"], [], "e2e/rules.spec.js"]],
    { "head:src/pure/rules.js": body.join("\n") },
  );
  check(
    "改名で洗う変異は数える: 数えない試験の置き場から src/pure への改名は先の全部の行",
    launder.lines === 250,
    JSON.stringify(launder.counted),
  );
  const renameEdit = size(
    [
      [
        "R",
        "src/pure/b.js",
        ["const b = 2;"],
        ["const b = 1;"],
        "src/pure/a.js",
      ],
    ],
    { "head:src/pure/b.js": body.join("\n") },
  );
  check(
    "ふつうの改名と書き換えは足した行だけ",
    renameEdit.lines === 1,
    JSON.stringify(renameEdit.counted),
  );

  const nameOnly = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    ["M", "docs/a.md", ["`node scripts/maintenance/verify-rules.js` を回す"]],
  ]);
  check(
    "文書で名を挙げるだけなら本体扱いしない",
    nameOnly.lines === 1,
    JSON.stringify(nameOnly.counted),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runPrSizeScenes2(env) {
  ({ check } = env);
  sceneMutation();
  sceneMutationVia();
  sceneMutationRename();
}
