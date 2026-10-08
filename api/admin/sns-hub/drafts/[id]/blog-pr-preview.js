import { jsonResponse, isConfigured, isValidDraftId, getDraftById } from '../../../../_lib/snsHubHelpers.js';
import { requireAdminAuth } from '../../../../_lib/adminAuth.js';
import { GITHUB_REPO, extractPrNumber, getBlogPr } from '../../../../_lib/snsBlogPr.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!isConfigured() || !process.env.GITHUB_MERGE_TOKEN) return jsonResponse({ error: '接続設定がありません' }, 500);
  const id = req.url.match(/drafts\/([^/]+)\/blog-pr-preview/)?.[1];
  if (!isValidDraftId(id)) return jsonResponse({ error: 'draft idの形式が不正です' }, 400);
  try {
    const draft = await getDraftById(id);
    const number = draft?.platform === 'blog' && extractPrNumber(draft.pr_url);
    if (!number) return jsonResponse({ error: 'ブログPRが見つかりません' }, 409);
    const pr = await getBlogPr(process.env.GITHUB_MERGE_TOKEN, number);
    if (pr.state !== 'open' || pr.merged || !/^[a-f0-9]{40}$/.test(pr.head?.sha || '')) return jsonResponse({ error: '確認可能なPRではありません' }, 409);
    return new Response(JSON.stringify({ headSha: pr.head.sha,
      previewUrl: `https://github.com/${GITHUB_REPO}/tree/${pr.head.sha}`,
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) { return jsonResponse({ error: error.message }, 502); }
}
