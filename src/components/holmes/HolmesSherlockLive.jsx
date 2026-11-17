import BoatChip from "./BoatChip";
import RaceCard from "./HolmesSherlockRaceCard";
import {
  countWithOdds,
  selectEvPicks,
  topEvPicks,
} from "./HolmesSherlockLogic";

/**
 * HolmesSherlock の「本日のライブ推理」節（移すだけ）
 */

function EvPicks({ evPicks }) {
  return (
    <div className="sherlock-ev-picks">
      <h4>💎 妙味あり（EV上位）</h4>
      {topEvPicks(evPicks).map((r) => (
        <div key={r.raceId} className="sherlock-ev-pick-row">
          <span>
            {r.venueName} {r.raceNumber}R
          </span>
          <BoatChip boatNumber={r.bestEvBoat} />
          <span className="sherlock-ev-badge positive">
            EV {r.bestEv.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LiveBody({ races }) {
  const withOdds = countWithOdds(races);
  const evPicks = selectEvPicks(races);
  return (
    <>
      <p className="sherlock-summary-line">
        {races.length}レースを推理（オッズ取得済み {withOdds}件 / EV≥1.15
        の妙味候補 <strong>{evPicks.length}件</strong>）
      </p>
      {evPicks.length > 0 && <EvPicks evPicks={evPicks} />}
      <div className="sherlock-race-list">
        {races.map((r) => (
          <RaceCard key={r.raceId} race={r} />
        ))}
      </div>
    </>
  );
}

function HolmesSherlockLive({ races, loading }) {
  return (
    <section className="holmes-section">
      <h3>🕐 本日の推理（ブラウザ内でリアルタイム計算）</h3>
      {loading ? (
        <p className="sherlock-loading">推理中…</p>
      ) : races.length === 0 ? (
        <p className="sherlock-loading">本日の出走データがまだありません</p>
      ) : (
        <LiveBody races={races} />
      )}
    </section>
  );
}

export default HolmesSherlockLive;
