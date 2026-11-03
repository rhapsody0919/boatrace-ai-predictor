/**
 * X の投稿を消す口の部品（BOA-1279、オーナー 2026-11-04「架空の選手の投稿は削除」）。
 * - 消す相手は送信の記録（sns_x_send_jobs の channel=x・state=posted・external_post_id）にあるものだけ。記録に無い ID は消さない
 * - 消すのは ID を明示で並べたときだけ（1回 DELETE_MAX_TARGETS 件まで）。条件で一括に消す道は作らない。
 *   架空の候補（fictionalReasons）は一覧に出すだけで、消す相手には使わない
 * - 消した記録は 197 の mark_sns_x_post_deleted（deleted_at・deleted_reason、計測の pending の job を missing で閉じる）。
 *   state は posted のまま（日の上限・同じレースの未送信の検査は posted を数える。X も消した投稿を作った回数に数える）
 */

// 1回の上限。管理 API（maxDuration 300 秒）の中で、X の呼び出し1回30秒×5件＋鍵の refresh の待ち（最大120秒）に収める
export const DELETE_MAX_TARGETS = 5;
export const DELETE_REASON_MAX = 200;
export const TWEET_ID_RE = /^[0-9]{1,19}$/;
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 試験の型の印（race_id・title）。架空の候補の理由に使うだけ
const TEST_MARK_RE =
  /(^|[^a-z])(test|smoke|fixture|dummy|mock)([^a-z]|$)|試験|架空/i;

/** 消す理由の不備（純粋関数）。無ければ null */
export function deleteReasonIssue(reason) {
  if (typeof reason !== "string" || !reason.trim())
    return "--reason（消す理由）が要る";
  if ([...reason.trim()].length > DELETE_REASON_MAX)
    return `--reason は${DELETE_REASON_MAX}字まで`;
  if (/[\r\n]/.test(reason)) return "--reason に改行を入れない";
  return null;
}

/** 選手の名前の比べ方（空白を除く。racer_profiles は姓と名の間に全角の空白を詰める形。JS の \s は全角の空白を含む） */
export const normalizeRacerName = (name) => String(name).replace(/\s+/g, "");

/** source_data の中の racers[].name を集める（純粋関数。今は節の機力の source_data.setsu_kiryoku.racers） */
export function racerNamesOf(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) racerNamesOf(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "racers" && Array.isArray(child))
        for (const racer of child)
          if (typeof racer?.name === "string" && racer.name.trim())
            out.push(racer.name);
      racerNamesOf(child, out);
    }
  }
  return out;
}

/**
 * 架空・試験の投稿と疑う理由（純粋関数）。空なら候補でない。
 * roster は racer_profiles の名前（normalizeRacerName 済み）の Set。名簿は今の登録だけなので、引退した選手も候補に出る
 * （候補はオーナーが見て決める一覧で、消す相手には使わない）
 */
export function fictionalReasons({ draft }, roster) {
  const reasons = [];
  const unknown = [
    ...new Set(
      racerNamesOf(draft?.source_data ?? {}).filter(
        (name) => !roster.has(normalizeRacerName(name)),
      ),
    ),
  ];
  if (unknown.length)
    reasons.push(
      `選手の名簿に無い名前 ${unknown.length}人（${unknown.slice(0, 3).join("・")}${unknown.length > 3 ? "…" : ""}）`,
    );
  const marks = [draft?.title, draft?.source_data?.race_id].filter(
    (s) => typeof s === "string" && TEST_MARK_RE.test(s),
  );
  if (marks.length) reasons.push(`試験の印（${marks[0]}）`);
  return reasons;
}

/** 一覧の1行（純粋関数）。本文は先頭30字（改行は空白に） */
export function candidateRow({ job, draft }, reasons) {
  const text = String(job?.snapshot?.text ?? "").replace(/\s+/g, " ");
  return {
    job_id: job.id,
    tweet_id: job.external_post_id,
    posted_at: job.posted_at,
    format: draft?.format ?? null,
    title: draft?.title ?? null,
    head: [...text].slice(0, 30).join(""),
    reasons,
    deleted_at: job.deleted_at ?? null,
  };
}

/**
 * 消す相手の確かめ（純粋関数）。job は sns_x_send_jobs の行。問題が無ければ null
 */
export function targetIssue(job, tweetId) {
  if (!job) return "送信の記録に無い";
  if (job.channel !== "x") return "X の送信でない";
  if (job.state !== "posted") return `state が posted でない（${job.state}）`;
  if (!TWEET_ID_RE.test(job.external_post_id ?? ""))
    return "投稿の ID が記録に無い";
  if (tweetId !== undefined && job.external_post_id !== tweetId)
    return "投稿の ID が記録と違う";
  return null;
}

/**
 * 消す口の本体。targets は [{job_id, tweet_id}]（明示の ID だけ）。順に、記録を確かめ → X で消す（404 は既に無い）→ 記録を直す。
 * 1件でも落ちたら残りは送らない（何が済んだかを results で返す）。
 * store: readJob(id)（列 deleted_at が無ければ投げる＝197 未適用）・markDeleted(jobId, tweetId, reason)
 * getX: () => Promise<{deletePost(id)}>（X の鍵は消す相手が1件でも要るときだけ取る）
 */
export async function runDeleteXPosts({ targets, reason }, { store, getX }) {
  const issue = deleteTargetsIssue(targets) ?? deleteReasonIssue(reason);
  if (issue) throw new Error(issue);
  const results = [];
  let x = null;
  for (const target of targets) {
    try {
      const job = await store.readJob(target.job_id);
      if (job && !("deleted_at" in job))
        throw new Error("197 が未適用（sns_x_send_jobs に deleted_at が無い）");
      const problem = targetIssue(job, target.tweet_id);
      if (problem) throw new Error(problem);
      let already = Boolean(job.deleted_at);
      if (!already) {
        x ??= await getX();
        already = (await x.deletePost(job.external_post_id)).already;
      }
      const mark = await store.markDeleted(
        job.id,
        job.external_post_id,
        reason.trim(),
      );
      results.push({ ...target, ok: true, already, ...mark });
    } catch (error) {
      // 済んだ分（results）を返し、残りは送らない
      results.push({ ...target, ok: false, error: error.message });
      break;
    }
  }
  return {
    ok: results.length === targets.length && results.every((r) => r.ok),
    results,
  };
}

/** targets の形（純粋関数）。問題が無ければ null */
export function deleteTargetsIssue(targets) {
  if (!Array.isArray(targets) || !targets.length)
    return "消す投稿の ID を明示で並べる（条件で一括には消さない）";
  if (targets.length > DELETE_MAX_TARGETS)
    return `1回に消すのは${DELETE_MAX_TARGETS}件まで`;
  for (const t of targets)
    if (!UUID_RE.test(t?.job_id ?? "") || !TWEET_ID_RE.test(t?.tweet_id ?? ""))
      return "targets は {job_id（uuid）, tweet_id（数字）} の形";
  if (new Set(targets.map((t) => t.job_id)).size !== targets.length)
    return "同じ投稿が2回ある";
  return null;
}
