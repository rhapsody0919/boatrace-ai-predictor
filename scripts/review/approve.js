#!/usr/bin/env node
/**
 * approve.js - AI の PR の審査の最後。審査の App の名義で、判定に従って APPROVE か COMMENT を付ける。
 * この job は審査の App の鍵だけを持ち、API キーは持たない。判定は llm の job の出力だけから読む。
 * 承認の直前に PR の head を取り直し、審査した SHA と違えば何もしない（新しい push の審査が別に走る）。
 *
 * env: GH_TOKEN（審査の App のトークン）・GITHUB_REPOSITORY・PR_NUMBER・REVIEWED_SHA・GATE_OK・GATE_REASON・
 *      LLM_RESULT（needs.llm.result）・VERDICT（needs.llm.outputs.verdict、無いこともある）
 */
import { decideAction, parseVerdict } from "../lib/reviewPr.js";
import { gh, requireEnv } from "./common.js";

async function main() {
  const token = requireEnv("GH_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/);
  const prNumber = requireEnv("PR_NUMBER", /^\d+$/);
  const reviewedSha = requireEnv("REVIEWED_SHA", /^[0-9a-f]{40}$/);

  // VERDICT は llm の job が parseVerdict で作ったもの。ここでもう一度、形を検査する
  let verdict = null;
  if (process.env.VERDICT) {
    try {
      const v = JSON.parse(process.env.VERDICT);
      // 数え直した P0 と llm の段の P0 の多い方を採る（切った後で数え直すと減ることがあるため）
      const again = v.ok
        ? parseVerdict(JSON.stringify({ findings: v.findings }))
        : v;
      verdict = { ...again, p0: Math.max(again.p0, Number(v.p0) || 0) };
    } catch {
      verdict = {
        ok: false,
        reason: "判定の JSON を読めない",
        findings: [],
        p0: 0,
      };
    }
  }

  const pr = await gh(token, "GET", `/repos/${repo}/pulls/${prNumber}`);
  const action = decideAction({
    gateOk: process.env.GATE_OK === "true",
    gateReason: process.env.GATE_REASON ?? "",
    llmResult: process.env.LLM_RESULT ?? "",
    verdict,
    reviewedSha,
    currentHeadSha: pr.head.sha,
  });
  if (action.event === "NONE") {
    console.log(
      `head が進んだ（審査 ${reviewedSha.slice(0, 9)} / 今 ${pr.head.sha.slice(0, 9)}）。何もしない`,
    );
    return;
  }
  await gh(token, "POST", `/repos/${repo}/pulls/${prNumber}/reviews`, {
    commit_id: reviewedSha,
    event: action.event,
    body: action.body,
  });
  console.log(`${action.event}: ${action.body.split("\n")[0]}`);
}

main().catch((err) => {
  console.error(`::error::承認の段で失敗: ${err.message}`);
  process.exit(1);
});
