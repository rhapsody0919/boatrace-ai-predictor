/**
 * daily-queries-preload.js - daily-queries-fake-db.js が子の node に `--import` で先に読ませる部品。
 *
 * 子の中で scripts/lib/supabaseClient.js の import を、どこから読まれても写し aggregate-racer-stats-fake-supabase.js へ向ける
 * （module.register の resolve hook。本物は読まないので鍵・.env.local・ネットには繋がない）。場面の表は環境変数
 * DAILY_QUERIES_SCENE（JSON）から置き、子が終わるときに問い合わせの記録を標準出力の1行（印 MARK の後に JSON）で返す。
 */
import { register } from "node:module";
import { writeSync } from "node:fs";
import { SCENE_KEY } from "./aggregate-racer-stats-fake-supabase.js";

export const MARK = "@@daily-queries@@";
const REAL = new URL("../../lib/supabaseClient.js", import.meta.url).href;
const FAKE = new URL(
  "./aggregate-racer-stats-fake-supabase.js",
  import.meta.url,
).href;
const HOOKS = `
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return resolved.url === ${JSON.stringify(REAL)} ? { url: ${JSON.stringify(FAKE)}, shortCircuit: true } : resolved;
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

const { tables = {} } = JSON.parse(process.env.DAILY_QUERIES_SCENE ?? "{}");
const scene = { tables, fail: new Set(), queries: [], writes: [] };
globalThis[SCENE_KEY] = scene;
process.on("exit", () => {
  writeSync(1, `\n${MARK}${JSON.stringify(scene.queries)}\n`);
});
