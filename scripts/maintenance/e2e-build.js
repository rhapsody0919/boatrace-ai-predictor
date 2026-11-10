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
 * E2E_SOURCEMAP=1 のときだけ vite build に --sourcemap hidden を渡す（毎晩の網羅の表用、e2e-nightly.yml。束の中身は変わらない）。
 *
 * 使い方: npm run build:e2e   （E2E_LIVE・E2E_RECORD・E2E_RECORDING_SOURCE は playwright と同じ）
 * 決定: ADR-0077 決定8。検証: scripts/maintenance/verify-e2e-build.js
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * build に渡す VITE_SUPABASE_URL（純粋関数）。再生は録画のオリジン、それ以外は今の環境変数の値。
 * 撮り・本番データで環境変数に無いときは止める（空の文字列を渡すと .env.local の値より先に効き、
 * 宛先の無い束で全件が落ちる・中身の無い録画を撮る）
 */
export function buildSupabaseUrl(mode, env, readPointer) {
  if (mode !== "replay") {
    if (!env.VITE_SUPABASE_URL)
      throw new Error(
        `${mode} の束は VITE_SUPABASE_URL を環境変数で渡す（.env.local だけでは束に入らない値と照合がずれる）`,
      );
    return env.VITE_SUPABASE_URL;
  }
  const file =
    env.E2E_RECORDING_SOURCE === "local"
      ? "e2e/recordings/meta.json"
      : "e2e/recording.json";
  const origin = readPointer(file)?.supabaseOrigin;
  if (!origin)
    throw new Error(`${file} に supabaseOrigin が無い（録画が無い）`);
  return origin;
}

/**
 * vite build に渡す環境変数（純粋関数）。宛先と GA の ID は env の値より後に置いて必ず上書きする。
 * GA の ID は空に固定する（本番の束の initGA は DEV で止まらない。live は外部ホストを止めないので本物の GA に送る）
 */
export function buildEnv(env, supabaseUrl) {
  return { ...env, VITE_SUPABASE_URL: supabaseUrl, VITE_GA_MEASUREMENT_ID: "" };
}

/**
 * vite build に足す引数（純粋関数）。E2E_SOURCEMAP=1 のときだけ hidden の source map を出す
 * （束に sourceMappingURL は入らず、dist/assets/*.js.map だけが増える）。毎晩の網羅の表（E2E_COVERAGE=1）が
 * 動いた関数を src へ戻すのに使う。本番の build・vite.config.js は変えない
 */
export function viteBuildArgs(env) {
  return env.E2E_SOURCEMAP === "1" ? ["--sourcemap", "hidden"] : [];
}

function main() {
  const mode = e2eMode(process.env);
  const supabaseUrl = buildSupabaseUrl(mode, process.env, (f) =>
    JSON.parse(readFileSync(path.join(ROOT, f), "utf8")),
  );
  const started = Date.now();
  const r = spawnSync("npx", ["vite", "build", ...viteBuildArgs(process.env)], {
    cwd: ROOT,
    stdio: "inherit",
    env: buildEnv(process.env, supabaseUrl),
  });
  if (r.error || r.status !== 0) {
    console.error(
      `::error::e2e の build が失敗した（終了コード ${r.status}${r.error ? `、${r.error.message}` : ""}）`,
    );
    process.exit(1);
  }
  writeFileSync(
    path.join(ROOT, "dist/.e2e-build.json"),
    `${JSON.stringify(
      {
        mode,
        supabaseUrl,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        }).trim(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `e2e の束: mode=${mode}・VITE_SUPABASE_URL=${supabaseUrl}・${((Date.now() - started) / 1000).toFixed(1)}秒`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
