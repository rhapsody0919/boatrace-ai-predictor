/**
 * gha-skip-gate.js - GitHub Actions の日次ワークフローの先行ジョブが呼ぶ、スキップ判定（フェイルセーフ付きSKIP）。
 *
 * 使い方（ワークフローの gate ジョブ。SKIP 変数が true のときだけ起動する）:
 *   node scripts/maintenance/gha-skip-gate.js SKIP_POINT_RANK_ON_GHA [--wait]
 *
 * 判定は scripts/lib/ghaSkipGate.js。結果は標準出力と、$GITHUB_OUTPUT（あれば）の `skip=true|false` に出す。
 * --wait: 日次ジョブの指定時刻の直後は、Vercel の処理の完了を最大10分まで待って再判定する（同じ時刻に起動して二重に取得しない）。
 *
 * 常に終了コード0。どんな失敗（例外・環境変数の欠落・DB の読み取り失敗）も skip=false（後続の取得ジョブが実行される）にする。
 * このスクリプトは、SUPABASE_URL・SUPABASE_SERVICE_KEY（GitHub Actions の既存のシークレット）だけを使い、npm ci は要らない。
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  GHA_SKIP_TARGETS,
  shouldSkipOnGha,
  shouldSkipOnGhaWaiting,
} from "../lib/ghaSkipGate.js";

function writeOutput(skip, env = process.env) {
  const line = `skip=${skip ? "true" : "false"}`;
  console.log(line);
  if (env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(env.GITHUB_OUTPUT, `${line}\n`);
    } catch (error) {
      console.error(`⚠️ GITHUB_OUTPUT への書き込みに失敗: ${error.message}`);
    }
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const varName = argv.find((a) => !a.startsWith("--"));
  const wait = argv.includes("--wait");
  try {
    if (!varName || !(varName in GHA_SKIP_TARGETS)) {
      console.error(
        `⚠️ 対象外の変数です（${varName ?? "未指定"}）。対象: ${Object.keys(GHA_SKIP_TARGETS).join(", ")}。実行します`,
      );
      writeOutput(false, env);
      return false;
    }
    const decide = wait ? shouldSkipOnGhaWaiting : shouldSkipOnGha;
    const decision = await decide({ varName, env, logger: console });
    writeOutput(decision.skip, env);
    return decision.skip;
  } catch (error) {
    console.error(
      `⚠️ 判定に失敗したため実行します: ${error?.message ?? error}`,
    );
    writeOutput(false, env);
    return false;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
