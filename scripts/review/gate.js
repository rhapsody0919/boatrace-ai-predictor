#!/usr/bin/env node
/**
 * gate.js - AI の PR の審査の1段目（鍵なし）。差分を API で取り、機械で落とす形・月の上限・審査の相手を決める。
 * PR のコードは checkout も実行もしない（この script は master の定義から動く）。
 *
 * env: GITHUB_TOKEN（読み取り）・GITHUB_REPOSITORY・BASE_SHA・HEAD_SHA・HEAD_REF・MONTHLY_LIMIT（任意、既定300）
 * 出力: ok（true/false）・reason・vendor・sql_tables（JSON の配列）・head_sha
 */
import {
  mechanicalRejections,
  monthStart,
  sqlTablesFromFiles,
  vendorForBranch,
} from "../lib/reviewPr.js";
import { fetchDiff, gh, requireEnv, setOutput } from "./common.js";

const SHA = /^[0-9a-f]{40}$/;

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/);
  const baseSha = requireEnv("BASE_SHA", SHA);
  const headSha = requireEnv("HEAD_SHA", SHA);
  const headRef = process.env.HEAD_REF ?? "";
  const limit = Number(process.env.MONTHLY_LIMIT || 300);

  const reasons = [];
  const vendor = vendorForBranch(headRef);
  if (!vendor) reasons.push("ブランチの接頭辞が claude/ でも codex/ でもない");

  const runs = await gh(
    token,
    "GET",
    `/repos/${repo}/actions/workflows/review.yml/runs?created=%3E%3D${monthStart(new Date())}&per_page=1`,
  );
  if (!Number.isFinite(limit) || runs.total_count > limit) {
    reasons.push(
      `今月の審査が上限を超えた（${runs.total_count}件、上限 ${limit}）。上限は repo の変数 REVIEW_MONTHLY_LIMIT`,
    );
  }

  const { files, headModes, treeTruncated } = await fetchDiff(
    token,
    repo,
    baseSha,
    headSha,
  );
  reasons.push(...mechanicalRejections(files, headModes, treeTruncated));

  const ok = reasons.length === 0;
  setOutput("ok", ok ? "true" : "false");
  setOutput(
    "reason",
    reasons
      .join(" / ")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 2000),
  );
  setOutput("vendor", vendor ?? "");
  setOutput("sql_tables", JSON.stringify(ok ? sqlTablesFromFiles(files) : []));
  setOutput("head_sha", headSha);
  console.log(
    ok
      ? `OK: ${files.length} ファイル、審査は ${vendor}`
      : `審査しない: ${reasons.join(" / ")}`,
  );
}

main().catch((err) => {
  console.error(`::error::関門で失敗: ${err.message}`);
  process.exit(1);
});
