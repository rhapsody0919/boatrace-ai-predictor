/**
 * cronWiring.js - api/cron/{job}.js の配線を、本文の字でなく export と共通ラッパへ渡した引数で見る（verify の部品）。
 *
 * api/cron/ の本が import する scripts/lib/scrapeJobs/cronWrapper.js だけを、この本へ差し替える（下の HOOKS）。
 * この本は cronWrapper.js をそのまま再 export し、createScrapeCronHandler だけを「本物を呼び、引数と戻りを記録する」物にする。
 * 他の import は本物のまま。ハンドラーは呼ばない（DB・取得先に繋がない）。
 *
 * 使い方:
 *   const wiring = await cronWiring(() => import("../../api/cron/race-notices.js"));
 *   wiring.config.maxDuration・wiring.handler（default export）・wiring.made（[{ options, handler }]、その import で作られた分）
 */
import { register } from "node:module";
import * as real from "../../lib/scrapeJobs/cronWrapper.js";

export * from "../../lib/scrapeJobs/cronWrapper.js";

const made = [];

export function createScrapeCronHandler(options) {
  const handler = real.createScrapeCronHandler(options);
  made.push({ options, handler });
  return handler;
}

// 解決の hook（module.register が別の thread で動かす）。api/cron/ の本からの cronWrapper.js の import だけをこの本へ向ける
const WRAPPER = new URL("../../lib/scrapeJobs/cronWrapper.js", import.meta.url).href;
const API_DIR = new URL("../../../api/cron/", import.meta.url).href;
const HOOKS = `
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  const fromApi = context.parentURL?.startsWith(${JSON.stringify(API_DIR)}) ?? false;
  return resolved.url === ${JSON.stringify(WRAPPER)} && fromApi
    ? { url: ${JSON.stringify(import.meta.url)}, shortCircuit: true }
    : resolved;
}
`;
let registered = false;

/** load（api/cron/ の本の動的 import）を差し替えのもとで呼び、その本の config・default と、作られたラッパの記録を返す */
export async function cronWiring(load) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  const before = made.length;
  const mod = await load();
  return { config: mod.config, handler: mod.default, made: made.slice(before) };
}
