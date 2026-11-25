#!/usr/bin/env node
/**
 * Vercel の請求（GET /v1/billing/charges、FOCUS の JSONL、1日粒度）を、日ごと・サービスごとの USD にしてリポジトリの外の台帳に書く。
 * hq の scripts/fetch-costs.py の Vercel の部分を龍神へ移した物（2026-11-25、窓口の依頼・オーナー「Mac に常駐を1本足してよい」）。
 * LLM の審査の実費の部分は移さない（2026-11-06 に LLM の審査をやめた）。
 *
 * - 置き場: ~/.config/ryujin/private/costs/（RYUJIN_COSTS_DIR で差し替え）。リポジトリにも gitignore の中にも置かない
 *   （worktree の写しで入り込むため）。costs.jsonl（1行1日1サービス: date・service・usd・source・fetched_at）・
 *   config.json（team_id・keychain_service・keychain_account・refetch_days。team の ID を公開の中身に入れない）・fetch-state.json
 * - 請求は約2日遅れで確定するので、直近 refetch_days 日を毎回取り直し、返ってきた日の Vercel の行は丸ごと置き換える
 *   （返ってこない日は残す）。0 ドルのサービスは書かない
 * - 鍵は macOS の Keychain の汎用パスワードだけ。値はログ・例外の文・ファイルに出さない。GitHub の secret・Actions は使わない
 * - 金額は標準出力・ログに出さない（日数と行数だけ）
 * - 起動: Mac の launchd（毎朝1回）。失敗は fetch-state.json と標準エラーに理由（鍵の値は入れない）を残し、終了コード 1
 *
 * 使い方:
 *   node scripts/maintenance/fetch-costs.js                 # 取り直して台帳を更新
 *   node scripts/maintenance/fetch-costs.js --import <file> # 台帳が空のときだけ、hq の ledger/costs.jsonl の行を写す（初回の1回）
 *
 * 検証: scripts/maintenance/verify-fetch-costs.js（時計と取得を固定して回す）
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

export const CHARGES_URL = "https://api.vercel.com/v1/billing/charges";
export const SOURCE = "vercel";
export const TIMEOUT_MS = 120 * 1000;

/** 取り直しの範囲（UTC の日。start を含み end を含まない。end は今日＝今日はまだ確定しない） */
export function refetchRange(now, refetchDays) {
  const end = now.toISOString().slice(0, 10);
  const s = new Date(`${end}T00:00:00Z`);
  s.setUTCDate(s.getUTCDate() - refetchDays);
  return { start: s.toISOString().slice(0, 10), end };
}

export function chargesUrl(teamId, { start, end }) {
  const q = new URLSearchParams({
    teamId,
    from: `${start}T00:00:00.000Z`,
    to: `${end}T00:00:00.000Z`,
  });
  return `${CHARGES_URL}?${q}`;
}

/** FOCUS の JSONL → Map「日\tサービス」→ USD。日は ChargePeriodStart の日付（UTC）。USD でない行・形の違う行は例外 */
export function aggregate(text) {
  const out = new Map();
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      throw new Error(`請求の ${i + 1} 行目が JSON でない`);
    }
    const day = String(r?.ChargePeriodStart ?? "").slice(0, 10);
    const cost = Number(r?.BilledCost);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !r?.ServiceName ||
      !Number.isFinite(cost)
    ) {
      throw new Error(`請求の ${i + 1} 行目の形が違う（日・サービス・金額）`);
    }
    if ((r.BillingCurrency ?? "USD") !== "USD") {
      throw new Error(`請求の ${i + 1} 行目の通貨が ${r.BillingCurrency}`);
    }
    const key = `${day}\t${r.ServiceName}`;
    out.set(key, (out.get(key) ?? 0) + cost);
  });
  return out;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** 返ってきた日（範囲の中）の Vercel の行を丸ごと置き換える。他の日・他の出どころの行は残す。0 ドルは書かない。並びは日・出どころ・サービス */
export function merge(rows, agg, { start, end }, fetchedAt) {
  const days = new Set(
    [...agg.keys()]
      .map((k) => k.split("\t")[0])
      .filter((d) => d >= start && d < end),
  );
  const kept = rows.filter((r) => !(r.source === SOURCE && days.has(r.date)));
  const added = [...agg.entries()]
    .map(([k, v]) => {
      const [date, service] = k.split("\t");
      return {
        date,
        service,
        usd: round6(v),
        source: SOURCE,
        fetched_at: fetchedAt,
      };
    })
    .filter((r) => days.has(r.date) && r.usd !== 0);
  const key = (r) => `${r.date}\t${r.source}\t${r.service}`;
  return [...kept, ...added].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
}

/**
 * 取得から台帳の行まで（I/O は受け取る）。鍵の値は戻り値・例外の文に入れない
 * @param {{config: {team_id: string, keychain_service: string, keychain_account: string, refetch_days: number},
 *   rows: object[], now: Date, readToken: (service: string, account: string) => string|null,
 *   fetchImpl: typeof fetch}} io
 * @returns {Promise<{ok: true, rows: object[], days: number, range: {start: string, end: string}} | {ok: false, error: string}>}
 */
export async function fetchCosts({ config, rows, now, readToken, fetchImpl }) {
  const range = refetchRange(now, Number(config.refetch_days ?? 7));
  const token = readToken(config.keychain_service, config.keychain_account);
  if (!token)
    return {
      ok: false,
      error: "Keychain に Vercel の請求のトークンが無い（取得なし）",
    };
  let text;
  try {
    const res = await fetchImpl(chargesUrl(config.team_id, range), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/jsonl",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok)
      return { ok: false, error: `Vercel の請求の API が HTTP ${res.status}` };
    text = await res.text();
  } catch (error) {
    // 例外の文はトークンを含みうる（ライブラリが要求を写す）ので、種類の名前だけを出す
    return {
      ok: false,
      error: `Vercel の請求の API に届かない: ${error?.name ?? "Error"}`,
    };
  }
  let agg;
  try {
    agg = aggregate(text);
  } catch (error) {
    return { ok: false, error: error.message.slice(0, 160) };
  }
  const merged = merge(rows, agg, range, now.toISOString());
  const days = new Set(
    [...agg.keys()]
      .map((k) => k.split("\t")[0])
      .filter((d) => d >= range.start && d < range.end),
  );
  return { ok: true, rows: merged, days: days.size, range };
}

/** 台帳が空のときだけ写す行（空でなければ null＝写さない） */
export function importRows(current, imported) {
  return current.length === 0 ? imported : null;
}

// ---- ここから I/O（main だけ） ----

const parseRows = (text) =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

function readRows(file) {
  return existsSync(file) ? parseRows(readFileSync(file, "utf8")) : [];
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

const rowsText = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");

/** Keychain の汎用パスワード。無ければ null。値は返すだけで出さない（標準エラーも捨てる） */
function readKeychain(service, account) {
  try {
    const v = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
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
  const ledger = path.join(dir, "costs.jsonl");
  const args = process.argv.slice(2);
  if (args[0] === "--import") {
    const rows = importRows(
      readRows(ledger),
      parseRows(readFileSync(args[1], "utf8")),
    );
    if (rows === null) {
      console.log(`台帳 ${ledger} は空でないので写さない`);
      return 0;
    }
    writeAtomic(ledger, rowsText(rows));
    console.log(`${rows.length} 行を ${ledger} に写した`);
    return 0;
  }
  const config = JSON.parse(
    readFileSync(path.join(dir, "config.json"), "utf8"),
  );
  const now = new Date();
  const r = await fetchCosts({
    config,
    rows: readRows(ledger),
    now,
    readToken: readKeychain,
    fetchImpl: fetch,
  });
  const statePath = path.join(dir, "fetch-state.json");
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : {};
  const day = now.toISOString().slice(0, 10);
  if (!r.ok) {
    const fail = [...new Set([...(state.fail_dates ?? []), day])].sort();
    writeAtomic(
      statePath,
      JSON.stringify(
        { ...state, last_attempt: day, fail_dates: fail, error: r.error },
        null,
        1,
      ),
    );
    console.error(`fetch-costs: ${r.error}`);
    return 1;
  }
  writeAtomic(ledger, rowsText(r.rows));
  writeAtomic(
    statePath,
    JSON.stringify(
      { last_attempt: day, last_ok: day, fail_dates: [], error: "" },
      null,
      1,
    ),
  );
  console.log(
    `Vercel: ${r.range.start}〜${r.range.end} を取り直し、${r.days}日分を置き換えた（台帳 ${r.rows.length} 行）`,
  );
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `fetch-costs: ${error?.name ?? "Error"}: ${String(error?.message ?? "").slice(0, 160)}`,
      );
      process.exit(1);
    },
  );
}
