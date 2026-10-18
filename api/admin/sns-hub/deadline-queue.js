import { requireAdminAuth } from '../../_lib/adminAuth.js';
import { isConfigured, jsonResponse } from '../../_lib/snsHubHelpers.js';
import { xSendStore } from '../../_lib/snsXSendStore.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!isConfigured()) return jsonResponse({ error: 'DB未設定です' }, 503);
  let data;
  try { data = await xSendStore.queue(); }
  catch { return jsonResponse({ error: '待ち行列を取得できません' }, 503); }
  // 状態（モード・停止）が読めなくても待ち行列は返す。画面は control=null を「状態を取得できません」と出す
  let control = null;
  try { control = await xSendStore.sendControl(); }
  catch (err) { console.error('送信の状態を取得できません:', err); }
  return jsonResponse({ data, control, connected: false });
}
