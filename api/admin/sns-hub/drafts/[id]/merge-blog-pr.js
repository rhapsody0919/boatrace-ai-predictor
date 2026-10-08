/**
 * Vercel Edge Function: ブログ下書きの承認→Draft PR自動マージ
 * POST /api/admin/sns-hub/drafts/:id/merge-blog-pr
 * body: { approverId: string, headSha: string }
 *
 * platform='blog'の下書き専用。通常のapprove.jsと違い、承認操作自体が
 * GitHub APIでのPRマージまで行う（spec.md FR6、ADR 0034）。
 * 承認とマージが不可分な1アクションのため、成功時はstatusを直接'posted'にする
 * （approved/ready_to_postの中間状態を経由しない）。
 *
 * 環境変数 GITHUB_MERGE_TOKEN（Fine-grained PAT、対象リポジトリのみ・
 * Contents: Read/Write・Pull requests: Read/Write権限）が必要。未設定時は
 * 500を返す。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
} from "../../../../_lib/snsHubHelpers.js";

import { claimExternal, recordExternal, finishExternal, completedResponse } from "../../../../_lib/snsExternalOperations.js";
import { GITHUB_REPO, extractPrNumber, getBlogPr, assertReviewedHead } from "../../../../_lib/snsBlogPr.js";

import { requireAdminAuth } from "../../../../_lib/adminAuth.js";
import { isBundlePublicationBlocked } from "../../../../_lib/snsBundleValidation.js";

export const config = {
  runtime: "edge",
};

// ブログ下書きのPRは`docs/operation/sns-pipeline-blog.md`の手順で常に
// `gh pr create --draft`で作られる（人間承認前にマージされるのを防ぐ意図）。
// GitHubの通常マージAPI（PUT /pulls/:n/merge）はDraft PRを拒否するため、
// マージ前にGraphQL `markPullRequestReadyForReview`でReady化する必要がある
// （REST APIにはDraft→Ready変換の手段が無い）。2026-09-04、この変換が
// 未実装のままだったため「承認してもPRがマージされない」不具合が発生していた
async function markPullRequestReadyIfDraft(githubToken, pr) {
  if (!pr.draft) {
    return;
  }

  const graphqlResponse = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }",
      variables: { id: pr.node_id },
    }),
  });
  const graphqlResult = await graphqlResponse.json();
  if (!graphqlResponse.ok || graphqlResult.errors) {
    throw new Error(
      `Draft PRのReady化に失敗しました: ${JSON.stringify(graphqlResult.errors || graphqlResult)}`,
    );
  }
}

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }
  const githubToken = process.env.GITHUB_MERGE_TOKEN;
  if (!githubToken) {
    return jsonResponse({ error: "GITHUB_MERGE_TOKENが未設定です" }, 500);
  }

  const id = req.url.match(/drafts\/([^/]+)\/merge-blog-pr/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }
  const { approverId, headSha } = body;
  if (typeof headSha !== "string" || !/^[a-f0-9]{40}$/.test(headSha)) {
    return jsonResponse({ error: "画面で確認したheadShaは必須です" }, 400);
  }
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.platform !== "blog") {
      return jsonResponse(
        { error: "このエンドポイントはplatform='blog'の下書き専用です" },
        400,
      );
    }
    if (isBundlePublicationBlocked(draft)) {
      return jsonResponse(
        { error: "公開不可: v0素材の保留はこの操作で解除できません" },
        409,
      );
    }
    if (draft.external_operation_state === "external_done") {
      return jsonResponse(completedResponse(await finishExternal(draft)));
    }
    if (draft.external_operation_state === "done") return jsonResponse(completedResponse(draft));
    if (draft.external_operation_state === "reconcile") {
      return jsonResponse({ error: "マージ中または要照合です。再実行せずPRを確認してください" }, 409);
    }
    if (draft.status !== "pending_review") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きは承認できません（pending_reviewのみ）`,
        },
        409,
      );
    }
    const prNumber = extractPrNumber(draft.pr_url);
    if (!prNumber) {
      return jsonResponse(
        { error: "この下書きにはpr_urlが設定されていません" },
        409,
      );
    }

    const pr = await getBlogPr(githubToken, prNumber);
    try { assertReviewedHead(pr, headSha); }
    catch (error) { return jsonResponse({ error: error.message }, 409); }
    const operationToken = await claimExternal(draft, approverId);
    await markPullRequestReadyIfDraft(githubToken, pr);

    const mergeResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/pulls/${prNumber}/merge`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ merge_method: "squash", sha: headSha }),
      },
    );

    if (!mergeResponse.ok) {
      const errorBody = await mergeResponse.text();
      return jsonResponse(
        {
          error: `GitHub PRマージに失敗しました (${mergeResponse.status}): ${errorBody}`,
        },
        502,
      );
    }
    const mergeResult = await mergeResponse.json();

    if (!mergeResult.merged || !mergeResult.sha) {
      throw new Error("マージ成功を確認できません。再実行せず照合してください");
    }
    const recorded = await recordExternal(id, operationToken, {
      merge: mergeResult, posted_at: new Date().toISOString(),
      source_data: { blog_merge_sha: mergeResult.sha, blog_reviewed_head_sha: headSha, blog_pr_url: draft.pr_url },
    });
    return jsonResponse(completedResponse(await finishExternal(recorded)));

  } catch (error) {
    console.error("SNS Hub merge-blog-pr Edge function error:", error);
    return jsonResponse({ error: error.message }, error.status || 500);
  }
}
