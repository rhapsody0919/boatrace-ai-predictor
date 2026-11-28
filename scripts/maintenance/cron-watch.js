#!/usr/bin/env node
/**
 * Vercel Cron（/api/cron/*）の失敗の横断の見張り CLI（hq の scripts/cron_watch.py の移し、2026-11-26 窓口の依頼）。
 * 龍神の cronWrapper は失敗を HTTP 500 で返すので、Vercel Observability（POST /v2/observability/query）の
 * 経路×状態の数で見る（job-watch は Actions の失敗、scrape-monitor は scrape 系の Slack だけで、cron の HTTP の失敗は横断で見る物が無い）。
 * launchd（30分ごと）で回す。判定は cron-watch-judge.js（純関数）。
 *
 * - 材料と状態: リポジトリの外 ~/.config/ryujin/private/cron-watch/（RYUJIN_CRON_WATCH_DIR）の state.json
 *   （時間ごとの数・取れた所まで・出した警報の鍵）。設定は同じ場所の config.json（任意。無ければ costs の config.json の team_id と Keychain の名）
 * - Vercel のトークンは Keychain の汎用パスワード（既定は費用の取得と同じ）。値は戻り値・例外の文・標準出力・Slack に出さない
 * - 窓: 前回取れた終わりの1時間前（取り込みの遅れを拾い直す）から今まで、上限26時間。同じ時間は上書き（二重に数えない）。取れない回は前の数を消さない
 * - 知らせは Slack（Keychain の hq-slack-webhook / hq）。新しい警報だけ1回、出せなければ覚えず次の回にまた出す
 *
 * 検証: scripts/maintenance/verify-cron-watch.js（時計と取得を固定）
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SLACK_WEBHOOK_KEYCHAIN,
  freshAlerts,
  postSlack,
  readKeychain,
  writeStateAtomic,
} from "../lib/alertKit.js";
import { PROJECT_ID, step } from "./cron-watch-fetch.js";
import { judge } from "./cron-watch-judge.js";

export const WEBHOOK_KEYCHAIN = SLACK_WEBHOOK_KEYCHAIN;
export const ERR_STREAK = 2; // 問い合わせの失敗がこの回数続いたら mid（鍵の期限切れ等で盲目になるのを知らせる）
export const NOTIFIED_KEEP_DAYS = 45;
const HOUR = 3600 * 1000;
const jstDay = (now) =>
  new Date(now.getTime() + 9 * HOUR).toISOString().slice(0, 10);

/** state から出す警報（判定は毎回 state の数から出し直す＝取れない回も同じ key を保つ） */
export function alerts(st, now) {
  const out = judge(st.counts ?? {}, now, st.covered_from);
  if ((st.err_streak ?? 0) >= ERR_STREAK)
    out.push({
      key: "cron_watch_error",
      level: "mid",
      text: `Vercel Cron の見張りが ${st.err_streak}回続けて問い合わせに失敗（${st.last_error}）。見えていない。トークン（Keychain、期限切れ等）ならオーナー`,
    });
  return out;
}

/**
 * 取得から Slack まで（I/O は受け取る）。戻りは次の state と標準出力の1行（トークン・webhook を含まない）。
 * 出せなかった警報は notified に入れない（次の回にまた出す）。取れた数は出せなくても残す
 */
export async function runWatch({
  state,
  now,
  ids,
  readToken,
  readWebhook,
  fetchImpl,
}) {
  const st = await step({ state, now, ids, readToken, fetchImpl });
  const fresh = freshAlerts(alerts(st, now), st);
  const base = `cron-watch: ${st.err_streak ? `取得に失敗（${st.last_error}）` : "取得した"}`;
  const done = (ok, line, notified = st.notified) => ({
    ok: ok && !st.err_streak,
    state: { ...st, notified },
    line: `${base}。${line}`,
  });
  if (fresh.length === 0) return done(true, "新しい警報なし");
  const keys = fresh.map((a) => a.key).join(", ");
  const hook = readWebhook();
  if (!hook)
    return done(
      false,
      `Keychain に Slack の webhook が無い（${fresh.length} 件を出せない: ${keys}）`,
    );
  const text = `:rotating_light: Vercel Cron の警報（龍神 cron-watch）\n${fresh.map((a) => `• [${a.level}] ${a.text}`).join("\n")}`;
  const res = await postSlack(hook, text, fetchImpl);
  if (!res.ok)
    return done(
      false,
      `Slack に出せない（${res.status}）。次の回にもう一度出す`,
    );
  const today = jstDay(now);
  const cut = jstDay(new Date(now.getTime() - NOTIFIED_KEEP_DAYS * 24 * HOUR));
  const notified = Object.fromEntries(
    [
      ...Object.entries(st.notified ?? {}),
      ...fresh.map((a) => [a.key, today]),
    ].filter(([, d]) => d >= cut),
  );
  return done(
    true,
    `新しい警報 ${fresh.length} 件を Slack に出した（${keys}）`,
    notified,
  );
}

// ---- ここから I/O（main だけ） ----

const readJson = (f, fallback) =>
  existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback;

async function main() {
  const root = path.join(os.homedir(), ".config/ryujin/private");
  const dir =
    process.env.RYUJIN_CRON_WATCH_DIR || path.join(root, "cron-watch");
  const costs = readJson(path.join(root, "costs/config.json"), {});
  const ids = {
    team_id: costs.team_id,
    keychain_service: costs.keychain_service,
    keychain_account: costs.keychain_account,
    project_id: PROJECT_ID,
    ...readJson(path.join(dir, "config.json"), {}),
  };
  if (!ids.team_id || !ids.keychain_service) {
    console.error(
      "cron-watch: team_id と Keychain の名が無い（cron-watch/config.json か costs/config.json）",
    );
    return 1;
  }
  const statePath = path.join(dir, "state.json");
  const r = await runWatch({
    state: readJson(statePath, {}),
    now: new Date(),
    ids,
    readToken: readKeychain,
    readWebhook: () =>
      readKeychain(WEBHOOK_KEYCHAIN.service, WEBHOOK_KEYCHAIN.account),
    fetchImpl: fetch,
  });
  writeStateAtomic(path.join(dir, "state.json"), r.state);
  console[r.ok ? "log" : "error"](r.line);
  return r.ok ? 0 : 1;
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntry)
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(
        `cron-watch: ${e?.name ?? "Error"}: ${String(e?.message ?? "").slice(0, 160)}`,
      );
      process.exitCode = 1;
    },
  );
