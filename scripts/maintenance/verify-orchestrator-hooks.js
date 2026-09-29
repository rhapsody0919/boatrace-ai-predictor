#!/usr/bin/env node
/**
 * .claude/hooks/orchestrator-session.sh（/orchestrate の記録と compact 後の再注入）を検証する。
 *
 * このフックが壊れると、compact のたびにオーケストレーターがレーンの状態を失うか、
 * 逆に無関係なセッションへ状態を注入する。どちらも静かに起きるので、偽の入力で両側を確かめる。
 *
 * 一時ディレクトリに git リポジトリを作り、CLAUDE_PROJECT_DIR をそこに向けて動かす
 * （本物の .git/orchestrator/state.md には触れない）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const HOOK = path.join(ROOT, ".claude/hooks/orchestrator-session.sh");

const failures = [];
let checked = 0;
function check(label, ok, detail = "") {
  checked += 1;
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

const work = mkdtempSync(path.join(tmpdir(), "orchestrator-hooks-"));
const repo = path.join(work, "repo");
mkdirSync(repo);
execFileSync("git", ["init", "-q", repo]);
const stateFile = path.join(repo, ".git/orchestrator/state.md");

function run(input, env = {}) {
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const readState = () =>
  existsSync(stateFile) ? readFileSync(stateFile, "utf8") : null;
const resetState = () =>
  rmSync(path.join(repo, ".git/orchestrator"), {
    recursive: true,
    force: true,
  });

const ups = (session_id, prompt) => ({
  session_id,
  cwd: repo,
  hook_event_name: "UserPromptSubmit",
  prompt,
});
const skill = (session_id, name) => ({
  session_id,
  cwd: repo,
  hook_event_name: "PostToolUse",
  tool_name: "Skill",
  tool_input: { skill: name },
  tool_use_id: "toolu_x",
});
const start = (session_id, source = "compact") => ({
  session_id,
  cwd: repo,
  hook_event_name: "SessionStart",
  source,
});

try {
  // 6. state.md が無くても落ちない（compact の注入側）
  resetState();
  let r = run(start("sess-a"));
  check("6. state.md 無しの compact で exit 0", r.code === 0, `code=${r.code}`);
  check("6. state.md 無しの compact で何も出さない", r.stdout === "", r.stdout);

  // 1. UserPromptSubmit の /orchestrate で記録される（state.md が無ければ雛形で作る）
  r = run(ups("sess-a", "/orchestrate"));
  let s = readState();
  check(
    "1. /orchestrate で exit 0",
    r.code === 0,
    `code=${r.code} ${r.stderr}`,
  );
  check("1. state.md が作られる", s !== null);
  check(
    "1. orchestrator_session が記録される",
    /^orchestrator_session: sess-a$/m.test(s ?? ""),
    s,
  );
  check(
    "1. updated が ISO で入る",
    /^updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m.test(s ?? ""),
    s,
  );
  for (const h of [
    "## レーン",
    "## ユーザー確認待ち",
    "## マージ順の制約",
    "## 保留・注意",
  ]) {
    check(`1. 雛形に見出し「${h}」`, (s ?? "").includes(h));
  }
  check(
    "1. 状態ファイルの場所を知らせる",
    r.stdout.includes("state.md"),
    r.stdout,
  );

  // 1. 引数つき・既存の state.md では冒頭だけ差し替え、本文は残す
  writeFileSync(
    stateFile,
    (s ?? "").replace(
      "## ユーザー確認待ち",
      "| L1 | lane-1 | #900 | - |\n\n## ユーザー確認待ち\n- #901 のマージ\nupdated: 本文中の行は消さない",
    ),
  );
  r = run(ups("sess-b", "  /orchestrate 再開"));
  s = readState();
  check(
    "1. 引数つき /orchestrate で差し替わる",
    /^orchestrator_session: sess-b$/m.test(s ?? ""),
    s,
  );
  check(
    "1. 記録の行は1つだけ",
    (s ?? "").match(/^orchestrator_session:/gm)?.length === 1,
    s,
  );
  check(
    "1. 既存のレーン表を残す",
    (s ?? "").includes("| L1 | lane-1 | #900 | - |"),
    s,
  );
  check("1. 既存の確認待ちを残す", (s ?? "").includes("- #901 のマージ"), s);
  check(
    "1. 見出しより後の updated: で始まる行は残す",
    (s ?? "").includes("updated: 本文中の行は消さない"),
    s,
  );

  // 1'. UserPromptExpansion（/orchestrate を直接打った経路）でも記録される
  r = run({
    session_id: "sess-e",
    cwd: repo,
    hook_event_name: "UserPromptExpansion",
    expansion_type: "slash_command",
    command_name: "orchestrate",
    command_args: "",
    prompt: "/orchestrate",
  });
  s = readState();
  check(
    "1'. UserPromptExpansion で記録される",
    /^orchestrator_session: sess-e$/m.test(s ?? ""),
    s,
  );
  const again = run(ups("sess-e", "/orchestrate"));
  check(
    "1'. 同じセッションの2回目は知らせを重ねない",
    again.stdout === "",
    again.stdout,
  );
  r = run({
    session_id: "sess-x",
    cwd: repo,
    hook_event_name: "UserPromptExpansion",
    expansion_type: "slash_command",
    command_name: "orchestrate-v2",
    command_args: "",
    prompt: "/orchestrate-v2",
  });
  check(
    "1'. 他のコマンド名の UserPromptExpansion では記録しない",
    /^orchestrator_session: sess-e$/m.test(readState() ?? ""),
    readState(),
  );

  // 2. PostToolUse の Skill（orchestrate）で記録される
  r = run(skill("sess-c", "orchestrate"));
  s = readState();
  check(
    "2. Skill(orchestrate) で exit 0",
    r.code === 0,
    `code=${r.code} ${r.stderr}`,
  );
  check(
    "2. Skill(orchestrate) で記録される",
    /^orchestrator_session: sess-c$/m.test(s ?? ""),
    s,
  );
  check("2. PostToolUse では stdout を出さない", r.stdout === "", r.stdout);

  // 3. 他の skill 名や他のプロンプトでは記録されない
  const negatives = [
    ["他の skill", skill("sess-x", "discussion-panel")],
    ["名前が前方一致の skill", skill("sess-x", "orchestrate-v2")],
    ["/orchestrate-foo", ups("sess-x", "/orchestrate-foo")],
    ["文中の orchestrate", ups("sess-x", "please orchestrate the lanes")],
    ["文中の /orchestrate", ups("sess-x", "次に /orchestrate を使う")],
    ["無関係なプロンプト", ups("sess-x", "ビルドを直して")],
    ["不正な session_id", ups("../../etc", "/orchestrate")],
  ];
  for (const [label, input] of negatives) {
    const before = readState();
    r = run(input);
    check(`3. ${label}: exit 0`, r.code === 0, `code=${r.code}`);
    check(`3. ${label}: 記録されない`, readState() === before, readState());
    check(`3. ${label}: 何も出さない`, r.stdout === "", r.stdout);
  }
  resetState();
  r = run(skill("sess-x", "discussion-panel"));
  check("3. 他の skill では state.md を作らない", readState() === null);
  run(skill("sess-c", "orchestrate"));

  // 4. compact で一致すれば注入される
  r = run(start("sess-c"));
  check(
    "4. 一致する compact で exit 0",
    r.code === 0,
    `code=${r.code} ${r.stderr}`,
  );
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    // 下の check で落とす
  }
  const ctx = out?.hookSpecificOutput?.additionalContext ?? "";
  check(
    "4. JSON の hookSpecificOutput で返す",
    out?.hookSpecificOutput?.hookEventName === "SessionStart",
    r.stdout,
  );
  check("4. state.md の全文が入る", ctx.includes(readState() ?? "\0"), ctx);
  check("4. 見回りの要約が入る", ctx.includes("patrol.sh"), ctx);
  check(
    "4. 10,000 文字の上限に収まる",
    ctx.length <= 10000,
    String(ctx.length),
  );

  // 4'. 上限（10,000文字）を超える state.md は、黙って落とさず切り詰めたことと全文の場所を書く
  const normal = readState() ?? "";
  writeFileSync(
    stateFile,
    `${normal}\n- ${"確認待ちの長い行".repeat(1500)}\n## 末尾の節\n`,
  );
  r = run(start("sess-c"));
  let big = "";
  try {
    big = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } catch {
    // 下の check で落とす
  }
  check(
    "4'. 長い state.md でも上限に収まる",
    big.length <= 10000,
    String(big.length),
  );
  check(
    "4'. 切り詰めたことを書く",
    big.includes("切り詰めた"),
    big.slice(-200),
  );
  check("4'. 全文の場所を書く", big.includes(stateFile), big.slice(-200));
  check("4'. 冒頭の記録は残る", big.includes("orchestrator_session: sess-c"));
  writeFileSync(stateFile, normal);

  // 5. 不一致なら何も出ない（compact 以外の source も同様）
  r = run(start("sess-other"));
  check("5. 不一致の compact で exit 0", r.code === 0);
  check("5. 不一致の compact で何も出さない", r.stdout === "", r.stdout);
  r = run(start("sess-c", "startup"));
  check("5. compact 以外の source では出さない", r.stdout === "", r.stdout);

  // 7. jq が無いときに素通しになる（jq を除いたコマンドだけの PATH で動かす）
  const shim = path.join(work, "bin");
  mkdirSync(shim);
  for (const cmd of [
    "bash",
    "git",
    "cat",
    "sed",
    "grep",
    "head",
    "date",
    "mkdir",
    "mv",
    "rm",
  ]) {
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
  resetState();
  for (const [label, input] of [
    ["UserPromptSubmit", ups("sess-d", "/orchestrate")],
    ["PostToolUse", skill("sess-d", "orchestrate")],
    ["SessionStart", start("sess-d")],
  ]) {
    const res = spawnSync(path.join(shim, "bash"), [HOOK], {
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...noJq, CLAUDE_PROJECT_DIR: repo },
    });
    check(
      `7. jq 無しの ${label}: exit 0`,
      res.status === 0,
      `code=${res.status} ${res.stderr}`,
    );
    check(`7. jq 無しの ${label}: 何も出さない`, res.stdout === "", res.stdout);
  }
  check("7. jq 無しでは state.md を作らない", readState() === null);

  // settings.json に3経路とも登録されていること（登録が消えるとフックごと無効になる）
  const settings = JSON.parse(
    readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"),
  );
  const registered = (event, matcher) =>
    (settings.hooks?.[event] ?? []).some(
      (g) =>
        (g.matcher ?? "") === matcher &&
        g.hooks?.some((h) => h.command?.includes("orchestrator-session.sh")),
    );
  check(
    "settings: UserPromptSubmit に登録",
    registered("UserPromptSubmit", ""),
  );
  check(
    "settings: UserPromptExpansion(orchestrate) に登録",
    registered("UserPromptExpansion", "orchestrate"),
  );
  check(
    "settings: PostToolUse(Skill) に登録",
    registered("PostToolUse", "Skill"),
  );
  check(
    "settings: SessionStart(compact) に登録",
    registered("SessionStart", "compact"),
  );

  // skill 側: モデルが勝手に起動しないこと
  const skillMd = readFileSync(
    path.join(ROOT, ".claude/skills/orchestrate/SKILL.md"),
    "utf8",
  );
  check(
    "SKILL.md に disable-model-invocation: true",
    /^disable-model-invocation: true$/m.test(skillMd),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("NG: orchestrator-session.sh が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: orchestrator-session.sh の検証 ${checked} 件がすべて通過`);
