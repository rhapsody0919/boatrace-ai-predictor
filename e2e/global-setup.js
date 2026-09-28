import { rmSync } from "node:fs";
import { E2E_MODE, RECORD_CACHE_DIR, RECORDED_AT_ENV } from "./fixtures.js";

/**
 * record モードでは、今回の録画時刻をここで1つに決める。
 * 全テストがこの時刻に時計を固定して録画するため、replay で同じ時刻に固定すれば
 * フロントが組み立てるURL（日付・時刻を含むクエリ）が録画時と一致する。
 * process.env に入れた値はワーカーに引き継がれる。
 */
export default function globalSetup() {
  if (E2E_MODE !== "record") return;
  // 前回の録画で取った応答を持ち越さない
  rmSync(RECORD_CACHE_DIR, { recursive: true, force: true });
  process.env[RECORDED_AT_ENV] = new Date().toISOString();
  console.log(`[e2e record] 録画時刻: ${process.env[RECORDED_AT_ENV]}`);
}
