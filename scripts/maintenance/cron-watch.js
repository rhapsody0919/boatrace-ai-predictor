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
import { execFileSync } from "node:child_process";
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
import { judge } from "./cron-watch-judge.js";

export const API = "https://api.vercel.com/v2/observability/query";
export const WEBHOOK_KEYCHAIN = { service: "hq-slack-webhook", account: "hq" };
export const PROJECT_ID = "prj_9dVpwxadeVy5g1Q5mg3fwUuHyiiP"; // 龍神の Vercel project（識別子で秘密ではない）
export const KEEP_H = 26; // 時間ごとの数を持つ長さ（判定の24時間＋取り込みの遅れ）
export const RELAG_H = 1; // 前回の終わりのこの時間前から取り直す（取り込みの遅れ、未検証）
export const ERR_STREAK = 2; // 問い合わせの失敗がこの回数続いたら mid（鍵の期限切れ等で盲目になるのを知らせる）
export const NOTIFIED_KEEP_DAYS = 45;
const HOUR = 3600 * 1000;
const hourOf = (d) => d.toISOString().slice(0, 13);
const jstDay = (now) =>
  new Date(now.getTime() + 9 * HOUR).toISOString().slice(0, 10);

/** 取れなかった理由をそのまま state・標準出力に出してよい文（トークンを含まない）にする例外 */
export class WatchError extends Error {}

/** 問い合わせの窓 [開始, 終わり]（開始は時間の頭。KEEP_H より前には戻らない） */
export function queryWindow(queriedTo, now) {
  const floor = now.getTime() - KEEP_H * HOUR;
  const from = queriedTo
    ? Math.max(floor, Date.parse(queriedTo) - RELAG_H * HOUR)
    : floor;
  return [new Date(Math.floor(from / HOUR) * HOUR), now];
}

export const queryBody = (project, team, start, end) => ({
  metric: "vercel.request.count",
  scope: { type: "project", ownerId: team, projectIds: [project] },
  groupBy: ["request_path", "http_status"],
  limit: 500,
  granularity: { hours: 1 },
  startTime: `${start.toISOString().slice(0, 19)}Z`,
  endTime: `${end.toISOString().slice(0, 19)}Z`,
  filter: "startswith(request_path,'/api/cron/')",
});

/** { 時間: { 経路: { 状態: 数 } } }。窓の中の時間は今回の答えで置き換え、KEEP_H より古い時間は捨てる */
export function mergeCounts(old, rows, start, now) {
  const sKey = hourOf(start);
  const cut = hourOf(new Date(now.getTime() - KEEP_H * HOUR));
  const out = Object.fromEntries(
    Object.entries(old).filter(([h]) => h < sKey && h >= cut),
  );
  for (const r of rows) {
    const n = Number(r.vercel_request_count_sum);
    const h = hourOf(new Date(r.timestamp));
    if (!n || h < cut) continue;
    ((out[h] ??= {})[String(r.request_path)] ??= {})[String(r.http_status)] = n;
  }
  return out;
}

/** Observability に問い合わせて行を返す。失敗の文は HTTP の状態だけ（応答の本文・トークンは入れない） */
export async function queryRows({
  token,
  team,
  project,
  start,
  end,
  fetchImpl,
}) {
  const res = await fetchImpl(`${API}?teamId=${encodeURIComponent(team)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queryBody(project, team, start, end)),
    signal: AbortSignal.timeout(30000),
  }).catch((e) => {
    throw new WatchError(`Observability に繋がらない（${e?.name ?? "Error"}）`);
  });
  if (!res.ok)
    throw new WatchError(`Observability の問い合わせが HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json?.data))
    throw new WatchError("Observability の応答に data が無い");
  return json.data;
}

/** 1回分の取得。取れなければ数は残し err_streak を上げる（state を返す） */
export async function step({ state, now, ids, readToken, fetchImpl }) {
  const st = { ...(state ?? {}), at: now.toISOString() };
  const [start, end] = queryWindow(st.queried_to, now);
  try {
    const token = readToken(ids.keychain_service, ids.keychain_account);
    if (!token) throw new WatchError("Keychain に Vercel のトークンが無い");
    const rows = await queryRows({
      token,
      team: ids.team_id,
      project: ids.project_id,
      start,
      end,
      fetchImpl,
    });
    return {
      ...st,
      counts: mergeCounts(st.counts ?? {}, rows, start, now),
      queried_to: end.toISOString(),
      covered_from: st.covered_from ?? start.toISOString(),
      err_streak: 0,
      last_error: null,
    };
  } catch (e) {
    return {
      ...st,
      err_streak: (st.err_streak ?? 0) + 1,
      last_error: e instanceof WatchError ? e.message : (e?.name ?? "Error"),
    };
  }
}

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
  const fresh = alerts(st, now).filter((a) => !(a.key in (st.notified ?? {})));
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

/** Keychain の汎用パスワード。無ければ null。値は返すだけで出さない */
const readKeychain = (service, account) => {
  const args = ["find-generic-password", "-s", service, "-a", account, "-w"];
  try {
    const out = execFileSync("/usr/bin/security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
};

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
        `cron-watch: ${e?.name ?? "Error"}: ${String(e?.message ?? "").slice(0, 160)}`,
      );
      process.exit(1);
    },
  );
}
