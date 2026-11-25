#!/usr/bin/env node
/**
 * 費用の警報を束ねて Slack に1行ずつ出す CLI（hq の dashboard-alerts の費用の警報の移し、2026-11-25 窓口の依頼）。
 * 判定は cost-alerts-month.js（月の見込み・サービス別の上限）と cost-alerts-other.js（前払い・急増・取得・期限）。
 * launchd（com.terukina.ryujin.fetch-costs）の同じ回で fetch-costs.js の後に回す。
 *
 * - 材料: リポジトリの外 ~/.config/ryujin/private/costs/（RYUJIN_COSTS_DIR）の costs.jsonl・budgets.json・fetch-state.json
 * - 同じ警報は1回だけ出す（鍵に月や日を含む。出した鍵は alerts-state.json）。Slack に出せなかった回は覚えず、次の回にまた出す
 * - Slack の webhook は Keychain（hq-slack-webhook / hq）から読み、値は出さない。金額は Slack にだけ出し、標準出力には件数と鍵だけ
 *
 * 検証: scripts/maintenance/verify-cost-alerts.js
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { monthAlerts } from "./cost-alerts-month.js";
import { otherAlerts } from "./cost-alerts-other.js";

export const WEBHOOK_KEYCHAIN = { service: "hq-slack-webhook", account: "hq" };

/** 警報の一覧（純関数）。today は JST の日（YYYY-MM-DD） */
export const costAlerts = (cfg, rows, fetchState, today) => [
  ...monthAlerts(cfg, rows, today),
  ...otherAlerts(cfg, rows, fetchState, today),
];

/** まだ出していない警報だけ */
export const freshAlerts = (alerts, state) =>
  alerts.filter((a) => !(a.key in (state?.notified ?? {})));

/** JST の日 */
export const jstDay = (now) =>
  new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 判定から送るまで（I/O は受け取る）。戻りは次の状態と、標準出力に出す1行（金額・webhook を含まない）
 * @param {{cfg: object, rows: object[], fetchState: object|null, state: {notified?: Record<string, string>}|null, now: Date,
 *   readWebhook: () => string|null, fetchImpl: typeof fetch}} io
 */
export async function runAlerts({
  cfg,
  rows,
  fetchState,
  state,
  now,
  readWebhook,
  fetchImpl,
}) {
  const today = jstDay(now);
  const fresh = freshAlerts(costAlerts(cfg, rows, fetchState, today), state);
  const keys = fresh.map((a) => a.key).join(", ");
  if (fresh.length === 0)
    return { ok: true, state: null, line: "cost-alerts: 新しい警報なし" };
  const hook = readWebhook();
  if (!hook)
    return {
      ok: false,
      state: null,
      line: `cost-alerts: Keychain に Slack の webhook が無い（新しい警報 ${fresh.length} 件を出せない: ${keys}）`,
    };
  const text = `:money_with_wings: 費用の警報（龍神 cost-alerts）\n${fresh.map((a) => `• ${a.text}`).join("\n")}`;
  const res = await fetchImpl(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ ok: false, status: e?.name ?? "Error" }));
  if (!res.ok)
    return {
      ok: false,
      state: null,
      line: `cost-alerts: Slack に出せない（${res.status}）。次の回にもう一度出す`,
    };
  const notified = {
    ...(state?.notified ?? {}),
    ...Object.fromEntries(fresh.map((a) => [a.key, today])),
  };
  return {
    ok: true,
    state: { notified },
    line: `cost-alerts: 新しい警報 ${fresh.length} 件を Slack に出した（${keys}）`,
  };
}

// ---- ここから I/O（main だけ） ----

const readJson = (f, fallback) =>
  existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback;

function readKeychain({ service, account }) {
  try {
    const v = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return v || null;
  } catch {
    return null;
  }
}

async function main() {
  const dir =
    process.env.RYUJIN_COSTS_DIR ||
    path.join(os.homedir(), ".config/ryujin/private/costs");
  const statePath = path.join(dir, "alerts-state.json");
  const r = await runAlerts({
    cfg: readJson(path.join(dir, "budgets.json"), null),
    rows: readFileSync(path.join(dir, "costs.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
    fetchState: readJson(path.join(dir, "fetch-state.json"), null),
    state: readJson(statePath, { notified: {} }),
    now: new Date(),
    readWebhook: () => readKeychain(WEBHOOK_KEYCHAIN),
    fetchImpl: fetch,
  });
  if (r.state) {
    const tmp = `${statePath}.tmp${process.pid}`;
    writeFileSync(tmp, JSON.stringify(r.state, null, 1), { mode: 0o600 });
    renameSync(tmp, statePath);
  }
  (r.ok ? console.log : console.error)(r.line);
  return r.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(
        `cost-alerts: ${e?.name ?? "Error"}: ${String(e?.message ?? "").slice(0, 160)}`,
      );
      process.exit(1);
    },
  );
}
