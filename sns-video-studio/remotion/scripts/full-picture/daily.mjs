/**
 * 全貌動画の毎日の実行（hq の集客部署が回す1本のコマンド）。2つの使い方:
 *
 *   選ぶ: node scripts/full-picture/daily.mjs --select --date YYYY-MM-DD [--count N] --plan-only
 *     → 標準出力に JSON 1つ {status, plan: [{race_id, deadline, race_stage}]}
 *   作る: node scripts/full-picture/daily.mjs <race_id> --out <dir> --bgm <mp3> [--concurrency N] [--text connected|template] [--variant a|b]
 *     → 標準出力に JSON 1つ {status, stage, reasons, files, video{full_s,entry_s,full_mib}, llm{calls,tokens_in,tokens_out},
 *        text_mode, missing, ref_commit, variant}
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
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
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
 * @returns {{race_id: string, deadline: string, race_stage: string|null}[]} race_stage は race_conditions.race_stage の文字列そのまま（優勝戦・準優勝戦の判別は hq がする。hq SQ08 v5）
 */
export function selectRaces(races, date, count = 1) {
  const ok = (races ?? []).filter((r) => r.startTime && r.startTime < SELECT_RULE.deadlineBefore && !r.cancellationStatus);
  const byLate = (a, b) => b.startTime.localeCompare(a.startTime) || a.raceId.localeCompare(b.raceId);
  const finals = ok.filter((r) => SELECT_RULE.stages.some((s) => (r.raceStage ?? "").includes(s))).sort(byLate);
  const twelve = ok.filter((r) => r.raceNumber === SELECT_RULE.fallbackRace).sort(byLate);
  const picked = [...finals, ...twelve.filter((r) => !finals.includes(r))].slice(0, count);
  return picked.map((r) => ({ race_id: r.raceId, deadline: new Date(`${date}T${r.startTime}+09:00`).toISOString(), race_stage: r.raceStage ?? null }));
}

/** YouTube の型を比べる札（hq SQ08 v5）。今は a・b の中身は同じで、送る下書きの source_data.full_picture_variant.id に入れるだけ */
export const VARIANTS = ["a", "b"];
/** bundle に札を書く（純粋関数。札が無ければ元のまま） */
export const withVariant = (bundle, variant) => (variant ? { ...bundle, full_picture_variant: { id: variant } } : bundle);

/**
 * 子のプロセスに渡す環境変数。通す名前を並べる（禁止の名前を並べると DATABASE_URL 等が素通りする。代わりの審査 P3）。
 * claude の認証（CLAUDE_*・ANTHROPIC_*）は残す（つないだ版の LLM がログイン済みの claude で動くため）
 */
const PASS_ENV = /^(PATH|HOME|USER|LOGNAME|LANG|LC_[A-Z]+|TMPDIR|SHELL|TERM|NODE_[A-Z_]+|NVM_[A-Z_]+|CLAUDE_[A-Z_]+|ANTHROPIC_[A-Z_]+|FULL_PICTURE_API_BASE)$/;
export function childEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => PASS_ENV.test(k)));
}
/** このコマンドが送信の鍵と一緒に起動されていないか（--env-file=.env.local で起動された等） */
export const SERVICE_ENV = /SERVICE_KEY|SERVICE_ROLE|SLACK_WEBHOOK|X_API|YOUTUBE_(CLIENT|REFRESH)/i;

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

/** 欠けたら止める材料（一時的な失敗で黙って欠けると「全国」の値や場面3・6が変わる。代わりの審査 P2） */
export const REQUIRED_SOURCES = /^(facts|similar|scenario|scenarioNC|scenarioNA|scenarioVA|races|outcome\.\d+|db\.motor)$/;
/** 材料を取る（失敗＝例外・契約に合わない・欠けてはいけない材料の欠け、なら1回だけ取り直す） */
async function materials(raceId) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const m = await fetchMaterials(raceId, { stage: "racecard" });
      const errs = validate(m);
      const lacking = [...["facts", "scenario"].filter((k) => !m.api[k]), ...m.missing.filter((x) => REQUIRED_SOURCES.test(x.source)).map((x) => `${x.source}（${x.reason}）`)];
      // 鍵の設定の誤り（匿名キーが無い）は取り直しても直らず、場面3・6が黙って欠けるので止める
      const config = m.missing.filter((x) => /匿名キーが無い/.test(x.reason)).map((x) => `${x.source}: ${x.reason}`);
      if (config.length) return { m: null, reasons: config };
      if (!errs.length && !lacking.length) return { m, attempts: attempt };
      last = [...errs.slice(0, 5), ...[...new Set(lacking)].map((k) => `材料 ${k} が無い`)];
    } catch (e) {
      last = [e instanceof Error ? e.message : String(e)];
    }
    log(`[材料] ${attempt}回目が失敗: ${last.join(" / ")}`);
  }
  return { m: null, reasons: last };
}

async function make(raceId, opts) {
  // 予期しない例外でも、標準出力に JSON 1つを出して止める（止まった段を残す。代わりの審査 P2）
  const result = { status: "stopped", stage: "materials", reasons: [], files: {}, video: null, llm: null, text_mode: opts.text, missing: [], ref_commit: null, variant: opts.variant ?? null };
  try {
    return await makeSteps(raceId, opts, result);
  } catch (e) {
    return finish({ ...result, reasons: [e instanceof Error ? e.message : String(e)] }, 1);
  }
}

async function makeSteps(raceId, { out, bgm, concurrency, text, variant = null }, result0) {
  const result = result0;
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
  const r = spawnSync(process.execPath, args, { cwd: REMOTION, env: childEnv(process.env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 45 * 60 * 1000 });
  if (r.error) return finish({ ...result, reasons: [`run-full が終わらない・起動できない: ${r.error.message}`] }, 1);
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0) {
    const lines = (r.stderr ?? "").split("\n").filter((l) => l && !l.startsWith("[省いた要素]"));
    return finish({ ...result, reasons: lines.slice(-10) }, r.status === 2 ? 2 : 1);
  }

  result.stage = "bundle";
  const bundleDir = join(out, "bundle");
  const bundlePath = join(bundleDir, "bundle.json");
  if (!existsSync(bundlePath)) return finish({ ...result, reasons: ["bundle.json が無い"] }, 1);
  // 札（--variant）を bundle に書き、送信の道（push-full-picture.js）が下書きの source_data.full_picture_variant に写す
  const bundle = withVariant(JSON.parse(readFileSync(bundlePath, "utf8")), variant);
  if (variant) writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  result.variant = variant;
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

  // 送信の道の受け取りの検査（DB・Storage に書かない範囲）。2026-10-20 オーナー決定で評価役の P0 は使わず機械の検査だけで
  // 判定するので、bundle は review を出さない。受け取り側の p0_count の検査は別のレーンが外すので、ここでは 0 を入れて当てる
  result.stage = "push-check";
  const { checkFullPicture, MAX_BYTES } = await import(join(ROOT, "scripts/sns/push-full-picture.js"));
  const riskRules = JSON.parse(readFileSync(join(REMOTION, "risk-rules.json"), "utf8")).rules;
  const reasons = checkFullPicture({ ...bundle, review: { p0_count: 0 } }, riskRules);
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
  // 送信の鍵と一緒に起動されたら止める（このコマンドは送信をしない。node --env-file=.env.local で起動しない）
  const leaked = Object.keys(process.env).filter((k) => SERVICE_ENV.test(k));
  if (leaked.length) return usage(`送信の鍵が環境にある（${leaked.join(", ")}）。--env-file を付けずに起動する`);
  // 材料の取得の匿名キー（.env.local からこの2つだけ。--env-file は使わない）
  Object.assign(process.env, { ...readAnonEnv(opt("--anon-env") ?? join(ROOT, ".env.local")), ...Object.fromEntries(ANON_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) });

  if (flag("--select")) {
    const date = opt("--date");
    const count = Number(opt("--count") ?? 1);
    const planOnly = flag("--plan-only");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(count) || count < 1 || !planOnly)
      return usage("使い方: daily.mjs --select --date YYYY-MM-DD [--count N] --plan-only");
    try {
      const res = await fetch(`${BASE}/api/predictions/${date}`, { signal: AbortSignal.timeout(30000) });
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
  const variant = opt("--variant");
  const [raceId] = args;
  if (!raceId || !/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(raceId) || !out || !bgm || !["connected", "template"].includes(text) || (variant !== null && !VARIANTS.includes(variant)))
    return usage("使い方: daily.mjs <race_id> --out <dir> --bgm <mp3> [--concurrency N] [--text connected|template] [--variant a|b]");
  if (!existsSync(bgm)) return usage(`BGM が無い: ${bgm}`);
  return make(raceId, { out: resolve(out), bgm: resolve(bgm), concurrency, text, variant });
}

// シンボリックリンクや空白を含むパスから起動しても動く（file:// の文字列で比べると何もせず exit 0 になった。代わりの審査 P2）
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv.slice(2));
