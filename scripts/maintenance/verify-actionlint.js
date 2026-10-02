#!/usr/bin/env node
/**
 * verify-actionlint.js - .github/workflows の全ファイルを actionlint（shellcheck 連携あり）で検査する（BOA-659）。
 *
 * 背景: #1080 が e2e-rerecord.yml の env に ${{ failure() }} を書き、ワークフロー全体が無効に
 * なった（push のたびに即失敗し、schedule も起動しなくなった）。PR の CI は緑のままだった。
 * #1082 で verify-e2e-har-merge.js に「状態関数を if: 以外に書かない」検査を足したが、
 * actionlint が見る他の誤り（存在しないコンテキスト、型の誤り、無効な activity type、
 * shellcheck 等）は CI で止まらなかった。#1081 で直した slack-notify-pr.yml の無効な
 * `types: [merged]` もその1つ。
 *
 * 既存の指摘は actionlint-allowlist.json に（ファイル, ルール, 行の内容）で登録し、新しい指摘だけで
 * 失敗させる。行番号では特定しない（上に1行足すだけで全エントリが壊れるため）。
 * 許可リストにあるのに出なくなった（解消済み）エントリも失敗させる（許可リストを腐らせないため）。
 *
 * actionlint・shellcheck の版は actionlint-tools.json で固定し、install-actionlint.js が
 * sha256 を照合して取得する。CI（Quality Gates）はその手順を verify:ci の前に実行する。
 * 手元で未取得なら、警告を出して検査を飛ばす（CI では失敗させる）。
 *
 * 使い方:
 *   node scripts/maintenance/install-actionlint.js                # 初回だけ（npm run setup:actionlint）
 *   node scripts/maintenance/verify-actionlint.js                 # 自己テスト + 検査
 *   node scripts/maintenance/verify-actionlint.js --print-allowlist # 現状の指摘を許可リスト形式で標準出力に出す（書き込みはしない）
 */
import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolPaths } from "./install-actionlint.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ALLOWLIST_PATH = path.join(HERE, "actionlint-allowlist.json");
const IN_CI =
  process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

/**
 * actionlint の指摘1件を、行番号に依存しない識別子（file, rule, line）にする。
 * shellcheck の指摘は actionlint が `run:` の位置で報告し、メッセージに
 * 「SC2129:style:<スクリプト内の行>:<列>」を含める。ブロック（run: |）なら
 * run: の次の行がスクリプトの1行目なので、そこから実際の行を求める
 */
export function toKey(err, fileLines) {
  const lineAt = (n) => (fileLines[n - 1] ?? "").trim();
  if (err.kind === "shellcheck") {
    const m = /\b(SC\d+):\w+:(\d+):\d+:/.exec(err.message);
    if (!m) {
      throw new Error(
        `shellcheck の指摘を解釈できません: ${err.filepath}:${err.line} ${err.message}`,
      );
    }
    const runLine = fileLines[err.line - 1] ?? "";
    const isBlock = /run:\s*[|>][-+0-9]*\s*(#.*)?$/.test(runLine);
    const scriptLine = Number(m[2]);
    const target = isBlock ? err.line + scriptLine : err.line;
    return {
      file: err.filepath,
      rule: `shellcheck:${m[1]}`,
      line: lineAt(target),
    };
  }
  return { file: err.filepath, rule: err.kind, line: lineAt(err.line) };
}

const keyString = (k) => `${k.file}\u0000${k.rule}\u0000${k.line}`;

/** actionlint を実行して指摘の配列を返す。files を省くと .github/workflows 全体 */
function runActionlint(bins, files = [], cwd = ROOT) {
  const res = spawnSync(
    bins.actionlint,
    [
      `-shellcheck=${bins.shellcheck}`,
      // Python の run: は無い。pyflakes の有無で結果が変わらないよう明示的に切る
      "-pyflakes=",
      "-no-color",
      "-format",
      "{{json .}}",
      ...files,
    ],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error)
    throw new Error(`actionlint を起動できません: ${res.error.message}`);
  // 0 = 指摘なし、1 = 指摘あり。それ以外は引数・設定・内部の誤り
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(
      `actionlint が異常終了しました（exit ${res.status}）\n${res.stderr}${res.stdout}`,
    );
  }
  const out = res.stdout.trim();
  const parsed = out === "" || out === "null" ? [] : JSON.parse(out);
  if (!Array.isArray(parsed))
    throw new Error(
      `actionlint の出力が配列ではありません: ${out.slice(0, 200)}`,
    );
  return parsed;
}

async function keysOf(errors, cwd = ROOT) {
  const cache = new Map();
  const linesOf = async (f) => {
    if (!cache.has(f))
      cache.set(
        f,
        (await fs.readFile(path.resolve(cwd, f), "utf8")).split("\n"),
      );
    return cache.get(f);
  };
  return Promise.all(
    errors.map(async (e) => ({
      ...toKey(e, await linesOf(e.filepath)),
      message: e.message,
      at: `${e.filepath}:${e.line}:${e.column}`,
    })),
  );
}

function checkVersions(bins, tools) {
  const al = spawnSync(bins.actionlint, ["-version"], { encoding: "utf8" });
  const alVersion = (al.stdout ?? "").split("\n")[0].trim();
  const sc = spawnSync(bins.shellcheck, ["--version"], { encoding: "utf8" });
  const scVersion = /version:\s*(\S+)/.exec(sc.stdout ?? "")?.[1];
  const problems = [];
  if (alVersion !== tools.actionlint.version) {
    problems.push(
      `actionlint の版が固定値と違います（期待 ${tools.actionlint.version}、実際 ${alVersion || "取得不可"}: ${bins.actionlint}）`,
    );
  }
  if (scVersion !== tools.shellcheck.version) {
    problems.push(
      `shellcheck の版が固定値と違います（期待 ${tools.shellcheck.version}、実際 ${scVersion || "取得不可"}: ${bins.shellcheck}）`,
    );
  }
  return problems;
}

// 検出器が本当に効くことの自己検査。#1080・#1081 で実際に入った誤りを最小化したもの
const FIXTURES = {
  "status-func-in-env.yml": `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo "$JOB_FAILED"
        env:
          JOB_FAILED: \${{ failure() }}
`,
  "invalid-activity-type.yml": `on:
  pull_request:
    types: [closed, merged]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`,
  "shellcheck-block.yml": `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo start

          echo $UNQUOTED_VAR
`,
};

async function selfTest(bins) {
  const failures = [];
  const ok = (name, cond) => {
    if (cond) console.log(`✅ 自己検査: ${name}`);
    else failures.push(`自己検査に失敗: ${name}`);
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-actionlint-"));
  try {
    for (const [name, body] of Object.entries(FIXTURES)) {
      await fs.writeFile(path.join(dir, name), body);
    }
    const errors = runActionlint(bins, Object.keys(FIXTURES), dir);
    const keys = await keysOf(errors, dir);
    const has = (file, rule) =>
      keys.some((k) => k.file === file && k.rule === rule);
    ok(
      "env の ${{ failure() }}（#1080）を expression として検出する",
      has("status-func-in-env.yml", "expression"),
    );
    ok(
      "pull_request の無効な types: merged（#1081 の前）を events として検出する",
      has("invalid-activity-type.yml", "events"),
    );
    const sc = keys.find(
      (k) =>
        k.file === "shellcheck-block.yml" && k.rule === "shellcheck:SC2086",
    );
    ok("shellcheck 連携が有効で、SC2086 を検出する", Boolean(sc));
    ok(
      "shellcheck の指摘を、空行を挟んだブロックでも実際の行の内容で特定する",
      sc?.line === "echo $UNQUOTED_VAR",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return failures;
}

async function readAllowlist() {
  let raw;
  try {
    raw = await fs.readFile(ALLOWLIST_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `許可リストを読めません: ${ALLOWLIST_PATH}（${e.message}）`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries))
    throw new Error(`許可リストに entries 配列がありません: ${ALLOWLIST_PATH}`);
  for (const e of parsed.entries) {
    if (!e.file || !e.rule || typeof e.line !== "string" || !e.reason) {
      throw new Error(
        `許可リストのエントリに file / rule / line / reason のどれかがありません: ${JSON.stringify(e)}`,
      );
    }
  }
  return parsed.entries;
}

async function main() {
  const tools = await toolPaths();
  const bins = {
    actionlint: process.env.ACTIONLINT_BIN || tools.actionlint.bin,
    shellcheck: process.env.SHELLCHECK_BIN || tools.shellcheck.bin,
  };
  const missing = Object.entries(bins).filter(([, b]) => !b || !existsSync(b));
  if (missing.length > 0) {
    const what = missing.map(([n]) => n).join(" / ");
    if (IN_CI) {
      console.error(
        `❌ ${what} がありません。ワークフローで node scripts/maintenance/install-actionlint.js を verify:ci の前に実行してください`,
      );
      process.exit(1);
    }
    console.log(
      `⚠️  ${what} が未取得のため、ワークフローの検査を飛ばしました（CI では実行されます）。手元で確かめるなら npm run setup:actionlint を1回実行してください`,
    );
    return;
  }

  const problems = [...checkVersions(bins, tools), ...(await selfTest(bins))];
  if (problems.length > 0) {
    for (const p of problems) console.error(`❌ ${p}`);
    process.exit(1);
  }

  const findings = await keysOf(runActionlint(bins));
  if (process.argv.includes("--print-allowlist")) {
    const uniq = new Map(
      findings.map((f) => [
        keyString(f),
        {
          file: f.file,
          rule: f.rule,
          line: f.line,
          reason: "TODO: 直さずに残す理由",
        },
      ]),
    );
    console.log(JSON.stringify([...uniq.values()], null, 2));
    return;
  }

  const allowlist = await readAllowlist();
  const allowed = new Set(allowlist.map(keyString));
  const found = new Set(findings.map(keyString));
  const fresh = findings.filter((f) => !allowed.has(keyString(f)));
  const stale = allowlist.filter((e) => !found.has(keyString(e)));

  console.log(
    `actionlint ${tools.actionlint.version} + shellcheck ${tools.shellcheck.version}: 指摘 ${findings.length} 件（許可リスト ${allowlist.length} 件）`,
  );
  if (fresh.length > 0) {
    console.error(
      `\n❌ 新しい指摘があります（${fresh.length} 件）。直してください:`,
    );
    for (const f of fresh) console.error(`  ${f.at} [${f.rule}] ${f.message}`);
    console.error(
      "\n  挙動を変えるため今は直せない既存の指摘に限り、actionlint-allowlist.json に（file, rule, line, reason）で足せます。" +
        "\n  形式は --print-allowlist で出せます。",
    );
  }
  if (stale.length > 0) {
    console.error(
      `\n❌ 許可リストに解消済みのエントリがあります（${stale.length} 件）。${path.relative(ROOT, ALLOWLIST_PATH)} から消してください:`,
    );
    for (const e of stale) console.error(`  ${e.file} [${e.rule}] ${e.line}`);
  }
  if (fresh.length > 0 || stale.length > 0) process.exit(1);
  console.log(
    "✅ 全ワークフローで、許可リスト以外の actionlint / shellcheck の指摘が無い",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
