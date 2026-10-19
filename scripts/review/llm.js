#!/usr/bin/env node
/**
 * llm.js - AI の PR の審査の本体。別ベンダーの LLM に差分と材料を渡し、判定の JSON を出す。
 * Claude の PR（claude/）は OpenAI、Codex の PR（codex/）は Anthropic で見る（作った側と別のベンダー）。
 * この job は API キーだけを持ち、承認の鍵（審査の App）は持たない。PR の本文・タイトル・コメントは渡さない。
 *
 * env: GITHUB_TOKEN（読み取り）・GITHUB_REPOSITORY・BASE_SHA・HEAD_SHA・VENDOR・MATERIALS（任意）
 *      OPENAI_API_KEY と REVIEW_OPENAI_MODEL、または ANTHROPIC_API_KEY と REVIEW_ANTHROPIC_MODEL（既定 claude-opus-5）
 * 出力: verdict（parseVerdict の結果、JSON 1行）
 */
import { randomBytes } from "node:crypto";
import {
  buildReviewPrompt,
  mechanicalRejections,
  parseVerdict,
  VERDICT_SCHEMA,
} from "../lib/reviewPr.js";
import { fail, fetchDiff, requireEnv, setOutput } from "./common.js";

const SHA = /^[0-9a-f]{40}$/;

async function callOpenAI(system, user) {
  const key = requireEnv("OPENAI_API_KEY");
  const model = requireEnv("REVIEW_OPENAI_MODEL", /^[\w.:-]+$/);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_verdict",
          strict: true,
          schema: VERDICT_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) fail(`OpenAI API が ${res.status} を返した`);
  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== "stop")
    fail(`OpenAI の答えが途中で終わった（${choice?.finish_reason}）`);
  if (choice.message?.refusal) fail("OpenAI が審査を断った");
  return choice.message?.content ?? "";
}

async function callAnthropic(system, user) {
  const key = requireEnv("ANTHROPIC_API_KEY");
  const model = process.env.REVIEW_ANTHROPIC_MODEL || "claude-opus-5";
  if (!/^[\w.:-]+$/.test(model)) fail("REVIEW_ANTHROPIC_MODEL の形が違う");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: VERDICT_SCHEMA },
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) fail(`Anthropic API が ${res.status} を返した`);
  const data = await res.json();
  if (data.stop_reason !== "end_turn")
    fail(`Anthropic の答えが完了していない（${data.stop_reason}）`);
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/);
  const baseSha = requireEnv("BASE_SHA", SHA);
  const headSha = requireEnv("HEAD_SHA", SHA);
  const vendor = requireEnv("VENDOR", /^(openai|anthropic)$/);
  let materials = null;
  if (process.env.MATERIALS) {
    try {
      materials = JSON.parse(process.env.MATERIALS);
    } catch {
      fail("MATERIALS が JSON として読めない");
    }
  }

  // 関門と同じ head SHA の差分を取り直し、同じ検査をもう一度かける（関門の出力を信じ切らない）
  const { files, headModes, treeTruncated } = await fetchDiff(
    token,
    repo,
    baseSha,
    headSha,
  );
  const rejections = mechanicalRejections(files, headModes, treeTruncated);
  if (rejections.length > 0)
    fail(`機械の検査で止めた: ${rejections.join(" / ")}`);

  const { system, user } = buildReviewPrompt(files, materials, headSha, randomBytes(16).toString("hex"));
  const text =
    vendor === "openai"
      ? await callOpenAI(system, user)
      : await callAnthropic(system, user);
  const verdict = parseVerdict(text);
  setOutput("verdict", JSON.stringify(verdict));
  console.log(
    verdict.ok
      ? `判定: P0 ${verdict.p0} 件、指摘 ${verdict.findings.length} 件`
      : `判定を読めなかった: ${verdict.reason}`,
  );
}

main().catch((err) => {
  console.error(`::error::審査で失敗: ${err.message}`);
  process.exit(1);
});
