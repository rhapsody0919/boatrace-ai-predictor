/**
 * VenueGrid - 全24会場を会場コード順の固定グリッドで表示する
 * venuesDataに含まれない会場は非開催（「本日開催なし」、次開催日が分かればその日付）として表示する
 */
import VenueGridCard from "./VenueGridCard";
import { ALL_VENUE_CODES } from "../../constants";
import "./VenueGrid.css";

// linkClosed（既定 true）: 非開催の会場もリンクにする。過去の日付の一覧は false
function VenueGrid({
  venuesData,
  getVenueLink,
  nowHHMM,
  nextOpenDates,
  linkClosed = true,
}) {
  const byCode = new Map((venuesData || []).map((v) => [v.placeCd, v]));

  return (
    <div className="venue-grid">
      {ALL_VENUE_CODES.map((code) => (
        <VenueGridCard
          key={code}
          venueCode={code}
          venueData={byCode.get(code) || null}
          linkTo={getVenueLink(code)}
          nowHHMM={nowHHMM}
          nextOpenDate={nextOpenDates?.get(code) ?? null}
          linkClosed={linkClosed}
        />
      ))}
    </div>
  );
}

export default VenueGrid;
