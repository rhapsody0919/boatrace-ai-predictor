#!/usr/bin/env node
/**
 * ro-setup.js - 読み取り専用ロール claude_ro のパスワードを作り、接続文字列を .env.local に書く（オーナーが1回実行する）。
 *
 *   node --env-file=.env.local scripts/db/ro-setup.js --pooler-host aws-0-<region>.pooler.supabase.com
 *
 * 1. 乱数のパスワード（hex 48字）を作る。画面には出さない
 * 2. 本体の作業ツリー（と、今の作業ツリーにあればそこ）の .env.local に SUPABASE_RO_DB_URL を書く
 *    （Session pooler・ユーザー名 claude_ro.<project-ref>。理由は docs/operation/db-apply.md の「Session pooler を使う理由」）
 * 3. SQL Editor に貼る ALTER ROLE を出す。中身は SCRAM の検証子だけで、平文のパスワードは履歴・ログに残らない
 *
 * 既に SUPABASE_RO_DB_URL があれば止まる。作り直すとき（パスワードの入れ替え）は --force。
 * project-ref は env SUPABASE_URL から取る。--pooler-host は Dashboard の Connect > Session pooler のホスト名。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RO_ROLE } from "../lib/roQuery.js";
import { scramSha256Verifier } from "../lib/scramVerifier.js";

const KEY = "SUPABASE_RO_DB_URL";

function parseArgs(argv) {
  const opts = { host: undefined, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pooler-host") opts.host = argv[++i];
    else if (argv[i] === "--force") opts.force = true;
    else throw new Error(`知らない引数: ${argv[i]}`);
  }
  return opts;
}

/** 本体の作業ツリーと今の作業ツリーの .env.local（重複は除く） */
function envFiles() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const commonDir = path.resolve(git(["rev-parse", "--git-common-dir"]));
  const mainRoot = path.dirname(commonDir);
  const here = git(["rev-parse", "--show-toplevel"]);
  const files = [path.join(mainRoot, ".env.local")];
  const local = path.join(here, ".env.local");
  if (local !== files[0] && existsSync(local)) files.push(local);
  return files;
}

/** @param {string} text @param {string} line @param {boolean} force 既にあれば置き換えるか。false なら null を返す */
export function upsertEnvLine(text, line, force) {
  const re = new RegExp(`^${KEY}=.*$`, "m");
  if (re.test(text)) {
    if (!force) return null;
    return text.replace(re, line);
  }
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.host || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(opts.host)) {
    throw new Error(
      "--pooler-host に Session pooler のホスト名（aws-0-<region>.pooler.supabase.com）を渡す",
    );
  }
  const ref = process.env.SUPABASE_URL
    ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0]
    : "";
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(
      "env SUPABASE_URL から project-ref を取れない（--env-file=.env.local を付ける）",
    );
  }

  const password = randomBytes(24).toString("hex");
  const url = `postgresql://${RO_ROLE}.${ref}:${password}@${opts.host}:5432/postgres`;
  const files = envFiles();
  const updates = files.map((file) => {
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const after = upsertEnvLine(before, `${KEY}=${url}`, opts.force);
    if (after === null) {
      throw new Error(
        `${file} に ${KEY} が既にある。作り直すなら --force（SQL Editor の ALTER ROLE も貼り直す）`,
      );
    }
    return { file, after };
  });
  const verifier = scramSha256Verifier(password);
  for (const [i, { file, after }] of updates.entries()) {
    try {
      writeFileSync(file, after, { mode: 0o600 });
    } catch (e) {
      throw new Error(
        `${file} に書けない（${e.message}）。${i > 0 ? "前のファイルは書き換え済みなので --force で" : ""}やり直す`,
      );
    }
  }

  console.log(`${KEY} を書いた: ${files.join(", ")}`);
  console.log(
    "次の1文を Supabase の SQL Editor で実行する（平文のパスワードは含まない）:\n",
  );
  console.log(
    `ALTER ROLE ${RO_ROLE} PASSWORD '${verifier}';`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error(`ro-setup: ${e.message}`);
    process.exit(1);
  }
}
