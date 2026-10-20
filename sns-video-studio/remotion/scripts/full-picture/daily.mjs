/**
 * 全貌動画の毎日の実行（hq の集客部署が回す1本のコマンド）。2つの使い方:
 *
 *   選ぶ: node scripts/full-picture/daily.mjs --select --date YYYY-MM-DD [--count N] --plan-only
 *     → 標準出力に JSON 1つ {status, plan: [{race_id, deadline}]}
 *   作る: node scripts/full-picture/daily.mjs <race_id> --out <dir> --bgm <mp3> [--concurrency N] [--text connected|template]
 *     → 標準出力に JSON 1つ {status, stage, reasons, files, video{full_s,entry_s,full_mib}, llm{calls,tokens_in,tokens_out},
 *        text_mode, missing, ref_commit}
 *   exit: 0 合格、1 止める、2 使い方の誤り。ログは標準エラーに出す（標準出力は JSON だけ）
 *
 * 作る中身: 材料（--stage racecard、失敗したら1回だけ取り直す）→ run-full.mjs（完全版・入口版・bundle）→ 止める判定 →
 * 送信の道の受け取りの検査（push-full-picture.js の checkFullPicture。DB・Storage に書かない範囲）。送信そのものは含めない。
 *
 * 鍵の分け方（docs/design/full-picture-remotion/plan.md「毎日の実行」）: このコマンドは送信をしないので service key を読まない。
 * 材料の取得に要るのは Supabase の匿名の読み取り（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY、画面の配信物と同じ公開キー）だけで、
 * --env-file を使わず、.env.local からこの2つだけを読む。子のプロセス（run-full と、その中の claude）には、鍵らしい名前の環境変数を渡さない。
 * 送信は今までどおり push-full-picture.js（node --env-file=.env.local）が受け持つ。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fetchMaterials } from "./fetch-materials.mjs";
import { validate } from "./materials-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REMOTION = resolve(HERE, "../..");
const ROOT = resolve(REMOTION, "../..");
const BASE = process.env.FULL_PICTURE_API_BASE ?? "https://www.boat-ai.jp";

/** 選び方の規則（龍神が持つ。2026-10-20 hq の規則）: 締切 21:58 前・中止でない優勝戦か準優勝戦のうち締切の一番遅いもの。無ければ 12R の一番遅いもの */
export const SELECT_RULE = { deadlineBefore: "21:58", stages: ["優勝戦", "準優勝戦"], fallbackRace: 12 };

/**
 * その日の出走表から作るレースを選ぶ（純粋関数）
 * @param {{raceId: string, raceNumber: number, startTime: string|null, raceStage: string|null, cancellationStatus: string|null}[]} races
 * @param {string} date YYYY-MM-DD
 * @param {number} count
 * @returns {{race_id: string, deadline: string}[]}
 */
export function selectRaces(races, date, count = 1) {
  const ok = (races ?? []).filter((r) => r.startTime && r.startTime < SELECT_RULE.deadlineBefore && !r.cancellationStatus);
  const byLate = (a, b) => b.startTime.localeCompare(a.startTime) || a.raceId.localeCompare(b.raceId);
  const finals = ok.filter((r) => SELECT_RULE.stages.some((s) => (r.raceStage ?? "").includes(s))).sort(byLate);
  const twelve = ok.filter((r) => r.raceNumber === SELECT_RULE.fallbackRace).sort(byLate);
  const picked = [...finals, ...twelve.filter((r) => !finals.includes(r))].slice(0, count);
  return picked.map((r) => ({ race_id: r.raceId, deadline: new Date(`${date}T${r.startTime}+09:00`).toISOString() }));
}

/**
 * 子のプロセスに渡す環境変数（鍵らしい名前を外す。材料の取得の公開キーも子には要らない）。
 * claude の認証（CLAUDE_*・ANTHROPIC_*）だけは残す（つないだ版の LLM がログイン済みの claude で動くため）
 */
export function childEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => /^(CLAUDE_|ANTHROPIC_)/.test(k) || !/KEY|SECRET|TOKEN|PASSWORD|SERVICE|WEBHOOK|SUPABASE/i.test(k)),
  );
}

/** .env.local から読む名前（材料の取得の匿名の読み取りだけ） */
export const ANON_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
export function readAnonEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && ANON_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const log = (...a) => console.error(...a);
/** 結果の JSON を出して終わる */
function finish(result, code) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(code);
}

/** 材料を取る（失敗＝例外・契約に合わない・facts か展開が無い、なら1回だけ取り直す） */
async function materials(raceId) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const m = await fetchMaterials(raceId, { stage: "racecard" });
      const errs = validate(m);
      const lacking = ["facts", "scenario"].filter((k) => !m.api[k]);
      // 鍵の設定の誤り（匿名キーが無い）は取り直しても直らず、場面3・6が黙って欠けるので止める
      const config = m.missing.filter((x) => /匿名キーが無い/.test(x.reason)).map((x) => `${x.source}: ${x.reason}`);
      if (config.length) return { m: null, reasons: config };
      if (!errs.length && !lacking.length) return { m, attempts: attempt };
      last = [...errs.slice(0, 5), ...lacking.map((k) => `材料 ${k} が無い`)];
    } catch (e) {
      last = [e instanceof Error ? e.message : String(e)];
    }
    log(`[材料] ${attempt}回目が失敗: ${last.join(" / ")}`);
  }
  return { m: null, reasons: last };
}

async function make(raceId, { out, bgm, concurrency, text }) {
  const result = { status: "stopped", stage: "materials", reasons: [], files: {}, video: null, llm: null, text_mode: text, missing: [], ref_commit: null };
  try {
    result.ref_commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    result.ref_commit = null;
  }
  mkdirSync(out, { recursive: true });
  const got = await materials(raceId);
  if (!got.m) return finish({ ...result, reasons: got.reasons }, 1);
  result.missing = got.m.missing;
  const matPath = join(out, "materials.json");
  writeFileSync(matPath, JSON.stringify(got.m));

  result.stage = "run-full";
  const args = [join(HERE, "run-full.mjs"), matPath, out, "--text", text, "--bgm", bgm, ...(concurrency ? ["--concurrency", String(concurrency)] : [])];
  const r = spawnSync(process.execPath, args, { cwd: REMOTION, env: childEnv(process.env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0) {
    const lines = (r.stderr ?? "").split("\n").filter((l) => l && !l.startsWith("[省いた要素]"));
    return finish({ ...result, reasons: lines.slice(-10) }, r.status === 2 ? 2 : 1);
  }

  result.stage = "bundle";
  const bundleDir = join(out, "bundle");
  const bundlePath = join(bundleDir, "bundle.json");
  if (!existsSync(bundlePath)) return finish({ ...result, reasons: ["bundle.json が無い"] }, 1);
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const runText = JSON.parse(readFileSync(join(out, `run-${text}.json`), "utf8"));
  const runEntry = JSON.parse(readFileSync(join(out, "run-entry.json"), "utf8"));
  result.video = {
    full_s: runText.videoSeconds,
    entry_s: runEntry.videoSeconds,
    full_mib: Math.round((statSync(join(bundleDir, "full-youtube.mp4")).size / 1048576) * 10) / 10,
  };
  result.llm = runText.llm ?? { calls: runText.llmCalls ?? 0, tokens_in: null, tokens_out: null };
  result.files = {
    bundle_dir: bundleDir,
    bundle: bundlePath,
    x: join(bundleDir, "full-x.mp4"),
    youtube: join(bundleDir, "full-youtube.mp4"),
    shorts: join(bundleDir, "shorts.mp4"),
    stills_full: join(out, text, "stills"),
    stills_entry: join(out, "entry", "stills"),
  };

  // 送信の道の受け取りの検査（DB・Storage に書かない範囲）。評価役の P0 は hq の側なので、その理由だけは止める理由に数えない
  result.stage = "push-check";
  const { checkFullPicture, MAX_BYTES } = await import(join(ROOT, "scripts/sns/push-full-picture.js"));
  const riskRules = JSON.parse(readFileSync(join(REMOTION, "risk-rules.json"), "utf8")).rules;
  const reasons = checkFullPicture(bundle, riskRules).filter((x) => !x.includes("評価役の P0"));
  for (const [k, file] of [["x", result.files.x], ["youtube", result.files.youtube]])
    if (statSync(file).size > MAX_BYTES[k]) reasons.push(`${file} が上限 ${MAX_BYTES[k]} バイトを越える`);
  if (reasons.length) return finish({ ...result, reasons }, 1);
  return finish({ ...result, status: "ok", stage: "done", reasons: [] }, 0);
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
  };
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  const usage = (msg) => finish({ status: "usage", reasons: [msg] }, 2);
  // 材料の取得の匿名キー（.env.local からこの2つだけ。--env-file は使わない）
  Object.assign(process.env, { ...readAnonEnv(opt("--anon-env") ?? join(ROOT, ".env.local")), ...Object.fromEntries(ANON_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) });

  if (flag("--select")) {
    const date = opt("--date");
    const count = Number(opt("--count") ?? 1);
    const planOnly = flag("--plan-only");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(count) || count < 1 || !planOnly)
      return usage("使い方: daily.mjs --select --date YYYY-MM-DD [--count N] --plan-only");
    try {
      const res = await fetch(`${BASE}/api/predictions/${date}`);
      if (!res.ok) throw new Error(`/api/predictions/${date}: HTTP ${res.status}`);
      const plan = selectRaces((await res.json()).races, date, count);
      return finish({ status: plan.length ? "ok" : "stopped", stage: "select", reasons: plan.length ? [] : ["規則に合うレースが無い"], plan, rule: SELECT_RULE }, plan.length ? 0 : 1);
    } catch (e) {
      return finish({ status: "stopped", stage: "select", reasons: [e instanceof Error ? e.message : String(e)], plan: [] }, 1);
    }
  }
  const out = opt("--out");
  const bgm = opt("--bgm");
  const concurrency = opt("--concurrency");
  const text = opt("--text") ?? "connected";
  const [raceId] = args;
  if (!raceId || !/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(raceId) || !out || !bgm || !["connected", "template"].includes(text))
    return usage("使い方: daily.mjs <race_id> --out <dir> --bgm <mp3> [--concurrency N] [--text connected|template]");
  if (!existsSync(bgm)) return usage(`BGM が無い: ${bgm}`);
  return make(raceId, { out: resolve(out), bgm: resolve(bgm), concurrency, text });
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
