#!/usr/bin/env node
/**
 * db-apply.js - 本番 DB 適用ワークフロー（.github/workflows/db-apply.yml）の各段。手順は docs/operation/db-apply.md。
 *
 *   inspect <path>                承認の前: パスの検証・SQL の検査・job summary の出力。適用できなければ終了コード1
 *   apply <path> <sha256>         承認の後: sha256 の再照合・再検査のあと psql で適用（接続は env SUPABASE_DB_URL）
 *   mark-applied <path> <sha256>  適用の後: docs/db-migration/APPLIED.md の行を「適用済み」にする
 *
 * 引数のパスは呼び出し側（ワークフロー）が env 経由で渡す。ここで正規表現と git の木（HEAD に通常ファイルとして
 * あること）を検証してから読む。接続文字列は引数に出さず、libpq の環境変数（PGHOST 等）に分けて psql に渡す。
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectMigration,
  isAppliedInLedger,
  markAppliedInLedger,
  renderSummary,
  validateMigrationPath,
} from "../lib/dbApplySql.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const LEDGER = path.join(ROOT, "docs/db-migration/APPLIED.md");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function writeGithubFile(envName, text) {
  const file = process.env[envName];
  if (file) appendFileSync(file, text);
}

/** パスを検証し、HEAD の木に通常ファイル（100644）としてあることを確かめてから中身を返す */
function readMigration(migrationPath) {
  const v = validateMigrationPath(migrationPath);
  if (!v.ok) fail(v.reason);
  const tree = execFileSync("git", ["ls-tree", "HEAD", "--", migrationPath], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!tree.startsWith("100644 blob ")) {
    fail(
      `${migrationPath} は HEAD（master）に通常ファイルとして無い: ${tree || "（見つからない）"}`,
    );
  }
  const buf = readFileSync(path.join(ROOT, migrationPath));
  return {
    buf,
    sql: buf.toString("utf8"),
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

function inspect(migrationPath) {
  const { sql, sha256 } = readMigration(migrationPath);
  const inspection = inspectMigration(sql);
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo =
    process.env.GITHUB_REPOSITORY ?? "rhapsody0919/boatrace-ai-predictor";
  const commit = process.env.GITHUB_SHA ?? "HEAD";
  const summary = renderSummary({
    path: migrationPath,
    sha256,
    sql,
    inspection,
    fileUrl: `${server}/${repo}/blob/${commit}/${migrationPath}`,
    alreadyApplied: isAppliedInLedger(
      readFileSync(LEDGER, "utf8"),
      path.basename(migrationPath),
    ),
  });
  writeGithubFile("GITHUB_STEP_SUMMARY", `${summary}\n`);
  if (!process.env.GITHUB_STEP_SUMMARY) console.log(summary);
  if (inspection.rejections.length > 0) {
    fail(
      `適用できない文がある（${inspection.rejections.length}件）。job summary を参照`,
    );
  }
  writeGithubFile(
    "GITHUB_OUTPUT",
    `sha256=${sha256}\nmode=${inspection.mode}\n`,
  );
  console.log(`OK: ${migrationPath} sha256=${sha256} mode=${inspection.mode}`);
}

/** SUPABASE_DB_URL を libpq の環境変数に分ける。値は ::add-mask:: でログから隠す */
function pgEnvFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(
      "SUPABASE_DB_URL が URL として読めない（postgresql://… の形で登録する）",
    );
  }
  if (!/^postgres(ql)?:$/.test(url.protocol))
    fail("SUPABASE_DB_URL は postgresql:// で始める");
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!user || !password || !url.hostname)
    fail("SUPABASE_DB_URL にユーザー・パスワード・ホストのどれかが無い");
  // ユーザー名が素の "postgres" のときは隠さない（ログの全ての "postgres" が *** になり読めなくなる）
  const masks = [
    password,
    url.password,
    url.hostname,
    ...(user === "postgres" ? [] : [user]),
  ];
  for (const secret of new Set(masks)) {
    console.log(`::add-mask::${secret}`);
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE:
      decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
    PGAPPNAME: "db-apply",
  };
}

function apply(migrationPath, expectedSha256) {
  const { sql, sha256 } = readMigration(migrationPath);
  if (
    !/^[0-9a-f]{64}$/.test(expectedSha256 ?? "") ||
    sha256 !== expectedSha256
  ) {
    fail(
      `sha256 が承認前の検査と一致しない（承認前 ${expectedSha256} / 今 ${sha256}）。適用しない`,
    );
  }
  const inspection = inspectMigration(sql);
  if (inspection.rejections.length > 0)
    fail("再検査で適用できない文が見つかった。適用しない");
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw)
    fail(
      "SUPABASE_DB_URL が無い（Environment production-db の secret を確認する）",
    );
  const pgEnv = pgEnvFromUrl(raw);

  const args = ["-X", "-v", "ON_ERROR_STOP=1", "--echo-errors"];
  if (inspection.mode === "single-transaction")
    args.push("--single-transaction");
  args.push("-f", migrationPath);
  console.log(`psql ${args.join(" ")}（mode=${inspection.mode}）`);
  const env = { ...process.env, ...pgEnv };
  delete env.SUPABASE_DB_URL;
  const result = spawnSync("psql", args, { cwd: ROOT, env, stdio: "inherit" });
  if (result.error) fail(`psql を起動できない: ${result.error.message}`);
  if (result.status !== 0) {
    writeGithubFile(
      "GITHUB_STEP_SUMMARY",
      `## 適用に失敗（psql の終了コード ${result.status}）\n\n1つのトランザクションで実行したため、変更は全て戻っている。台帳は更新しない。\n`,
    );
    fail(
      `psql が失敗した（終了コード ${result.status}）。変更は全て戻っている`,
    );
  }
  writeGithubFile(
    "GITHUB_STEP_SUMMARY",
    `## 適用済み: \`${migrationPath}\`\n\nsha256 \`${sha256}\`。台帳（APPLIED.md）を更新する PR は次の job が作る。` +
      "その job が失敗しても、DB には適用済み（この job を再実行しない）。\n",
  );
}

function markApplied(migrationPath, sha256) {
  const v = validateMigrationPath(migrationPath);
  if (!v.ok) fail(v.reason);
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) fail("sha256 の形が不正");
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const runUrl = `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  const { text, action } = markAppliedInLedger(readFileSync(LEDGER, "utf8"), {
    fileName: path.basename(migrationPath),
    date,
    runUrl,
    sha256,
  });
  writeFileSync(LEDGER, text);
  console.log(`APPLIED.md: ${action}（${path.basename(migrationPath)}）`);
}

const [command, migrationPath, sha256] = process.argv.slice(2);
switch (command) {
  case "inspect":
    inspect(migrationPath);
    break;
  case "apply":
    apply(migrationPath, sha256);
    break;
  case "mark-applied":
    markApplied(migrationPath, sha256);
    break;
  default:
    fail(
      "使い方: db-apply.js inspect <path> | apply <path> <sha256> | mark-applied <path> <sha256>",
    );
}
