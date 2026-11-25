#!/usr/bin/env node
/**
 * 本番を相手にする E2E（e2e-release.yml・e2e-live.yml）の赤を、前の完了 run の赤（基準）と比べ、
 * 新しい赤があるときだけ知らせるかを決める（設計 docs/design/harness-migration/design.md §2）。
 *
 * 前は hq（Mac）の deploy-guard が同じ引き算をしていた。龍神の workflow は赤のたびに Slack を鳴らし、
 * 同じ赤（例: 2026-11-20〜21 の release の確かめ5回）が毎回届いて新しい赤が埋もれていた。
 *
 * - 鍵は「project › 題の並び」（並びの先頭は spec のファイルの組。:行:列 を持たないので spec の行がずれても同じ鍵）
 * - 赤は Playwright の JSON の status が unexpected の試験だけ（取り直しで緑の flaky は数えない。flattenTests を使う）
 * - 続いている赤も、前に知らせてから RENOTIFY_MS（24時間）たてば鳴らし直す（黙ったまま忘れられないように）
 * - 組が欠けた run（incomplete）は比べられないので鳴らし、その run の鍵は基準に残さない（欠けた鍵が次に誤って新しくなる）
 *
 * 使い方（workflow から）:
 *   node scripts/maintenance/e2e-new-reds.js --workflow=e2e-release.yml --report=e2e-results.json \
 *     --out=red-keys.json --failed=true --incomplete=false
 *   基準は gh（GH_TOKEN・GITHUB_REPOSITORY・GITHUB_RUN_ID）で、同じ workflow の master の完了 run のうち artifact
 *   e2e-red-keys を持つ一番新しい物を BASELINE_SEARCH 本まで探す（--baseline=<path> を渡せば探さない）。
 *   GITHUB_OUTPUT があれば notify（true/false）・text（Slack に載せる文）を書く。終了コードは常に0
 *   （成否は workflow の他の step が決める。ここは知らせるかだけ）
 *
 * 判定と書き出す物は runCli（I/O を受け取る形）で決め、ファイル・gh・GITHUB_OUTPUT への書き出しは main だけが行う。
 *
 * 検証: scripts/maintenance/verify-e2e-new-reds.js（判定）・verify-e2e-new-reds-cli.js（runCli）
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { flattenTests } from "./check-e2e-skips.js";
import {
  ARTIFACT,
  BASELINE_SEARCH,
  baselineCandidates,
  decideNotify,
  noticeText,
} from "./e2e-new-reds-decide.js";

/** レポートから赤の鍵（重複なし・並べた順）。試験が1本も無いレポートは null（比べられない） */
export function redKeysOf(report) {
  const tests = flattenTests(report);
  if (tests.length === 0) return null;
  const keys = tests
    .filter((t) => t.status === "unexpected")
    .map((t) => [t.project, t.title].filter(Boolean).join(" › "));
  return [...new Set(keys)].sort();
}

/** JSON の文を読む。無い・読めない物は null（知らせる側に倒す。理由は log に残す） */
function parseJson(text, what, log) {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    log(`${what} を読めない: ${error.message}`);
    return null;
  }
}

/** gh で基準の artifact を落とし、置いたファイルのパス（見つからなければ null） */
function fetchBaseline(workflow) {
  const repo = process.env.GITHUB_REPOSITORY;
  const listArgs = ["run", "list", "-R", repo, "--workflow", workflow];
  const filters = ["--branch", "master", "--status", "completed"];
  const fields = ["--json", "databaseId,headBranch,status"];
  let runs;
  try {
    const limit = ["-L", String(BASELINE_SEARCH + 1)];
    const out = execFileSync(
      "gh",
      [...listArgs, ...filters, ...limit, ...fields],
      { encoding: "utf8" },
    );
    runs = JSON.parse(out);
  } catch (error) {
    console.error(`前の run を読めない（基準なしで続ける）: ${error.message}`);
    return null;
  }
  for (const id of baselineCandidates(runs, process.env.GITHUB_RUN_ID)) {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-red-base-"));
    try {
      const get = ["run", "download", id, "-R", repo, "-n", ARTIFACT];
      execFileSync("gh", [...get, "-D", dir], { stdio: "pipe" });
      console.log(`基準: run ${id}`);
      return path.join(dir, "red-keys.json");
    } catch {
      // この run には artifact が無い（取り消し・前の版の run・期限切れ・組の欠け）。次の run を見る
    }
  }
  return null;
}

export function parseArgs(argv) {
  const args = Object.fromEntries(
    argv
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, ...v] = a.slice(2).split("=");
        return [k, v.join("=")];
      }),
  );
  return {
    ...args,
    failed: args.failed === "true",
    incomplete: args.incomplete === "true",
  };
}

/**
 * CLI の本体（ファイル・gh に触らない）。読む・探す口を受け取り、書き出す物を返す。
 * @param {{args: ReturnType<typeof parseArgs>, readText: (file: string) => string|null,
 *   fetchBaseline: (workflow: string) => string|null, now: Date, delim: string, log?: (s: string) => void}} io
 * @returns {{decision: object, text: string, keysFile: {path: string, body: string}|null, output: string}}
 */
export function runCli({
  args,
  readText,
  fetchBaseline: find,
  now,
  delim,
  log = console.error,
}) {
  const read = (file, what) =>
    file ? parseJson(readText(file), what, log) : null;
  const report = read(args.report, "レポート");
  const current = report ? redKeysOf(report) : null;
  const baseFile =
    args.baseline || (args.workflow ? find(args.workflow) : null);
  const baseBody = read(baseFile, "基準");
  const baseline = Array.isArray(baseBody?.keys) ? baseBody : null;
  const decision = decideNotify({ ...args, current, baseline, now });
  // 組が欠けた run の鍵は基準に残さない（次の run は一つ前の完全な run と比べる）
  const keysFile =
    current !== null && !args.incomplete && args.out
      ? {
          path: args.out,
          body: `${JSON.stringify({ keys: current, notifiedAt: decision.notifiedAt }, null, 1)}\n`,
        }
      : null;
  const text = noticeText(decision);
  const output = `notify=${decision.notify}\ntext<<${delim}\n${text}\n${delim}\n`;
  return { decision, text, keysFile, output };
}

function main() {
  const readText = (file) =>
    existsSync(file) ? readFileSync(file, "utf8") : null;
  const r = runCli({
    args: parseArgs(process.argv.slice(2)),
    readText,
    fetchBaseline,
    now: new Date(),
    delim: `EOF_${randomBytes(16).toString("hex")}`,
  });
  if (r.keysFile) writeFileSync(r.keysFile.path, r.keysFile.body);
  console.log(
    `notify=${r.decision.notify} reason=${r.decision.reason}\n${r.text}`,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, r.output);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
