/**
 * 見張りの CLI（cost-alerts・cron-watch・actions-fresh・competitor-watch・費用の取得）が写して重ねていた部品の正本:
 * Keychain の汎用パスワードの読み・Slack の webhook の鍵名・「新しい警報だけ」・Slack への POST・状態の原子書き。
 * 値（webhook・トークン）は戻り値でだけ返し、文・ログに入れない。
 * 検証: scripts/maintenance/verify-alert-kit.js
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SLACK_WEBHOOK_KEYCHAIN = {
  service: "hq-slack-webhook",
  account: "hq",
};

const SLACK_TIMEOUT_MS = 15000;

/**
 * Keychain の汎用パスワード。無ければ（読めなければ）null。標準エラーも捨てる
 * @param {string} service
 * @param {string} account
 * @param {typeof execFileSync} [run] 実行の口（試験で差し替える）
 */
export function readKeychain(service, account, run = execFileSync) {
  try {
    const v = run(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return String(v).trim() || null;
  } catch {
    return null;
  }
}

/** まだ出していない警報だけ（鍵が state.notified に無い物） */
export const freshAlerts = (alerts, state) =>
  alerts.filter((a) => !(a.key in (state?.notified ?? {})));

/**
 * Slack に1回 POST。例外は投げず { ok, status }（打ち切り・通信の失敗は status にエラー名。文に webhook を入れない）
 * @param {string} hook
 * @param {string} text
 * @param {typeof fetch} fetchImpl
 */
export async function postSlack(hook, text, fetchImpl) {
  const res = await fetchImpl(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  }).catch((e) => ({ ok: false, status: e?.name ?? "Error" }));
  return { ok: Boolean(res.ok), status: res.status };
}

/** 状態の JSON を同じ場所の一時ファイル経由で置き換える（途中で止まっても半端な物を残さない）。親の場所が無ければ作る */
export function writeStateAtomic(file, state) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}
