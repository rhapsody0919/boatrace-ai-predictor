#!/usr/bin/env node
/**
 * merge-order.js - マージ順の台帳（scripts/lib/mergeOrder.js）を読み書きする。
 * 並行セッションのオーケストレーションが使う。guard-pr-merge.js が `gh pr merge` の前にこの台帳を見る。
 *
 * 使い方:
 *   node scripts/maintenance/merge-order.js list
 *   node scripts/maintenance/merge-order.js add 901 --after 902 [903 ...]   # 既存の after に足す
 *   node scripts/maintenance/merge-order.js add 905                        # 順序の制約なし（記録のみ）
 *   node scripts/maintenance/merge-order.js remove 901
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRule,
  ledgerPath,
  readLedger,
  removeRule,
  writeLedger,
} from "../lib/mergeOrder.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function fail(message) {
  console.error(`NG: ${message}`);
  process.exit(1);
}

function toPr(value) {
  const n = Number(String(value).replace(/^#/, ""));
  if (!Number.isInteger(n) || n <= 0) fail(`PR番号ではありません: "${value}"`);
  return n;
}

const [command, ...rest] = process.argv.slice(2);
const file = ledgerPath(repoRoot);
if (!file)
  fail(
    "git の共通ディレクトリを特定できません（リポジトリの中で実行してください）",
  );

let ledger;
try {
  ledger = readLedger(file);
} catch (err) {
  fail(`台帳を読めません（${file}）: ${err.message}`);
}

if (command === "list") {
  if (ledger.rules.length === 0) console.log(`（台帳は空です: ${file}）`);
  for (const r of ledger.rules) {
    console.log(
      `#${r.pr}${r.after.length ? ` ← ${r.after.map((n) => `#${n}`).join(", ")} の後` : "（制約なし）"}`,
    );
  }
} else if (command === "add") {
  const [pr, ...opts] = rest;
  if (!pr) fail("add には PR番号が要ります（add 901 --after 902）");
  const afterIdx = opts.indexOf("--after");
  // --after より前の引数（add 901 902 --after 903 等）を黙って捨てない
  const stray = afterIdx === -1 ? opts : opts.slice(0, afterIdx);
  if (stray.length > 0) fail(`不明な引数: ${stray.join(" ")}`);
  const after = afterIdx === -1 ? [] : opts.slice(afterIdx + 1).map(toPr);
  if (afterIdx !== -1 && after.length === 0)
    fail("--after の後に PR番号が要ります");
  const n = toPr(pr);
  if (after.includes(n)) fail(`#${n} を自分自身の後にはできません`);
  writeLedger(file, addRule(ledger, n, after));
  console.log(`OK: #${n} を登録しました（${file}）`);
} else if (command === "remove") {
  const n = toPr(rest[0]);
  if (!ledger.rules.some((r) => r.pr === n)) fail(`#${n} は台帳にありません`);
  writeLedger(file, removeRule(ledger, n));
  console.log(`OK: #${n} を削除しました`);
} else {
  fail(
    "使い方: merge-order.js list | add <PR> [--after <PR>...] | remove <PR>",
  );
}
