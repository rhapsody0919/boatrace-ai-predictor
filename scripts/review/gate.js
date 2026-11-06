#!/usr/bin/env node
/**
 * gate.js - AI の PR の審査の1段目（鍵なし）。差分を API で取り、機械で落とす形・月の上限・審査の相手を決める。
 * PR のコードは checkout も実行もしない（この script は master の定義から動く）。
 *
 * env: GITHUB_TOKEN（読み取り）・GITHUB_REPOSITORY・BASE_SHA・HEAD_SHA・HEAD_REF・PR_AUTHOR（作者の login）・
 *      PR_AUTHOR_ID（作者の数値の id）・OWNER_ID（リポジトリの持ち主の数値の id）・MAKER_BOT_ID（作成の App の数値の id、任意）・
 *      MONTHLY_LIMIT（任意、既定300。作成の App の PR）・OWNER_MONTHLY_LIMIT（任意、既定300。持ち主の名義の PR）
 * 出力に author_kind（owner・maker・空）と limit_only（止めた理由が月の上限だけか）を足す
 * 出力: ok（true/false）・reason・vendor・sql_tables（JSON の配列）・head_sha
 */
import {
  authorKind,
  mechanicalRejections,
  monthlyLimitReason,
  monthlyRunsPath,
  sqlTablesFromFiles,
  vendorForPr,
} from "../lib/reviewPr.js";
import { fetchDiff, gh, requireEnv, setOutput } from "./common.js";

const SHA = /^[0-9a-f]{40}$/;

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/);
  const baseSha = requireEnv("BASE_SHA", SHA);
  const headSha = requireEnv("HEAD_SHA", SHA);
  const headRef = process.env.HEAD_REF ?? "";

  const reasons = [];
  const kind = authorKind({
    authorId: process.env.PR_AUTHOR_ID,
    ownerId: process.env.OWNER_ID,
    makerId: process.env.MAKER_BOT_ID,
  });
  const vendor = vendorForPr(headRef, kind);
  if (!vendor) {
    reasons.push(
      kind === "maker"
        ? "ブランチの接頭辞が claude/ でも codex/ でもない"
        : kind === "owner"
          ? "ブランチ名が無い"
          : "作者が作成の App でも持ち主でもない",
    );
  }

  const actor = requireEnv("PR_AUTHOR");
  const now = new Date();
  const [all, skipped] = await Promise.all([
    gh(token, "GET", monthlyRunsPath(repo, actor, now)),
    gh(token, "GET", monthlyRunsPath(repo, actor, now, "skipped")),
  ]);
  const overLimit = monthlyLimitReason({
    total: all.total_count,
    skipped: skipped.total_count,
    kind,
    makerLimit: process.env.MONTHLY_LIMIT,
    ownerLimit: process.env.OWNER_MONTHLY_LIMIT,
  });
  if (overLimit) reasons.push(overLimit);

  const { files, headModes, treeTruncated } = await fetchDiff(
    token,
    repo,
    baseSha,
    headSha,
  );
  reasons.push(...mechanicalRejections(files, headModes, treeTruncated));
  // 止めた理由が月の上限だけか（持ち主の PR は、このときだけ COMMENT にする。機械の検査で止めたときは差し戻す）
  const limitOnly = reasons.length === 1 && reasons[0] === overLimit;

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
  setOutput("author_kind", kind ?? "");
  setOutput("limit_only", limitOnly ? "true" : "false");
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
