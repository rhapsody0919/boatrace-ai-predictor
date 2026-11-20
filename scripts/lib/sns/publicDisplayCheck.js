// 公開画面の表示の確認（公開 URL の形と、未認証の headless で印が見えるか）。auto-plan（scripts/lib/snsAutoPlanRunner.js）と送る直前の検査（api/_lib/snsDeadlineQueue.js）が同じ関数を使う。
// api/_lib/snsDeadlineQueue.js から字のまま移した（api/ 側は再 export）

import { SCREEN_TABS } from '../snsScreenMarkers.js';

/** 公開URLの形（boat-ai.jp の origin・認証情報とフラグメントなし・query は UTM と tab だけ） */
function publicUrlValid(url) {
  // UTM 以外の query は、タブを直接開く tab（SCREEN_TABS の値だけ）しか受け付けない（sns-pdca-loop tasks 10）。
  const badQuery = [...url.searchParams.keys()].some(k => !['utm_source','utm_medium','utm_campaign','utm_content','tab'].includes(k));
  const badTab = url.searchParams.has('tab') && !SCREEN_TABS.includes(url.searchParams.get('tab'));
  return !(url.origin !== 'https://www.boat-ai.jp' || url.username || url.password || url.hash || badQuery || badTab);
}

/** headless.inspectは毎回新しい未認証contextで開く。Cookie/Storage/Preview設定を持ち込まない。
 * {url, context:{storageState:null}, requiredSelectors} -> {finalUrl, visibleSelectors}
 * selectorsは公開画面の印の設定。HTTP200やfeatureFlagsだけでは合格しない。
 */
export async function checkPublicDisplay(queue, headless, markers) {
  if (!headless || !queue?.public_url || !markers?.[queue.screen_key]?.length) throw new Error('public_check_unconfigured');
  const url = new URL(queue.public_url);
  if (!publicUrlValid(url)) throw new Error('public_url_invalid');
  const selectors = markers[queue.screen_key];
  const result = await headless.inspect({ url: url.href, context: { storageState: null }, requiredSelectors: selectors });
  if (result.finalUrl !== url.href || !selectors.every(s => result.visibleSelectors?.includes(s))) throw new Error('public_component_missing');
}
