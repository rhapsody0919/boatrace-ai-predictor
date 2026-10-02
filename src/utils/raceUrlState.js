/**
 * レース詳細の「どのタブ・どの艇を見ているか」を URL のクエリに載せる（BOA-493）。
 *
 * `/race/:raceId?tab=meet&boat=3` のように、選ぶたびに history.replace で書き戻す。
 * アドレスバーのコピーやブラウザの共有シートで送ったリンクを開くと、同じタブ・艇で開く。
 * - push ではなく replace: 戻るボタンが艇・タブの選択を1つずつ巻き戻さないように
 * - 既定の状態（既定のタブ・艇を選んでいない）ではクエリを付けない
 * - canonical はクエリ無しのまま（RaceDetailPage.jsx）
 * - GA4 の page_view は、この2つを除いた URL で数える（pageViewPath）。選ぶたびに
 *   URL が変わるので、除かないと押した回数だけ PV が増える
 */

export const RACE_TAB_PARAM = "tab";
export const RACE_BOAT_PARAM = "boat";

const RACE_PATH = /^(\/[a-z]{2}(-[A-Za-z]{2})?)?\/race\/[^/]+\/?$/;

/** `?boat=` を 1〜6 の艇番に直す。それ以外（空・範囲外・数字でない）は null */
export function parseBoatParam(raw) {
  if (raw == null || !/^[1-6]$/.test(raw)) return null;
  return Number(raw);
}

/**
 * GA4 の page_view で使う URL（パス＋クエリ）。レース詳細ではタブ・艇のクエリを除く。
 * ほかのページはそのまま（/winning-technique?tab= はタブごとに数えたいので除かない）
 */
export function pageViewPath(pathname, search) {
  if (!RACE_PATH.test(pathname) || !search) return `${pathname}${search}`;
  const params = new URLSearchParams(search);
  params.delete(RACE_TAB_PARAM);
  params.delete(RACE_BOAT_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
