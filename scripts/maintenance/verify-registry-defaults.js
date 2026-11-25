#!/usr/bin/env node
/**
 * 台帳 verify-registry.json に行の無い verify を既定で tier=ci として回す決まり（scripts/lib/verifyRegistryDefaults.js、ADR-0072 の 2026-11-25 の追記）を固定の入力で確かめる。
 * 頭の注釈の最初の文の行を guards に使う・注釈の無い物は問題に出す・台帳の行がある物は足さない（manual は台帳の行のまま）。
 * この verify 自身も台帳に行を足していない（既定の ci で回ることの実物の確かめ）。ファイル・通信には触らない。
 */
import {
  headGuards,
  withDefaultEntries,
} from "../lib/verifyRegistryDefaults.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check(
  headGuards(
    "#!/usr/bin/env node\n/**\n * 何かを守る。\n * 続き\n */\nimport x from 'y';",
  ) === "何かを守る。",
  "JS の頭の注釈（/** の次の行）の最初の文の行を読む",
);
check(
  headGuards("// 一行の注釈\nconst a = 1;") === "一行の注釈",
  "// の注釈を読む",
);
check(
  headGuards("#!/usr/bin/env bash\n# sh の注釈\nset -e") === "sh の注釈",
  "sh の # の注釈を読む",
);
check(
  headGuards("import x from 'y';\n// 後ろの注釈") === null,
  "注釈の前にコードがあれば無い",
);
check(headGuards("\n\n") === null, "空なら無い");

const texts = {
  "verify-a.js": "/**\n * a を守る\n */",
  "verify-b.js": "import x from 'y';",
  "verify-c.sh": "#!/usr/bin/env bash\n# c を守る",
  "verify-m.js": "/**\n * m\n */",
};
const entries = [
  {
    script: "verify-m.js",
    tier: "manual",
    guards: "m",
    reason: "r",
    command: "c",
  },
];
const r = withDefaultEntries(
  entries,
  Object.keys(texts).sort(),
  (f) => texts[f],
);
check(
  same(r.entries, [
    entries[0],
    { script: "verify-a.js", tier: "ci", guards: "a を守る", implicit: true },
    {
      script: "verify-c.sh",
      tier: "ci",
      guards: "c を守る",
      runner: "bash",
      implicit: true,
    },
  ]),
  "台帳に行の無い物を既定の ci で足し（.sh は runner: bash）、行のある物（manual）はそのまま",
  JSON.stringify(r.entries),
);
check(
  same(r.implicit, ["verify-a.js", "verify-b.js", "verify-c.sh"]),
  "行の無い物の一覧",
);
check(
  r.problems.length === 1 &&
    r.problems[0].includes("verify-b.js") &&
    r.problems[0].includes("頭の注釈なし"),
  "注釈の無い物は問題に出し、ci に足さない（黙って回さない・黙って外さない）",
  JSON.stringify(r.problems),
);

if (failures > 0) {
  console.error(`verify-registry-defaults: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-registry-defaults: すべて通った");
