/**
 * HolmesMycroft のレースカード（順位行・記憶ボックス込み、移すだけ）
 */
import { venueName } from "../../services/mycroftService";
import BoatChip from "./BoatChip";
import {
  THEME,
  barWidth,
  formatPercent,
  memoryWeights,
  raceTopInfo,
} from "./HolmesMycroftLogic";

function RankRow({ rank, boat, name, prob, maxProb }) {
  return (
    <div className={`mycroft-rank-row ${rank === 1 ? "top" : ""}`}>
      <span className="mycroft-rank-num">{rank}位</span>
      <BoatChip boatNumber={boat} />
      <span className="mycroft-player-name">{name || ""}</span>
      <div className="mycroft-bar-track">
        <div
          className="mycroft-bar-fill"
          style={{
            width: barWidth(prob, maxProb),
            background: THEME,
            opacity: rank === 1 ? 1 : 0.45,
          }}
        />
      </div>
      <span className="mycroft-rank-prob">{formatPercent(prob)}</span>
    </div>
  );
}

function MemoryBox({ boat, items }) {
  if (!items?.length) {
    return (
      <div className="mycroft-memory">
        <div className="mycroft-memory-title">
          🧠 {boat}号艇の記憶: 参照できる過去走がありません（新人・データ欠損）
        </div>
      </div>
    );
  }
  const widths = memoryWeights(items);
  return (
    <div className="mycroft-memory">
      <div className="mycroft-memory-title">
        🧠 本命 {boat}号艇について特に見た過去走
      </div>
      <ul>
        {items.map((it, i) => (
          <li key={`${it.race_date}-${it.venue_code}`}>
            <span className="mycroft-memory-date">{it.race_date}</span>
            <span className="mycroft-memory-venue">
              {venueName(it.venue_code)}
            </span>
            <span
              className={`mycroft-memory-result ${
                it.result === "着外" ? "bad" : "good"
              }`}
            >
              {it.result}
            </span>
            <span className="mycroft-memory-ago">{it.days_ago}日前</span>
            <div className="mycroft-memory-track">
              <div
                className="mycroft-memory-fill"
                style={{ width: widths[i] }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RaceSummary({ race, topBoat, topProb }) {
  return (
    <summary>
      <span className="mycroft-race-title">
        {race.venueName} {race.raceNumber}R
      </span>
      <span className="mycroft-race-time">
        {race.startTime ? race.startTime.slice(0, 5) : ""}
      </span>
      <span className="mycroft-race-pick">
        本命 <strong>{topBoat}号艇</strong>
      </span>
      <span className="mycroft-prob-badge">{formatPercent(topProb)}</span>
    </summary>
  );
}

function RankList({ race, maxProb }) {
  return (
    <div className="mycroft-rank-list">
      {race.rankOrder.map((boat, i) => (
        <RankRow
          key={boat}
          rank={i + 1}
          boat={boat}
          name={race.playerNames[boat]}
          prob={race.winProbs[String(boat)] ?? 0}
          maxProb={maxProb}
        />
      ))}
    </div>
  );
}

function HolmesMycroftRaceCard({ race }) {
  const { topBoat, topProb, maxProb } = raceTopInfo(race);
  return (
    <details className="mycroft-race-card">
      <RaceSummary race={race} topBoat={topBoat} topProb={topProb} />
      <div className="mycroft-race-body">
        <RankList race={race} maxProb={maxProb} />
        <MemoryBox
          boat={topBoat}
          items={race.attentionEvidence?.[String(topBoat)]}
        />
      </div>
    </details>
  );
}

export default HolmesMycroftRaceCard;
