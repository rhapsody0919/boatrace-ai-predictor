/**
 * ブログ下書き（sns_drafts, platform='blog', status='pending_review'）に対して
 * 機械的な品質チェック（verify-blog-draft-quality.js）を実行し、全項目合格の
 * 場合のみ人間の承認を経ずに自動マージする（2026-09-07、ユーザー要望）。
 *
 * 1項目でも不合格ならここでは何もしない。sns_draftsは'pending_review'の
 * ままとなり、これまで通りsns-hub管理画面で人間が確認・承認する
 * （このスクリプトを実行しなかった場合と全く同じ状態になる。安全側）。
 *
 * docs/operation/sns-pipeline-blog.md「6. 下書きの永続化（Draft PR）」の
 * 直後（ステップ6.5）で、Routine自身がこのスクリプトを実行する想定。
 * 実行時のカレントディレクトリ・gitチェックアウト状態は6.でPRを作った
 * 直後のものをそのまま使う（public/blog/{slug}.md 等をローカルファイルとして
 * 直接読む。GitHubから改めて取得しない）。
 *
 * 使い方: node scripts/maintenance/finalize-blog-draft.js <draftId>
 */

import { execFileSync } from "child_process";
import { supabase } from "../lib/supabaseClient.js";
import { verifyBlogDraftQuality } from "./verify-blog-draft-quality.js";

const GITHUB_REPO = "rhapsody0919/boatrace-ai-predictor";
// docs/db-migration/053_sns_approvers_auto_merge.sql で作成済みの行と一致させる
const AUTO_APPROVER_DISPLAY_NAME = "自動承認（品質チェック合格）";

function extractPrNumber(prUrl) {
  const match = prUrl?.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function getChangedBlogSlug(prNumber) {
  const output = execFileSync(
    "gh",
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "files",
      "--jq",
      ".files[].path",
    ],
    { encoding: "utf-8" },
  );
  const files = output.split("\n").filter(Boolean);
  const mdFile = files.find((f) => /^public\/blog\/[^/]+\.md$/.test(f));
  if (!mdFile) {
    throw new Error(
      `PR #${prNumber}の変更ファイルにpublic/blog/*.mdが見つかりません（対象: ${files.join(", ")}）`,
    );
  }
  return mdFile.replace(/^public\/blog\//, "").replace(/\.md$/, "");
}

async function getAutoApproverId() {
  const { data, error } = await supabase
    .from("sns_approvers")
    .select("id")
    .eq("display_name", AUTO_APPROVER_DISPLAY_NAME)
    .single();
  if (error || !data) {
    throw new Error(
      `sns_approvers「${AUTO_APPROVER_DISPLAY_NAME}」行が見つかりません。docs/db-migration/053_sns_approvers_auto_merge.sqlを実行済みか確認してください（${error?.message ?? "no data"}）`,
    );
  }
  return data.id;
}

async function main() {
  const draftId = process.argv[2];
  if (!draftId) {
    console.error(
      "使い方: node scripts/maintenance/finalize-blog-draft.js <draftId>",
    );
    process.exit(1);
  }

  const { data: draft, error: draftError } = await supabase
    .from("sns_drafts")
    .select("*")
    .eq("id", draftId)
    .single();
  if (draftError || !draft) {
    console.error(
      `❌ sns_drafts取得エラー: ${draftError?.message ?? "見つかりません"}`,
    );
    process.exit(1);
  }
  if (draft.platform !== "blog") {
    console.error(
      `❌ platform='${draft.platform}'はこのスクリプトの対象外です（'blog'のみ）`,
    );
    process.exit(1);
  }
  if (draft.status !== "pending_review") {
    console.log(
      `ℹ️ status='${draft.status}'のため対象外（'pending_review'のみ処理する）`,
    );
    return;
  }

  const prNumber = extractPrNumber(draft.pr_url);
  if (!prNumber) {
    console.error("❌ この下書きにはpr_urlが設定されていません");
    process.exit(1);
  }

  const slug = getChangedBlogSlug(prNumber);
  const { getPostById } = await import("../../src/data/blogPosts.js");
  const meta = getPostById(slug);
  if (!meta) {
    console.error(
      `❌ src/data/blogPosts.jsに id='${slug}' のエントリが見つかりません`,
    );
    process.exit(1);
  }

  const { passed, checks } = await verifyBlogDraftQuality(slug, meta);

  console.log(`品質チェック結果（${slug}）:`);
  for (const check of checks) {
    console.log(
      `  ${check.passed ? "✅" : "❌"} ${check.name}: ${check.detail}`,
    );
  }

  if (!passed) {
    console.log(
      "\n⚠️ 1件以上不合格のため自動マージしない。sns-hub管理画面で人間が確認・承認してください（status='pending_review'のまま）。",
    );
    return;
  }

  console.log("\n✅ 全項目合格。自動マージを実行する。");

  const prInfo = JSON.parse(
    execFileSync("gh", ["pr", "view", String(prNumber), "--json", "isDraft"], {
      encoding: "utf-8",
    }),
  );
  if (prInfo.isDraft) {
    execFileSync("gh", ["pr", "ready", String(prNumber)]);
  }
  execFileSync("gh", [
    "pr",
    "merge",
    String(prNumber),
    "--squash",
    "--repo",
    GITHUB_REPO,
  ]);

  const autoApproverId = await getAutoApproverId();
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("sns_drafts")
    .update({
      status: "posted",
      approver_id: autoApproverId,
      approved_at: now,
      posted_at: now,
    })
    .eq("id", draftId);
  if (updateError) {
    console.error(
      `⚠️ PRマージ済みだがsns_drafts更新に失敗（手動でstatus='posted'に更新してください）: ${updateError.message}`,
    );
    process.exit(1);
  }

  console.log(
    `✅ PR #${prNumber}を自動マージし、sns_draftsを'posted'に更新した`,
  );
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
