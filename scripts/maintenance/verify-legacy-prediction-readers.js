#!/usr/bin/env node
/**
 * verify-legacy-prediction-readers.js — 止める予定の予想・列の名前を、新しいファイルに広げない（基盤の計画 R1・R2）。
 *
 * 設計: docs/design/legacy-prediction-cleanup/plan.md（R-0）。止める物は、廃止した3モデルのうち safeBet・upsetFocus の
 * 予想、prediction_odds、race_entries.ai_score_*（R1）と、races の旧い荒れ度の5列（R2）。止める作業の途中で
 * 新しい読み手が増えると、止めた日に壊れる。そこで、名前の文字列が出てくるファイルの一覧を
 * legacy-prediction-readers.json に固定し、次で見る。
 *   1. 落とす: 一覧に無いファイルに名前が出てきた（新しい読み手・書き手。止める物を使わずに書く）
 *   2. 知らせるだけ: 一覧にあるファイルから名前が消えた・ファイルが無くなった（--prune で一覧から外す。他のレーンの PR を止めない）
 * 一覧は減る向きにだけ動く。台帳（data-readers.md）は表・列・RPC の名前で見るので、model_id の値と JSON の鍵
 * （predictions.safeBet 等）は拾わない。これはその穴を文字列で埋める。
 *
 *   node scripts/maintenance/verify-legacy-prediction-readers.js          # 検査
 *   node scripts/maintenance/verify-legacy-prediction-readers.js --prune  # 名前が消えたファイルを一覧から外す（足さない）
 *
 * DB に触れない。git ls-files の src・api・scripts・sns-video-studio のソースだけを読む。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const LIST_FILE = "scripts/maintenance/legacy-prediction-readers.json";
const SELF = "scripts/maintenance/verify-legacy-prediction-readers.js";
const SOURCE_ROOTS = ["src", "api", "scripts", "sns-video-studio"];
const SOURCE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|py|sql|sh)$/;

/**
 * 名前ごとに、それが出てくるファイルの集合を作る（部分一致。safeBetPlayers も safeBet に当たる）。
 * @param {string[]} tokens
 * @param {Array<{ file: string, text: string }>} files
 * @returns {Record<string, string[]>}
 */
export function findMentions(tokens, files) {
  const out = {};
  for (const token of tokens) {
    out[token] = files
      .filter(({ text }) => text.includes(token))
      .map(({ file }) => file)
      .sort();
  }
  return out;
}

/**
 * 固定した一覧と今の出現を比べる。
 * @param {Record<string, { files: string[] }>} listed
 * @param {Record<string, string[]>} found
 * @returns {{ added: Array<{ token: string, file: string }>, stale: Array<{ token: string, file: string }>,
 *   unsorted: string[] }}
 */
export function compareMentions(listed, found) {
  const added = [];
  const stale = [];
  const unsorted = [];
  for (const [token, { files }] of Object.entries(listed)) {
    const now = new Set(found[token] ?? []);
    const before = new Set(files);
    for (const file of now) if (!before.has(file)) added.push({ token, file });
    for (const file of before) if (!now.has(file)) stale.push({ token, file });
    if (JSON.stringify(files) !== JSON.stringify([...files].sort()))
      unsorted.push(token);
  }
  return { added, stale, unsorted };
}

function trackedSources() {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...SOURCE_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => f && SOURCE_EXT.test(f) && f !== SELF)
    .map((file) => ({
      file,
      text: readFileSync(path.join(ROOT, file), "utf8"),
    }));
}

function selfTest() {
  const failures = [];
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push(
        `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
      );
  };
  const files = [
    { file: "b.js", text: "const safeBetPlayers = 1;" },
    { file: "a.js", text: 'from("prediction_odds")' },
    { file: "c.js", text: "unified only" },
  ];
  const found = findMentions(["safeBet", "prediction_odds"], files);
  eq("部分一致で拾う", found.safeBet, ["b.js"]);
  eq("ファイルの名前の順", findMentions(["o"], files).o, [
    "a.js",
    "b.js",
    "c.js",
  ]);
  eq(
    "増えたファイルは added",
    compareMentions({ safeBet: { files: [] } }, found).added,
    [{ token: "safeBet", file: "b.js" }],
  );
  eq(
    "消えたファイルは stale",
    compareMentions({ prediction_odds: { files: ["a.js", "z.js"] } }, found)
      .stale,
    [{ token: "prediction_odds", file: "z.js" }],
  );
  eq(
    "一覧の並びが崩れていれば unsorted",
    compareMentions(
      { safeBet: { files: ["c.js", "b.js"] } },
      {
        safeBet: ["b.js", "c.js"],
      },
    ).unsorted,
    ["safeBet"],
  );
  eq(
    "一致すれば何も出ない",
    compareMentions({ safeBet: { files: ["b.js"] } }, found),
    { added: [], stale: [], unsorted: [] },
  );
  return failures;
}

function main() {
  const failures = selfTest();
  if (failures.length) {
    console.error("verify-legacy-prediction-readers: 自己検査の失敗");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const list = JSON.parse(readFileSync(path.join(ROOT, LIST_FILE), "utf8"));
  const tokens = Object.keys(list.tokens);
  const found = findMentions(tokens, trackedSources());
  const { added, stale, unsorted } = compareMentions(list.tokens, found);

  if (process.argv.includes("--prune")) {
    const pruned = { ...list, tokens: {} };
    for (const [token, entry] of Object.entries(list.tokens)) {
      const now = new Set(found[token]);
      pruned.tokens[token] = {
        ...entry,
        files: entry.files.filter((f) => now.has(f)).sort(),
      };
    }
    writeFileSync(
      path.join(ROOT, LIST_FILE),
      `${JSON.stringify(pruned, null, 2)}\n`,
    );
    console.log(
      `verify-legacy-prediction-readers: 一覧から ${stale.length} 件を外した（足すものは足さない: ${added.length} 件）`,
    );
    return;
  }

  const lines = [];
  for (const { token, file } of added)
    lines.push(
      `${file} に ${token} が出てくる。止める予定の物（docs/design/legacy-prediction-cleanup/plan.md）なので、新しい読み手・書き手を作らない。今の物（standard・unified の予想、unified の volatilityPercentile、race_odds）を使う`,
    );
  // 消えた側は落とさず知らせるだけ。止める物に触れる他のレーンの PR（例 BOA-1110 の段階2）を、
  // 一覧の手入れのために止めない。残った行は、その名前がそのファイルにまた出てくるのを見逃すだけ
  for (const { token, file } of stale)
    console.warn(
      `verify-legacy-prediction-readers: 注意: ${file} から ${token} が消えた（またはファイルが無い）。node ${SELF} --prune で一覧から外せる`,
    );
  for (const token of unsorted)
    lines.push(`${LIST_FILE} の ${token} の files が名前の順でない`);
  if (lines.length) {
    console.error(`verify-legacy-prediction-readers: ${lines.length} 件`);
    for (const l of lines) console.error(`  - ${l}`);
    process.exit(1);
  }
  const total = Object.values(found).reduce((n, f) => n + f.length, 0);
  console.log(
    `verify-legacy-prediction-readers: ${tokens.length} 個の名前・${total} 件の出現が一覧どおり（増えていない）`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
