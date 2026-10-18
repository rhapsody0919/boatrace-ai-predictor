import { requireAdminAuth } from '../../_lib/adminAuth.js';
import { isConfigured, jsonResponse } from '../../_lib/snsHubHelpers.js';
import { xSendStore } from '../../_lib/snsXSendStore.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!isConfigured()) return jsonResponse({ error: 'DB未設定です' }, 503);
  // 待ち行列と状態は独立なので並べて読む。状態（モード・停止）が読めなくても待ち行列は返す。
  // 画面は control=null を「状態を取得できません」と出す
  const [queue, controlResult] = await Promise.allSettled([xSendStore.queue(), xSendStore.sendControl()]);
  if (queue.status === 'rejected') return jsonResponse({ error: '待ち行列を取得できません' }, 503);
  const data = queue.value;
  let control = null;
  if (controlResult.status === 'fulfilled') control = controlResult.value;
  else console.error('送信の状態を取得できません:', controlResult.reason);
  return jsonResponse({ data, control, connected: false });
}
