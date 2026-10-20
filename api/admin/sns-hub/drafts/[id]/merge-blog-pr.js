/**
 * Vercel Edge Function: ブログ下書きの承認→PR マージ（停止済み）
 * POST /api/admin/sns-hub/drafts/:id/merge-blog-pr
 *
 * 2026-10-20 に止めた（ADR-0034 を ADR-0097 で置き換え、BOA-908）。以前は管理画面の承認で、
 * Vercel の環境変数 GITHUB_MERGE_TOKEN（PAT）を使って記事の PR を直接マージしていた。
 * 今は記事の PR も他の PR と同じ道（CI・審査・マージの承認）を通す。この関数は鍵を読まず、
 * GitHub にも DB にも触れずに 410 を返す。PAT の失効と環境変数の削除はオーナーの操作（ADR-0034 の追記）。
 */
import { jsonResponse } from "../../../../_lib/snsHubHelpers.js";
import { requireAdminAuth } from "../../../../_lib/adminAuth.js";

export const config = {
  runtime: "edge",
};

export const RETIRED_MESSAGE =
  "管理画面からの記事の PR のマージは停止しました（ADR-0097）。記事の PR は GitHub の通常の手順でマージしてください";

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  return jsonResponse({ error: RETIRED_MESSAGE }, 410);
}
