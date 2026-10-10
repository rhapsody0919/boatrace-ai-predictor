import { requireAdminAuth } from '../../_lib/adminAuth.js';
import { isConfigured, isValidUuid, jsonResponse } from '../../_lib/snsHubHelpers.js';
import { xSendStore, loadXMedia } from '../../_lib/snsXSendStore.js';
import { captureDraftDiff } from '../../_lib/snsDraftDiff.js';
import { createXSnapshot, mobileVersion } from '../../_lib/snsXSend.js';
export const config={runtime:'edge'};
function diffResponse(body,status=200) {
  const response=jsonResponse(body,status);
  response.headers.set('Cache-Control','no-store');
  return response;
}
export default async function handler(req) {
  const denied=await requireAdminAuth(req);
  if(denied) return denied;
  if(req.method!=='GET') return diffResponse({error:'Method not allowed'},405);
  if(!isConfigured()) return diffResponse({error:'DB未設定です'},503);
  const params=new URL(req.url).searchParams;
  const id=params.get('id');
  if(!isValidUuid(id)) return diffResponse({error:'下書きIDが不正です'},400);
  try {
    const row=await xSendStore.readDraftDiff(id);
    if(!row) return diffResponse({error:'下書きがありません'},404);
    // 照合と差分保存で同じ実バイトを使う。二度目の媒体取得で別版を混ぜない。
    const media=new Map();
    const loadMedia=path=>{
      if(!media.has(path)) media.set(path,loadXMedia(path));
      return media.get(path);
    };
    if(params.has('versionHash')) {
      let currentHash=null;
      try { currentHash=await mobileVersion(row.revision,await createXSnapshot(row.draft,loadMedia)); }
      catch { /* 媒体取得失敗時も、確認版と一致したとは扱わない。 */ }
      if(!params.get('versionHash') || params.get('versionHash')!==currentHash)
        return diffResponse({error:'最新の版に更新されています。再読み込みしてください',code:'draft_version_changed'},409);
    }
    const snapshot=await captureDraftDiff(row.draft,loadMedia);
    // 138は送信中・要照合の行全体を書込禁止にする。補助保存も行わない。
    const saved=['reconcile','external_done'].includes(row.draft.external_operation_state)
      ? {...row,current:snapshot} : await xSendStore.saveDraftDiff(id,row.revision,snapshot);
    // 新規カラムのsnapshotは通常の下書きレスポンスに混ぜない。
    return diffResponse({data:{current:saved.current,previous:saved.previous,approved:saved.approved}});
  } catch { return diffResponse({error:'差分を取得できません。最新の状態を再読み込みしてください。'},503); }
}
