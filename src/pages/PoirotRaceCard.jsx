import { confidenceBadge, formatProb, sortedWinProbs } from "./PoirotLogic";

export default function PoirotRaceCard({ race, modelVersion }) {
  const pred = race.models[modelVersion];
  const badge = confidenceBadge(pred.trifecta_prob);
  return (
    <li className="poirot-race-card">
      <div className="poirot-race-head">
        <span className="poirot-race-venue">
          {race.venue_name} {race.race_number}R
        </span>
        {race.start_time && (
          <span className="poirot-race-time">
            {String(race.start_time).slice(0, 5)}
          </span>
        )}
        {badge && (
          <span className={`poirot-conf-badge ${badge.className}`}>
            信頼度{badge.label}
          </span>
        )}
      </div>
      <div className="poirot-race-body">
        <div className="poirot-combo">
          <span className="poirot-combo-label">3連単</span>
          <span className="poirot-combo-boats">
            {pred.top_pick}-{pred.top_2nd}-{pred.top_3rd}
          </span>
          <span className="poirot-combo-prob">
            予測確率 {formatProb(pred.trifecta_prob)}
          </span>
        </div>
        <div className="poirot-probs">
          {sortedWinProbs(pred).map(([boat, p]) => (
            <span
              key={boat}
              className={
                "poirot-prob-chip" +
                (Number(boat) === pred.top_pick ? " is-top" : "")
              }
            >
              <i className={`boat-i b${boat}`}>{boat}</i>
              {formatProb(p)}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}
