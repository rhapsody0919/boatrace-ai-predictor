/**
 * RacerStructuredData - 選手個別ページの構造化データ（ProfilePage＋Person・BreadcrumbList JSON-LD）
 * dateModified は ProfilePage に置く（Person には無い項目。期別の最新の calc_to、BOA-1688）
 * VenueStructuredData.jsxと同じ形式を踏襲。プロフィール未取得の選手では何も出力しない
 */
import { isValidCrumbs, toBreadcrumbListLd } from "../utils/breadcrumbLd";
import { formatRacerKana } from "../utils/racerName";

const SITE_URL = "https://www.boat-ai.jp";

export default function RacerStructuredData({ profile, racerId, dateModified = null }) {
  if (!profile) return null;

  const person = {
    "@type": "Person",
    name: profile.name?.replace(/\s+/g, ""),
    // 画面に出している値だけを入れる（登録番号・よみ・支部。本文と食い違わせない）
    identifier: String(racerId),
    ...(profile.name_kana
      ? { alternateName: formatRacerKana(profile.name_kana) }
      : {}),
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

  const crumbs = [
    { name: "ホーム", url: "/" },
    { name: "選手一覧", url: "/racers" },
    { name: person.name, url: `/racer/${racerId}` },
  ];

  return (
    <>
      <script type="application/ld+json">{JSON.stringify(profilePage)}</script>
      {isValidCrumbs(crumbs) && (
        <script type="application/ld+json">
          {JSON.stringify(toBreadcrumbListLd(crumbs))}
        </script>
      )}
    </>
  );
}
