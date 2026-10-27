#!/usr/bin/env node
/**
 * e2e 用に束を build する（E2E_SERVE=preview の前の step、docs/design/ci-minutes-reduction/design.md 4.2 A）。
 *
 * build では VITE_SUPABASE_URL が束に焼き込まれる。dev では playwright.config.js の replayServerEnv が
 * 起動のたびに録画の Supabase のオリジンへ差し替えるが、preview ではそれが効かない。そこで、
 * 再生（既定）のときは録画のポインタ（e2e/recording.json の supabaseOrigin）で build する。渡さないと
 * HAR の URL の完全一致が外れ、全件が本番へ素通しになる（#1319 の素通し 1,132 種類）。
 * 本番データ（E2E_LIVE=1）・撮り直し（E2E_RECORD=1）は今の環境変数のまま build する（別の束）。
 *
 * build の後に dist/.e2e-build.json（どのモードの束か・焼き込んだ宛先）を書き、playwright.config.js が
 * preview の起動の前に、今のモードと合っているかを確かめる（再生の束で本番データを走らせない）。
 *
 * 使い方: node scripts/maintenance/e2e-build.js   （E2E_LIVE・E2E_RECORD・E2E_RECORDING_SOURCE は playwright と同じ）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** playwright.config.js と同じ判定（純粋関数） */
export function e2eMode(env) {
  if (env.E2E_LIVE === "1") return "live";
  if (env.E2E_RECORD === "1") return "record";
  return "replay";
}

/** build に渡す VITE_SUPABASE_URL（純粋関数）。再生は録画のオリジン、それ以外は今の値 */
export function buildSupabaseUrl(mode, env, readPointer) {
  if (mode !== "replay") return env.VITE_SUPABASE_URL ?? "";
  const file =
    env.E2E_RECORDING_SOURCE === "local"
      ? "e2e/recordings/meta.json"
      : "e2e/recording.json";
  const origin = readPointer(file)?.supabaseOrigin;
  if (!origin)
    throw new Error(`${file} に supabaseOrigin が無い（録画が無い）`);
  return origin;
}

function main() {
  const mode = e2eMode(process.env);
  const supabaseUrl = buildSupabaseUrl(mode, process.env, (f) =>
    JSON.parse(readFileSync(path.join(ROOT, f), "utf8")),
  );
  const started = Date.now();
  const r = spawnSync("npx", ["vite", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_SUPABASE_URL: supabaseUrl },
  });
  if (r.status !== 0) {
    console.error(`::error::e2e の build が失敗した（終了コード ${r.status}）`);
    process.exit(1);
  }
  writeFileSync(
    path.join(ROOT, "dist/.e2e-build.json"),
    `${JSON.stringify({ mode, supabaseUrl }, null, 2)}\n`,
  );
  console.log(
    `e2e の束: mode=${mode}・VITE_SUPABASE_URL=${supabaseUrl}・${((Date.now() - started) / 1000).toFixed(1)}秒`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
