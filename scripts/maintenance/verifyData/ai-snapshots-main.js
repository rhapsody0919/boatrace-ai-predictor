/**
 * ai-snapshots-main.js - scripts/generate-ai-snapshots.js を import し、main を偽の道具（ai-snapshots-fakes.js）で回す部品
 * （verify-preview-snapshot-plan.js。verify ではない）。本文の字は読まない。
 *
 * generate-ai-snapshots.js が import する aiSnapshots/staticServer.js・aiSnapshots/runSteps.js・generateAiSnapshotsRacers.js・node:fs だけを
 * 偽へ向ける（module.register の resolve hook。判定の previewSnapshotPlan.js・status の snapshotStatus.js は本物）。
 * 書きは偽の fs が覚えるだけ（disk・dist・本番の配信物には触れない）。import しても main は走らない（isDirectRun）。
 *
 * 使い方:
 *   const { calls, status } = await runMain({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "x" });
 *   calls（偽の道具の呼びの並び）・status（偽の fs に書いた status.json）
 */
import { register } from "node:module";
import path from "node:path";
// 偽の静的な import。差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { AI_SNAPSHOT_SCENE, SNAPSHOT_DIR } from "./ai-snapshots-fakes.js";
import { WRITTEN } from "./ai-snapshots-fake-fs.js";
const PRODUCT = new URL("../../generate-ai-snapshots.js", import.meta.url).href;
const FAKES = new URL("./ai-snapshots-fakes.js", import.meta.url).href;
const FAKE_FS = new URL("./ai-snapshots-fake-fs.js", import.meta.url).href;
const SWAPS = {
  "./aiSnapshots/staticServer.js": FAKES,
  "./aiSnapshots/runSteps.js": FAKES,
  "./generateAiSnapshotsRacers.js": FAKES,
  "node:fs": FAKE_FS,
};
const HOOKS = `
const SWAPS = ${JSON.stringify(SWAPS)};
export async function resolve(specifier, context, next) {
  return context.parentURL === ${JSON.stringify(PRODUCT)} && SWAPS[specifier]
    ? { url: SWAPS[specifier], shortCircuit: true }
    : next(specifier, context);
}
`;
const ENV_KEYS = ["VERCEL_ENV", "VERCEL_GIT_COMMIT_MESSAGE", "BOT_SNAPSHOTS_ON_PREVIEW"];

let product = null;

async function load() {
  if (product) return product;
  globalThis[AI_SNAPSHOT_SCENE] = { calls: [] };
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  product = await import(PRODUCT);
  return product;
}

/** env（VERCEL_ENV 等。undefined は消す）を置いて main を回し、偽の道具の呼びと書いた status.json を返す */
export async function runMain(env) {
  const { main } = await load();
  const calls = [];
  globalThis[AI_SNAPSHOT_SCENE].calls = calls;
  WRITTEN.clear();
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  console.log = console.warn = console.error = () => {};
  try {
    await main();
  } finally {
    Object.assign(console, quiet);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  const written = WRITTEN.get(path.join(SNAPSHOT_DIR, "status.json"));
  if (written === undefined) throw new Error("main が status.json を書いていない");
  return { calls, status: JSON.parse(written) };
}
