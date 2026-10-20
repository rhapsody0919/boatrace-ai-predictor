/**
 * usage.js - 審査の LLM の usage を1 run ごとに1行で残す（docs/design/db-apply-automation-finish/plan.md §10.7）。
 * llm の job のログに `::notice title=review-usage::{JSON}` を出し、hq は check run の annotation として読む。
 * 新しい鍵・action・Environment は使わない（ADR-0097「LLM を呼ぶ job は API キーだけ」）。
 *
 * 注入の対策: 値は全部ここで形を確かめてから出す。自由文（エラーの本文・finish_reason・PR のタイトル・本文・ブランチ名）は入れない。
 * 形が違う値は null（model だけは "invalid"）。結果、行に改行と % は入らない（workflow command の区切りを壊さない）。
 */

const SHA = /^[0-9a-f]{40}$/;
const MODEL = /^[\w.:-]+$/;
const DIGITS = /^\d+$/;

export const OUTCOMES = [
  "ok", // 判定を読めた
  "unreadable", // 応答は来たが JSON・判定として読めない（課金済み）
  "incomplete", // 途中で終わった（length 等、課金済み）
  "refused", // 審査を断った（課金済み）
  "http", // 2xx 以外（429・5xx・401 等）
  "timeout", // 応答が来ない
  "mechanical", // 機械の検査で止め、LLM を呼んでいない
  "error", // それ以外（env・GitHub API の失敗等）
];

const tokens = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const digits = (v) =>
  DIGITS.test(String(v ?? "")) && Number.isSafeInteger(Number(v))
    ? Number(v)
    : null;

/** OpenAI の chat completions の usage を共通の形にする */
export function openaiUsage(usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  return {
    in: tokens(u.prompt_tokens),
    out: tokens(u.completion_tokens),
    cached_in: tokens(u.prompt_tokens_details?.cached_tokens),
    cache_write: null,
    reasoning: tokens(u.completion_tokens_details?.reasoning_tokens),
  };
}

/** Anthropic の messages の usage を共通の形にする */
export function anthropicUsage(usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  return {
    in: tokens(u.input_tokens),
    out: tokens(u.output_tokens),
    cached_in: tokens(u.cache_read_input_tokens),
    cache_write: tokens(u.cache_creation_input_tokens),
    reasoning: null,
  };
}

/**
 * 記録から1行を作る（純関数）。
 * @param {{ runId?: unknown, attempt?: unknown, pr?: unknown, headSha?: unknown, vendor?: unknown,
 *           modelReq?: unknown, model?: unknown, at: Date, usage?: ReturnType<typeof openaiUsage> | null,
 *           http?: unknown, outcome?: unknown, p0?: unknown, p1?: unknown }} rec
 */
export function usageLine(rec) {
  const u = rec.usage ?? {};
  const model = (v) =>
    v == null || v === ""
      ? null
      : MODEL.test(String(v))
        ? String(v)
        : "invalid";
  const data = {
    v: 1,
    run_id: digits(rec.runId),
    attempt: digits(rec.attempt),
    pr: digits(rec.pr),
    head_sha: SHA.test(String(rec.headSha ?? "")) ? String(rec.headSha) : null,
    vendor: ["openai", "anthropic"].includes(rec.vendor) ? rec.vendor : null,
    model_req: model(rec.modelReq),
    model: model(rec.model),
    at:
      rec.at instanceof Date && !Number.isNaN(rec.at.getTime())
        ? rec.at.toISOString()
        : null,
    in: tokens(u.in),
    out: tokens(u.out),
    cached_in: tokens(u.cached_in),
    cache_write: tokens(u.cache_write),
    reasoning: tokens(u.reasoning),
    http:
      Number.isInteger(rec.http) && rec.http >= 100 && rec.http <= 599
        ? rec.http
        : null,
    outcome: OUTCOMES.includes(rec.outcome) ? rec.outcome : "error",
    p0: tokens(rec.p0),
    p1: tokens(rec.p1),
  };
  return `::notice title=review-usage::${JSON.stringify(data)}`;
}
