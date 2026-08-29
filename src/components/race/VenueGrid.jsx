/**
 * VenueGrid - 全24会場を会場コード順の固定グリッドで表示する
 * venuesDataに含まれない会場は非開催（「本日開催なし」）として表示する
 */
import VenueGridCard from "./VenueGridCard";
import "./VenueGrid.css";

const ALL_VENUE_CODES = Array.from({ length: 24 }, (_, i) => i + 1);

function VenueGrid({ venuesData, getVenueLink, nowHHMM }) {
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
        />
      ))}
    </div>
  );
}

export default VenueGrid;
