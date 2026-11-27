/**
 * 選手ページ（/racer/:id）の構造化データ（ProfilePage＋Person・BreadcrumbList の JSON-LD）。人の画面（RacerStructuredData.jsx）と、
 * 生の HTML の head の関数が同じ値を使う。画面に出している値だけを入れる（登録番号・よみ・支部）。副作用なし（src/pure）
 */
import { breadcrumbListLd } from "./pageHead.js";
import { formatRacerKana } from "./racerName.js";

const SITE_URL = "https://www.boat-ai.jp";

/**
 * @param {{name?: string|null, name_kana?: string|null, birth_date?: string|null, hometown?: string|null}|null} profile - 無ければ空
 * @param {string} racerId - 登録番号
 * @param {string|null} [dateModified] - 期別の最新の calc_to（ProfilePage に置く。Person には無い項目、BOA-1688）
 * @returns {object[]} ProfilePage と（パンくずが組めれば）BreadcrumbList。プロフィールが無ければ空
 */
export function racerStructuredData(profile, racerId, dateModified = null) {
  if (!profile) return [];
  const person = {
    "@type": "Person",
    name: profile.name?.replace(/\s+/g, ""),
    identifier: String(racerId),
    ...(profile.name_kana ? { alternateName: formatRacerKana(profile.name_kana) } : {}),
    ...(profile.birth_date ? { birthDate: profile.birth_date } : {}),
    ...(profile.hometown ? { homeLocation: profile.hometown } : {}),
    url: `${SITE_URL}/racer/${racerId}`,
  };
  const profilePage = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    ...(dateModified ? { dateModified } : {}),
    mainEntity: person,
  };
  const crumbs = breadcrumbListLd([
    { name: "ホーム", url: "/" },
    { name: "選手一覧", url: "/racers" },
    { name: person.name, url: `/racer/${racerId}` },
  ]);
  return crumbs ? [profilePage, crumbs] : [profilePage];
}
