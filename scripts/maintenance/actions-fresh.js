#!/usr/bin/env node
/**
 * Actions の「最後の起動が古い」の検知 CLI（hq の dashboard-collect.py の stale_workflows・dashboard_alerts_ops.py の
 * actions_stale の移し、2026-11-26 窓口の依頼。ID04: 見張り・突き合わせ自身が止まったことは内側から知れない）。
 * workflow ごと・起動の種類ごとに、最後の起動が線の時間より古ければ high。launchd（30分ごと）で回す。
 *
 * - 線は下の LINES（目安・根拠なし）。起動の種類: any（どの起動も）・schedule・workflow_dispatch 等の event 名・
 *   success（event を問わず結論が success の run だけ。起動を絞った後の skip の run で緑のままにならないため、BOA-45）
 * - 取得: 公開リポジトリの GitHub API（トークン無し。workflow・線ごとに1件だけ読む。無認証の上限は1時間60回で、4本×2回/時＝8回）
 * - 状態: リポジトリの外 ~/.config/ryujin/private/actions-fresh/（RYUJIN_ACTIONS_FRESH_DIR）の state.json（出した警報の鍵・連続の失敗）
 * - 知らせは Slack（Keychain の hq-slack-webhook / hq）。新しい警報だけ1回、出せなければ覚えない。直ったら鍵を忘れる（次に止まればまた出す）
 *
 * 検証: scripts/maintenance/verify-actions-fresh.js（時計と取得を固定。判定は verify-actions-fresh-judge.js）
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINES, runsUrl, staleAlerts } from "./actions-fresh-judge.js";

export const ERR_STREAK = 2; // 取得の失敗がこの回数続いたら mid（見えていないことを知らせる）
const HOUR = 3600 * 1000;
const jstDay = (now) =>
  new Date(now.getTime() + 9 * HOUR).toISOString().slice(0, 10);

/** 線ごとの最後の起動の時刻（無ければ null）。取れなければ例外（文に本文は入れない） */
async function lastRuns(lines, fetchImpl) {
  return Promise.all(
    lines.map(async (line) => {
      const res = await fetchImpl(runsUrl(line), {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(30000),
      }).catch((e) => {
        throw new Error(`GitHub に繋がらない（${e?.name ?? "Error"}）`);
      });
      if (!res.ok)
        throw new Error(
          `GitHub の問い合わせが HTTP ${res.status}（${line.workflow}）`,
        );
      const json = await res.json().catch(() => null);
      if (!Array.isArray(json?.workflow_runs))
        throw new Error("GitHub の応答に workflow_runs が無い");
      return json.workflow_runs[0]?.created_at ?? null;
    }),
  );
}

/**
 * 取得から Slack まで（I/O は受け取る）。戻りは次の state と標準出力の1行
 * @param {{state: object|null, now: Date, readWebhook: () => string|null, fetchImpl: typeof fetch, lines?: object[]}} io
 */
export async function runFresh({
  state,
  now,
  readWebhook,
  fetchImpl,
  lines = LINES,
}) {
  const prev = state ?? {};
  let found;
  try {
    found = staleAlerts(lines, await lastRuns(lines, fetchImpl), now);
  } catch (e) {
    const streak = (prev.err_streak ?? 0) + 1;
    const reason = String(e?.message ?? e?.name ?? "Error").slice(0, 120);
    found =
      streak >= ERR_STREAK
        ? [
            {
              key: "actions_fresh_unknown",
              level: "mid",
              text: `龍神の Actions の起動の鮮度を ${streak}回続けて読めない（${reason}）。見えていない。`,
            },
          ]
        : [];
    const r = await notify({
      prev: { ...prev, err_streak: streak },
      found,
      now,
      readWebhook,
      fetchImpl,
    });
    return {
      ...r,
      ok: false,
      line: `actions-fresh: 取得に失敗（${reason}）。${r.line}`,
    };
  }
  const r = await notify({
    prev: { ...prev, err_streak: 0 },
    found,
    now,
    readWebhook,
    fetchImpl,
  });
  return { ...r, line: `actions-fresh: ${r.line}` };
}

/** 新しい警報だけ Slack に1回。今も続いている鍵だけ覚える（直った鍵は忘れる）。出せなければ覚えない */
async function notify({ prev, found, now, readWebhook, fetchImpl }) {
  const active = new Set(found.map((a) => a.key));
  const kept = Object.fromEntries(
    Object.entries(prev.notified ?? {}).filter(([k]) => active.has(k)),
  );
  const fresh = found.filter((a) => !(a.key in kept));
  const done = (ok, line, notified = kept) => ({
    ok,
    state: { ...prev, notified },
    line,
  });
  if (fresh.length === 0) return done(true, "新しい警報なし");
  const keys = fresh.map((a) => a.key).join(", ");
  const hook = readWebhook();
  if (!hook)
    return done(
      false,
      `Keychain に Slack の webhook が無い（${fresh.length} 件を出せない: ${keys}）`,
    );
  const text = `:rotating_light: Actions の鮮度の警報（龍神 actions-fresh）\n${fresh.map((a) => `• [${a.level}] ${a.text}`).join("\n")}`;
  const res = await fetchImpl(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ ok: false, status: e?.name ?? "Error" }));
  if (!res.ok)
    return done(
      false,
      `Slack に出せない（${res.status}）。次の回にもう一度出す`,
    );
  const day = jstDay(now);
  return done(
    true,
    `新しい警報 ${fresh.length} 件を Slack に出した（${keys}）`,
    {
      ...kept,
      ...Object.fromEntries(fresh.map((a) => [a.key, day])),
    },
  );
}

// ---- ここから I/O（main だけ） ----

/** Keychain の汎用パスワード。無ければ null。値は返すだけで出さない */
function secret(service, account) {
  const r = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", service, "-a", account, "-w"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function main() {
  const dir =
    process.env.RYUJIN_ACTIONS_FRESH_DIR ||
    path.join(os.homedir(), ".config/ryujin/private/actions-fresh");
  const statePath = path.join(dir, "state.json");
  const r = await runFresh({
    state: existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : null,
    now: new Date(),
    readWebhook: () => secret("hq-slack-webhook", "hq"),
    fetchImpl: fetch,
  });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${statePath}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(r.state, null, 1), { mode: 0o600 });
  renameSync(tmp, statePath);
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
        `actions-fresh: ${e?.name ?? "Error"}: ${String(e?.message ?? "").slice(0, 160)}`,
      );
      process.exit(1);
    },
  );
}
