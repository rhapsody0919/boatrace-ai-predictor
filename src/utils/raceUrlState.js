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
// 龍神ソナーの中の切り替え（差がつく材料／類似レース／展開シナリオ）。投稿などから直接開くためのもので、
// 読むだけで書き戻さない（2026-10-08 D3）
export const RACE_SONAR_PARAM = "sonar";
export const SONAR_TAB_IDS = ["facts", "similar", "scenario"];
export const SONAR_RACE_TAB = "sonar";

/** `?sonar=` を内部タブの id に直す。それ以外は null */
export function parseSonarParam(raw) {
  return SONAR_TAB_IDS.includes(raw) ? raw : null;
}

/**
 * 開いたときのタブ。龍神ソナーは AI予想タブの中から独立したタブに移った（2026-10-08）。
 * 移る前に投稿したリンク `?tab=aiPrediction&sonar=…` はソナーを見に来た人なので、ソナーのタブで開く。
 * `sonar=` の無い `?tab=aiPrediction` は AI予想のまま
 */
export function resolveInitialRaceTab(tab, sonar) {
  if (tab === "aiPrediction" && parseSonarParam(sonar)) return SONAR_RACE_TAB;
  return tab;
}

const RACE_PATH = /^(\/[a-z]{2}(-[A-Za-z]{2})?)?\/race\/[^/]+\/?$/;

/** `?boat=` を 1〜6 の艇番に直す。それ以外（空・範囲外・数字でない）は null */
export function parseBoatParam(raw) {
  if (raw == null || !/^[1-6]$/.test(raw)) return null;
  return Number(raw);
}

/**
 * GA4 の page_view で使う URL（パス＋クエリ）。レース詳細ではタブ・艇・ソナーの中の切り替えのクエリを除く。
 * ほかのページはそのまま（/winning-technique?tab= はタブごとに数えたいので除かない）
 */
export function pageViewPath(pathname, search) {
  if (!RACE_PATH.test(pathname) || !search) return `${pathname}${search}`;
  const params = new URLSearchParams(search);
  params.delete(RACE_TAB_PARAM);
  params.delete(RACE_BOAT_PARAM);
  params.delete(RACE_SONAR_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
