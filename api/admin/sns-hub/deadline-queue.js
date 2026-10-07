import { requireAdminAuth } from '../../../_lib/adminAuth.js';
import { isConfigured, jsonResponse } from '../../../_lib/snsHubHelpers.js';
import { xSendStore } from '../../../_lib/snsXSendStore.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!isConfigured()) return jsonResponse({ error: 'DB未設定です' }, 503);
  try { return jsonResponse({ data: await xSendStore.queue(), connected: false }); }
  catch { return jsonResponse({ error: '待ち行列を取得できません' }, 503); }
}
