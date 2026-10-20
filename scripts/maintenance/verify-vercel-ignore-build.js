/**
 * verify-vercel-ignore-build.js - Vercel の Ignored Build Step の判定（scripts/lib/vercelIgnoreBuild.js、BOA-908）の検証。
 *
 * 確認する観点:
 *   1. サイトに関係ない変更（docs・台帳・機械の再生成・ワークフロー・e2e）だけならビルドしない
 *   2. public/blog/*.md・run-heavy.sh・ルートの data/*、risk-rules.json・src・api はビルドする
 *   3. 変わったファイルが無い（作り直し・Deploy Hook）ときはビルドする
 *   4. vercel.json の ignoreCommand がこの判定のスクリプトを呼ぶ
 *   5. 実際の git で、サイトのファイルを除外ディレクトリへ移すだけのコミットはビルドする（リネーム）
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldSkipBuild } from "../lib/vercelIgnoreBuild.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const cases = [
  // 1. ビルドしない
  [["docs/reference/shared-logic-index.md"], true, "機械の再生成（docs）"],
  [
    ["docs/db-migration/APPLIED.md", "data/analysis/x/report.json"],
    true,
    "台帳と分析結果",
  ],
  [
    [".github/workflows/x.yml", ".claude/rules/a.md"],
    true,
    "ワークフローと Claude の設定",
  ],
  [
    ["e2e/smoke.spec.js", "scripts/maintenance/verify-x.js"],
    true,
    "テストと verify",
  ],
  [
    [
      "scripts/analysis/a.js",
      "scripts/watch/job-watch.json",
      "scripts/review/r.js",
      "scripts/tests/t.js",
    ],
    true,
    "分析・見張り・審査・テストのスクリプト",
  ],
  [
    ["README.md", "AGENTS.md", "note-articles/a.md"],
    true,
    "ルートの .md と note の原稿",
  ],
  // 2. ビルドする
  [
    ["public/blog/some-article.md"],
    false,
    "ブログ記事（*.md を全体では除外しない）",
  ],
  [
    ["docs/a.md", "public/blog/some-article.md"],
    false,
    "docs とブログ記事が混ざる",
  ],
  [
    ["scripts/maintenance/run-heavy.sh"],
    false,
    "build の命令が通る run-heavy.sh",
  ],
  [["data/adler/model.json"], false, "src が読むモデル"],
  [["sns-video-studio/remotion/risk-rules.json"], false, "関数の includeFiles"],
  [["src/App.jsx"], false, "画面"],
  [["api/cron/result.js"], false, "関数"],
  [["vercel.json"], false, "Vercel の設定"],
  [["package.json"], false, "依存とビルドの命令"],
  [["public/sitemap.xml"], false, "sitemap の自動更新"],
  [["scripts/lib/x.js"], false, "関数・ビルドが読む共通ライブラリ"],
  [["scripts/generate-ai-snapshots.js"], false, "ビルドのスナップショット生成"],
  [["src/docs/a.md"], false, "下の階層の .md はルートの .md ではない"],
  // 3. 変わったファイルが無い
  [[], false, "作り直し・Deploy Hook"],
];

for (const [files, expected, label] of cases) {
  assert.equal(
    shouldSkipBuild(files),
    expected,
    `${label}: ${JSON.stringify(files)} は ${expected ? "ビルドしない" : "ビルドする"}はず`,
  );
}

// 5. 実際の git で、サイトのファイルを除外ディレクトリへ移す（リネーム）だけのコミットはビルドする。
//    git diff は既定でリネームを検出し、--name-only だと移動先しか出さないため、旧パスを落とさないこと
function runIgnoreScript(cwd, previousSha) {
  try {
    execFileSync("node", [path.join(ROOT, "scripts/vercel-ignore-build.js")], {
      cwd,
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previousSha },
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
try {
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "verify@example.com");
  git(tmp, "config", "user.name", "verify");
  fs.mkdirSync(path.join(tmp, "public/blog"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "public/blog/a.md"), "# a\n");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-qm", "base");
  const base = git(tmp, "rev-parse", "HEAD");
  fs.mkdirSync(path.join(tmp, "docs/archive"), { recursive: true });
  git(tmp, "mv", "public/blog/a.md", "docs/archive/a.md");
  git(tmp, "commit", "-qm", "move");
  assert.equal(
    runIgnoreScript(tmp, base),
    1,
    "public/blog の記事を docs/ へ移すだけのコミットはビルドする（旧パスが差分に入る）",
  );
  const moved = git(tmp, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(tmp, "docs/archive/b.md"), "# b\n");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-qm", "docs only");
  assert.equal(
    runIgnoreScript(tmp, moved),
    0,
    "docs だけのコミットはビルドしない",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const vercel = JSON.parse(
  fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
);
assert.equal(
  vercel.ignoreCommand,
  "node scripts/vercel-ignore-build.js",
  "vercel.json の ignoreCommand が scripts/vercel-ignore-build.js を呼ぶこと",
);

console.log(
  `✅ verify-vercel-ignore-build: ${cases.length}件・git のリネームの再現・vercel.json の ignoreCommand を確認`,
);
