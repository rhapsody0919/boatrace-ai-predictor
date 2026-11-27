/**
 * RacerStructuredData - 選手個別ページの構造化データ（ProfilePage＋Person・BreadcrumbList JSON-LD）
 * 値は src/pure/racerStructuredData.js（生の HTML の head と同じ関数）。プロフィール未取得の選手では何も出力しない
 */
import { racerStructuredData } from "../pure/racerStructuredData.js";

export default function RacerStructuredData({ profile, racerId, dateModified = null }) {
  return (
    <>
      {racerStructuredData(profile, racerId, dateModified).map((ld) => (
        <script key={ld["@type"]} type="application/ld+json">
          {JSON.stringify(ld)}
        </script>
      ))}
    </>
  );
}
