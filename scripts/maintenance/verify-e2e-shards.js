#!/usr/bin/env node
/**
 * E2E の組の分け方（e2e/shards.json・e2e-shards.js）を固定の入力で検査する（BOA-929・BOA-769）。
 * 外部ネットワーク・Playwright の実行には触らない。
 *
 * 守るもの: 分け方の正本が1つ（両ワークフローが e2e/shards.json から matrix を作る）、最後の組が
 * 上に書いた spec をちょうど除く、分け方の誤り（rest の位置・実在しない spec）を落とす。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSpecFiles,
  loadShards,
  shardArgs,
  validateShards,
} from "./e2e-shards.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
}

// --- 引数の組み立て ---
const sample = {
  shards: [
    { specs: ["smoke.spec.js"] },
    {
      specs: ["layout.spec.js", "a-b.spec.js"],
      projects: ["layout-mobile", "smoke"],
    },
    { specs: ["layout.spec.js"], projects: ["layout-wide"] },
    { rest: true },
  ],
};
const args = shardArgs(sample);
check(
  "組の番号は1から順",
  args.map((a) => a.shard),
  [1, 2, 3, 4],
);
check("spec だけの組", args[0].args, "e2e/smoke.spec.js");
check(
  "projects つきの組",
  args[1].args,
  "--project=layout-mobile --project=smoke e2e/layout.spec.js e2e/a-b.spec.js",
);
// 最後の組の正規表現を、Playwright が --grep-invert を当てる題（ファイル名を含む）に当てる
const rest = new RegExp(args[3].args.match(/--grep-invert "(.*)"$/)[1]);
check(
  "残り全部の組は上に書いた spec を除く",
  ["smoke.spec.js › x", "layout.spec.js › y", "a-b.spec.js › z"].map((t) =>
    rest.test(t),
  ),
  [true, true, true],
);
check(
  "名前の一部が同じ別の spec は除かない",
  ["race-smoke.spec.js › x", "b.spec.js › y", "layoutx.spec.js › z"].map((t) =>
    rest.test(t),
  ),
  [false, false, false],
);
check(
  "同じ spec を2つの組に書いても除く一覧には1回",
  (args[3].args.match(/layout/g) ?? []).length,
  1,
);

// --- 分け方の誤り ---
const specs = ["smoke.spec.js", "layout.spec.js", "a-b.spec.js"];
check("正しい分け方は誤り0件", validateShards(sample, specs), []);
check(
  "rest が最後に無ければ落とす",
  validateShards(
    { shards: [{ rest: true }, { specs: ["smoke.spec.js"] }] },
    specs,
  ).length > 0,
  true,
);
check(
  "rest が2つあれば落とす",
  validateShards(
    { shards: [{ specs: ["smoke.spec.js"] }, { rest: true }, { rest: true }] },
    specs,
  ).length > 0,
  true,
);
check(
  "実在しない spec を落とす（改名・削除の取り残し）",
  validateShards(
    { shards: [{ specs: ["gone.spec.js"] }, { rest: true }] },
    specs,
  ).some((p) => p.includes("gone.spec.js")),
  true,
);
check(
  "空の projects を落とす",
  validateShards(
    { shards: [{ specs: ["smoke.spec.js"], projects: [] }, { rest: true }] },
    specs,
  ).length > 0,
  true,
);

check(
  "projects の無い組と同じ spec を別の組に書けば落とす（レビューの指摘）",
  validateShards(
    {
      shards: [
        { specs: ["smoke.spec.js"] },
        { specs: ["smoke.spec.js"], projects: ["smoke"] },
        { rest: true },
      ],
    },
    specs,
  ).some((p) => p.includes("2回走ります")),
  true,
);

// --- 今の e2e/shards.json ---
let config = null;
try {
  config = loadShards();
} catch (error) {
  failures.push(`e2e/shards.json を読めない: ${error.message}`);
}
if (config) {
  check("今の分け方は4〜5組", [4, 5].includes(config.shards.length), true);
  check(
    "今の分け方の spec は全部実在する",
    validateShards(config, listSpecFiles()),
    [],
  );
}

// --- 分け方の正本は1つ（ワークフローに matrix を手で書かない） ---
for (const [file, from] of [
  ["e2e-smoke-test.yml", "needs.e2e-scope.outputs.matrix"],
  ["e2e-rerecord.yml", "needs.record.outputs.matrix"],
]) {
  const wf = readFileSync(
    path.join(repoRoot, ".github/workflows", file),
    "utf8",
  );
  check(
    `${file} の組は e2e/shards.json から作る`,
    wf.includes(`matrix: \${{ fromJSON(${from}) }}`) &&
      wf.includes("node scripts/maintenance/e2e-shards.js --matrix"),
    true,
  );
  check(`${file} に組の spec を手で書かない`, /--grep-invert/.test(wf), false);
}

if (failures.length > 0) {
  console.error("NG: e2e の組の分け方の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e の組の分け方の判定${checked}件を検証`);
