import { draftContent } from '../../src/utils/snsDraftDiff.js';
import { sha256 } from './snsXSend.js';

/** 過去媒体を今ダウンロードして「過去のhash」とは推測しない。表示時だけ実バイトを保存する。 */
export async function captureDraftDiff(draft, loadMedia) {
  const media={};
  for(const [key,path] of [['video',draft.video_storage_path],['cover',draft.cover_image_path],['dataCard',draft.source_data?.dataCardPath]]) {
    if(!path) continue;
    let hash=null;
    try { const bytes=await loadMedia(path); if(bytes.byteLength) hash=await sha256(bytes); }
    catch { /* hash未確認として表示。差分取得全体の失敗と区別する。 */ }
    media[key]={path,sha256:hash};
  }
  return {content:draftContent(draft),media};
}
