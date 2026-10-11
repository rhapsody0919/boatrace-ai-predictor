#!/usr/bin/env node
/**
 * .claude/hooks/guard-edit-on-master.sh（master 上のメイン作業ツリーの直接編集を止める）を検証する。
 *
 * このフックが壊れると、止めるべき編集を素通しする（並行セッションとの混線・誤削除の再発）か、
 * worktree での正当な編集まで止めて作業ができなくなる。どちらも偽の入力で確かめる。
 *
 * 一時ディレクトリに master のリポジトリと worktree を作って動かす（本物のリポジトリには触れない）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const HOOK = path.join(ROOT, ".claude/hooks/guard-edit-on-master.sh");

const failures = [];
let checked = 0;
function check(label, ok, detail = "") {
  checked += 1;
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

const work = realpathSync(mkdtempSync(path.join(tmpdir(), "edit-on-master-")));
const repo = path.join(work, "repo");
const outside = path.join(work, "outside");
mkdirSync(repo);
mkdirSync(outside);
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
git("init", "-q", "-b", "master");
git("config", "user.email", "verify@example.com");
git("config", "user.name", "verify");
writeFileSync(path.join(repo, "a.txt"), "a\n");
git("add", "a.txt");
git("commit", "-q", "-m", "init");
const wt = path.join(repo, ".claude/worktrees/lane-1");
git("worktree", "add", "-q", "-b", "feature/lane-1", wt);

function run(input, env = process.env) {
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const edit = (file_path, tool_name = "Edit") => ({
  hook_event_name: "PreToolUse",
  tool_name,
  cwd: repo,
  tool_input: { file_path },
});
const denied = (r) => {
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput;
    return o.permissionDecision === "deny" && o.hookEventName === "PreToolUse";
  } catch {
    return false;
  }
};
const expect = (label, input, shouldDeny, env) => {
  const r = run(input, env);
  check(`${label}: exit 0`, r.code === 0, `code=${r.code} ${r.stderr}`);
  if (shouldDeny) {
    check(`${label}: 拒否する`, denied(r), r.stdout);
    check(
      `${label}: 理由に worktree の案内がある`,
      r.stdout.includes("git worktree"),
      r.stdout,
    );
  } else {
    check(`${label}: 素通しする`, r.stdout === "", r.stdout);
  }
};

try {
  // 1. master 上のメイン作業ツリー: 既存ファイル・新規ディレクトリの新規ファイル・相対パス・NotebookEdit を止める
  expect(
    "1. メイン(master) の既存ファイル",
    edit(path.join(repo, "a.txt")),
    true,
  );
  expect(
    "1. メイン(master) の新規ディレクトリの新規ファイル",
    edit(path.join(repo, "new/dir/b.txt"), "Write"),
    true,
  );
  expect("1. メイン(master) の相対パス", edit("a.txt"), true);
  expect(
    "1. メイン(master) の NotebookEdit",
    {
      hook_event_name: "PreToolUse",
      tool_name: "NotebookEdit",
      cwd: repo,
      tool_input: { notebook_path: path.join(repo, "n.ipynb") },
    },
    true,
  );

  // 2. worktree（.claude/worktrees/ 配下の別の作業ツリー）は対象外
  expect("2. worktree の既存ファイル", edit(path.join(wt, "a.txt")), false);
  expect(
    "2. worktree の新規ディレクトリの新規ファイル",
    edit(path.join(wt, "new/c.txt"), "Write"),
    false,
  );

  // 3. リポジトリ外（~/.claude の memory 等）は対象外
  expect("3. リポジトリ外", edit(path.join(outside, "memory.md")), false);
  expect(
    "3. リポジトリ外の存在しないディレクトリ",
    edit(path.join(outside, "x/y/z.md"), "Write"),
    false,
  );

  // 4. .git/ 配下は対象外
  expect(
    "4. .git 配下",
    edit(path.join(repo, ".git/orchestrator/state.md"), "Write"),
    false,
  );
  expect("4. .git/config", edit(path.join(repo, ".git/config")), false);

  // 5. メイン作業ツリーが master 以外なら止めない
  git("checkout", "-q", "-b", "feature/other");
  expect(
    "5. メイン(feature) の既存ファイル",
    edit(path.join(repo, "a.txt")),
    false,
  );
  git("checkout", "-q", "master");

  // 6. file_path が無い入力は素通し
  expect("6. file_path 無し", { tool_name: "Edit", tool_input: {} }, false);

  // 7. jq が無いときは素通し（jq を除いたコマンドだけの PATH で動かす）
  const shim = path.join(work, "bin");
  mkdirSync(shim);
  for (const cmd of ["bash", "git", "cat", "dirname"]) {
    const found = spawnSync("bash", ["-c", `command -v ${cmd}`], {
      encoding: "utf8",
    }).stdout.trim();
    if (found) symlinkSync(found, path.join(shim, cmd));
  }
  const noJq = { PATH: shim };
  check(
    "7. 前提: shim の PATH に jq が無い",
    spawnSync(path.join(shim, "bash"), ["-c", "command -v jq"], { env: noJq })
      .status !== 0,
  );
  const r = spawnSync(path.join(shim, "bash"), [HOOK], {
    input: JSON.stringify(edit(path.join(repo, "a.txt"))),
    encoding: "utf8",
    env: noJq,
  });
  check("7. jq 無し: exit 0", r.status === 0, `code=${r.status} ${r.stderr}`);
  check("7. jq 無し: 素通しする", r.stdout === "", r.stdout);

  // settings.json の PreToolUse(Edit|Write|NotebookEdit) に登録されていること
  const settings = JSON.parse(
    readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"),
  );
  check(
    "settings: PreToolUse(Edit|Write|NotebookEdit) に登録",
    (settings.hooks?.PreToolUse ?? []).some(
      (g) =>
        g.matcher === "Edit|Write|NotebookEdit" &&
        g.hooks?.some((h) => h.command?.includes("guard-edit-on-master.sh")),
    ),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("NG: guard-edit-on-master.sh が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: guard-edit-on-master.sh の検証 ${checked} 件がすべて通過`);
