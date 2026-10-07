import { requireAdminAuth } from '../../../_lib/adminAuth.js';
import { isConfigured, isValidUuid, jsonResponse, signStoragePaths } from '../../../_lib/snsHubHelpers.js';
import { xSendStore, loadXMedia } from '../../../_lib/snsXSendStore.js';
import { prepareMobileReview, approveMobileReview } from '../../../_lib/snsMobileApproval.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (!['GET','POST'].includes(req.method)) return jsonResponse({ error:'Method not allowed' },405);
  if (!isConfigured()) return jsonResponse({ error:'DB未設定です' },503);
  try {
    const url = new URL(req.url), group = url.searchParams.get('group');
    if (!group && req.method === 'GET') {
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Tokyo' }).format(new Date());
      return jsonResponse({ data:await xSendStore.mobileGroups(date), date, connected:false });
    }
    if (!isValidUuid(group)) return jsonResponse({ error:'グループIDが不正です' },400);
    const rows = await xSendStore.mobileRace(group);
    if (req.method === 'POST') {
      const body = await req.json();
      if (!isValidUuid(body.draftId) || !isValidUuid(body.approverId)) return jsonResponse({ error:'IDが不正です' },400);
      const row = rows.find(r => r.draft.id === body.draftId);
      if (!row) return jsonResponse({ error:'下書きがありません' },404);
      const data = await approveMobileReview(row, body, { loadMedia:loadXMedia, approve:xSendStore.mobileApprove });
      return jsonResponse({ data, connected:false });
    }
    const data = [];
    // SQL readの件数上限に加え、hash/署名の同時実行を避ける。
    for (const row of rows) {
      const review = await prepareMobileReview(row,loadXMedia);
      const paths = [row.draft.video_storage_path, row.draft.cover_image_path].filter(Boolean);
      const urls = await signStoragePaths(paths);
      data.push({ draft:row.draft, job:row.job, versionHash:review.versionHash, holds:review.holds,
        videoUrl:urls[row.draft.video_storage_path] || null,
        imageUrl:urls[row.draft.cover_image_path] || null });
    }
    return jsonResponse({ data, connected:false });
  } catch {
    return jsonResponse({ error:'版・QA・状態が変わりました。再読込して確認してください' }, req.method === 'POST' ? 409 : 503);
  }
}
