#!/usr/bin/env node
/**
 * e2e の束（scripts/maintenance/e2e-build.js、ADR-0077 決定8）と、それを使う3つのワークフローを固定の入力で検査する。
 * 外部ネットワーク・vite build・Playwright の実行には触らない。
 *
 * 守るもの:
 * - 再生の束は録画の Supabase のオリジンで build する（違う宛先だと HAR の完全一致が外れ、全件が本番へ素通しになる。#1319）
 * - `E2E_SERVE: preview` で playwright を流す段の前に、同じジョブで `npm run build:e2e` があり、
 *   モードの変数（E2E_LIVE・E2E_RECORD・E2E_RECORDING_SOURCE）が両方の段で同じ（束のモードの取り違えを CI の前に落とす。
 *   取り違えは playwright.config.js も起動の前に止めるが、走ってから落ちると組の分を使う）
 * - 4つ（PR ゲートの e2e-shard・e2e-light、撮り、strict 再生、Live）を同時に preview にする（片方だけ dev にしない）
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSupabaseUrl, e2eMode } from "./e2e-build.js";

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

// --- モードの判定（playwright.config.js と同じ） ---
check("既定は再生", e2eMode({}), "replay");
check("E2E_LIVE=1 は本番データ", e2eMode({ E2E_LIVE: "1" }), "live");
check("E2E_RECORD=1 は撮り", e2eMode({ E2E_RECORD: "1" }), "record");
check(
  "E2E_LIVE が E2E_RECORD より先（playwright.config.js と同じ）",
  e2eMode({ E2E_LIVE: "1", E2E_RECORD: "1" }),
  "live",
);

// --- 焼き込む宛先 ---
const pointers = {
  "e2e/recording.json": { supabaseOrigin: "https://rec.example" },
  "e2e/recordings/meta.json": { supabaseOrigin: "https://local.example" },
};
const read = (f) => pointers[f];
const env = { VITE_SUPABASE_URL: "https://prod.example" };
check(
  "再生は録画のポインタのオリジン（secret の宛先を使わない）",
  buildSupabaseUrl("replay", env, read),
  "https://rec.example",
);
check(
  "撮った録画の strict 再生は meta.json のオリジン",
  buildSupabaseUrl("replay", { ...env, E2E_RECORDING_SOURCE: "local" }, read),
  "https://local.example",
);
check(
  "撮りは今の VITE_SUPABASE_URL",
  buildSupabaseUrl("record", env, read),
  "https://prod.example",
);
check(
  "本番データは今の VITE_SUPABASE_URL",
  buildSupabaseUrl("live", env, read),
  "https://prod.example",
);
let threw = false;
try {
  buildSupabaseUrl("replay", env, () => ({}));
} catch {
  threw = true;
}
check("録画にオリジンが無ければ build しない（例外）", threw, true);

const buildSrc = readFileSync(
  path.join(repoRoot, "scripts/maintenance/e2e-build.js"),
  "utf8",
);
check(
  "GA の ID は空に固定する（本番の束の initGA は DEV で止まらない）",
  /VITE_GA_MEASUREMENT_ID: ""/.test(buildSrc),
  true,
);

// --- ワークフロー: preview で流す段の前に、同じモードの build がある ---
const MODE_VARS = ["E2E_LIVE", "E2E_RECORD", "E2E_RECORDING_SOURCE"];

/** ジョブ（2字下げ）ごとに、手順（6字下げの `- `）の文を返す。コメント行は外す */
export function jobSteps(yaml) {
  const text = yaml.replace(/^\s*#.*\n/gm, "");
  const body = text.slice(text.indexOf("\njobs:\n"));
  const jobs = [
    ...body.matchAll(
      /^ {2}([a-z0-9-]+):\n([\s\S]*?)(?=^ {2}[a-z0-9-]+:\n|(?![\s\S]))/gm,
    ),
  ];
  return jobs.map(([, name, jobText]) => ({
    name,
    steps: jobText.split(/^ {6}- /m).slice(1),
  }));
}

const modeOf = (step) =>
  Object.fromEntries(
    MODE_VARS.map((v) => [
      v,
      step.match(new RegExp(`^ +${v}: '?([^'\\n]*)'?$`, "m"))?.[1] ?? null,
    ]),
  );

/** 問題の一覧（空なら良い）。preview で流す段ごとに、前に同じモードの build があるか */
export function previewProblems(yaml) {
  const problems = [];
  let previewRuns = 0;
  for (const { name, steps } of jobSteps(yaml)) {
    steps.forEach((step, i) => {
      const runsTests = /npx playwright test(?![^\n]*--list)/.test(step);
      if (!runsTests) return;
      const preview = /^ +E2E_SERVE: preview$/m.test(step);
      if (!preview) {
        problems.push(
          `${name}: playwright を流す段に E2E_SERVE: preview が無い（dev のまま）`,
        );
        return;
      }
      previewRuns += 1;
      const builds = steps
        .slice(0, i)
        .filter((s) => /^ +run: npm run build:e2e$/m.test(s));
      if (builds.length === 0) {
        problems.push(`${name}: preview の前に npm run build:e2e が無い`);
        return;
      }
      const want = JSON.stringify(modeOf(step));
      const got = JSON.stringify(modeOf(builds[builds.length - 1]));
      if (want !== got)
        problems.push(
          `${name}: build と実行のモードの変数が違う（build ${got} / 実行 ${want}）`,
        );
    });
  }
  return { problems, previewRuns };
}

// 検査そのものの確かめ（固定の入力）
const good = `name: x
jobs:
  a:
    steps:
      - name: Build
        env:
          E2E_RECORD: '1'
        run: npm run build:e2e
      - name: Run
        env:
          E2E_RECORD: '1'
          E2E_SERVE: preview
        run: npx playwright test
      - name: List
        run: npx playwright test --list
`;
check("同じモードの build の後の preview は良い", previewProblems(good), {
  problems: [],
  previewRuns: 1,
});
check(
  "build が無い preview は落とす",
  previewProblems(good.replace("run: npm run build:e2e", "run: echo")).problems
    .length,
  1,
);
check(
  "モードの違う build は落とす（撮りの束で再生しない）",
  previewProblems(
    good.replace(
      "          E2E_RECORD: '1'\n        run: npm",
      "          X: '1'\n        run: npm",
    ),
  ).problems.length,
  1,
);
check(
  "dev のままの実行は落とす",
  previewProblems(good.replace("          E2E_SERVE: preview\n", "")).problems
    .length,
  1,
);

// 今のワークフロー: 4つ（PR ゲートの e2e-shard・e2e-light、撮り、strict 再生、Live）
for (const [file, expectedRuns] of [
  ["e2e-smoke-test.yml", 2],
  ["e2e-rerecord.yml", 2],
  ["e2e-live.yml", 1],
]) {
  const yaml = readFileSync(
    path.join(repoRoot, ".github/workflows", file),
    "utf8",
  );
  const { problems, previewRuns } = previewProblems(yaml);
  check(`${file}: preview の段の前に同じモードの build がある`, problems, []);
  check(`${file}: preview で流す段の数`, previewRuns, expectedRuns);
}

if (failures.length > 0) {
  console.error("NG: e2e の束の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e の束の判定${checked}件を検証`);
