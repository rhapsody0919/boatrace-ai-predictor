/**
 * マージ順の台帳。「PR 901 は 902 のマージ後に」という順序を、並行セッションのオーケストレーションが
 * 登録し、guard-pr-merge.js が `gh pr merge` の前に確かめる（ADR-0075）。
 *
 * 台帳は `$(git rev-parse --git-common-dir)/merge-order.json`。全 worktree から同じファイルが見え、
 * コミットはしない（順序は数時間で役目を終える運用上の状態で、履歴に残す価値が無いため）。
 *
 * 形式: {"rules":[{"pr":901,"after":[902]},{"pr":905,"after":[]}]}
 *
 * テストでは環境変数 MERGE_ORDER_LEDGER で台帳のパスを差し替える。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LEDGER_FILE = "merge-order.json";

/** 台帳のパス。git が使えなければ null。 */
export function ledgerPath(cwd) {
  if (process.env.MERGE_ORDER_LEDGER) return process.env.MERGE_ORDER_LEDGER;
  try {
    const dir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return path.join(dir, LEDGER_FILE);
  } catch {
    return null;
  }
}

const isPrNumber = (n) => Number.isInteger(n) && n > 0;

/** 台帳の中身を検査して返す。形式が崩れていれば例外（メッセージに何が悪いかを入れる）。 */
export function parseLedger(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.rules)) {
    throw new Error("rules 配列がありません");
  }
  for (const r of data.rules) {
    if (
      !isPrNumber(r?.pr) ||
      !Array.isArray(r.after) ||
      !r.after.every(isPrNumber)
    ) {
      throw new Error(`規則の形式が不正です: ${JSON.stringify(r)}`);
    }
  }
  return data;
}

/** 台帳を読む。ファイルが無ければ空の台帳。形式が崩れていれば例外。 */
export function readLedger(file) {
  if (!existsSync(file)) return { rules: [] };
  return parseLedger(readFileSync(file, "utf8"));
}

export function writeLedger(file, ledger) {
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** pr より先にマージされているべき PR の一覧（台帳に無ければ空）。 */
export function prerequisitesOf(ledger, pr) {
  const n = Number(pr);
  return [
    ...new Set(ledger.rules.filter((r) => r.pr === n).flatMap((r) => r.after)),
  ];
}

/** pr の規則に after を足す（既存の after と合わせる）。新しい台帳を返す。 */
export function addRule(ledger, pr, after) {
  const merged = [...new Set([...prerequisitesOf(ledger, pr), ...after])];
  return {
    ...ledger,
    rules: [...ledger.rules.filter((r) => r.pr !== pr), { pr, after: merged }],
  };
}

/** pr の規則を消す。新しい台帳を返す。 */
export function removeRule(ledger, pr) {
  return { ...ledger, rules: ledger.rules.filter((r) => r.pr !== pr) };
}

/**
 * 先行PRの状態から判定する。states は {902: "OPEN", 903: "MERGED"}。
 * 状態が取れなかった（undefined）PRがあれば判断しない（null）。止める必要が無くても null。
 */
export function judgeMergeOrder(pr, prerequisites, states) {
  if (prerequisites.some((n) => states[n] === undefined)) return null;
  const pending = prerequisites.filter((n) => states[n] !== "MERGED");
  if (pending.length === 0) return null;
  const list = pending.map((n) => `#${n}（${states[n]}）`).join("・");
  return {
    decision: "deny",
    reason:
      `PR #${pr} より先にマージする ${list} が未マージです。` +
      `マージ順は並行セッションのオーケストレーションで管理しています` +
      `（node scripts/maintenance/merge-order.js list）。`,
  };
}
