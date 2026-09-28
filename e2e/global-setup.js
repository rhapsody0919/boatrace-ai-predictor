import { readFileSync, rmSync } from "node:fs";
import {
  E2E_MODE,
  META_PATH,
  RECORD_CACHE_DIR,
  RECORD_PARTIAL_ENV,
  RECORDED_AT_ENV,
} from "./fixtures.js";

/** テストを絞り込む引数。これがあると一部のテストしか走らない */
const FILTER_FLAGS = new Set([
  "-g",
  "--grep",
  "--grep-invert",
  "--project",
  "--last-failed",
  "--only-changed",
  "--shard",
]);

/** 次の引数を値として取るフラグ（その値は spec の指定ではない） */
const VALUE_FLAGS = new Set([
  "-j",
  "--workers",
  "--reporter",
  "--retries",
  "--timeout",
  "--repeat-each",
  "-c",
  "--config",
  "--output",
  "--max-failures",
  "--trace",
]);

/**
 * playwright test の引数から、全テストを走らせる実行かどうかを判定する（純関数）。
 * spec のパス指定（`-` で始まらない引数）か、絞り込みのフラグがあれば部分実行
 */
export function isPartialRun(argv) {
  const start = argv.indexOf("test");
  if (start === -1) return false;
  const args = argv.slice(start + 1);
  return args.some((arg, i) => {
    const flag = arg.split("=")[0];
    if (FILTER_FLAGS.has(flag)) return true;
    if (arg.startsWith("-")) return false;
    // `--workers 3` のような値を取るフラグの値は spec 指定ではない。
    // それ以外は（迷ったら）部分実行として扱う＝既存の録画を消さない側に倒す
    return !VALUE_FLAGS.has(args[i - 1]);
  });
}

/**
 * record モードでは、今回の録画時刻をここで1つに決める。
 * 全テストがこの時刻に時計を固定して録画するため、replay で同じ時刻に固定すれば
 * フロントが組み立てるURL（日付・時刻を含むクエリ）が録画時と一致する。
 * process.env に入れた値はワーカーに引き継がれる。
 *
 * 対象を絞った録画（部分録画）は既存の録画に書き足すので、時計も既存の録画時刻に
 * 合わせる（別の時刻で取った応答が混ざると、URLが食い違う）。
 */
export default function globalSetup() {
  if (E2E_MODE !== "record") return;
  // 前回の録画で取った応答を持ち越さない
  rmSync(RECORD_CACHE_DIR, { recursive: true, force: true });
  const partial = isPartialRun(process.argv);
  if (partial) {
    let recordedAt;
    try {
      recordedAt = JSON.parse(readFileSync(META_PATH, "utf8")).recordedAt;
    } catch (error) {
      throw new Error(
        `部分録画は既存の録画（${META_PATH}）に書き足すため、先に全体を録画してください: ${error.message}`,
      );
    }
    process.env[RECORD_PARTIAL_ENV] = "1";
    process.env[RECORDED_AT_ENV] = recordedAt;
    console.log(
      `[e2e record] 部分録画: 既存の録画時刻 ${recordedAt} に合わせて書き足す`,
    );
    return;
  }
  process.env[RECORDED_AT_ENV] = new Date().toISOString();
  console.log(`[e2e record] 録画時刻: ${process.env[RECORDED_AT_ENV]}`);
}
