import BoatChip from "./BoatChip";

import { THEME } from "./HolmesAdlerLogic";

function ComboChips({ boats, ordered }) {
  return (
    <span className="adler-combo-chips">
      {boats.map((b, i) => (
        <span key={b} className="adler-combo-chip-wrap">
          {i > 0 && (
            <span className="adler-combo-sep">{ordered ? "→" : "・"}</span>
          )}
          <BoatChip boatNumber={b} />
        </span>
      ))}
    </span>
  );
}

function PermRow({ perm, rank, maxProb, ordered }) {
  const pct = perm.prob * 100;
  return (
    <div className={`adler-perm-row ${rank === 1 ? "top" : ""}`}>
      <span className="adler-perm-rank">{rank}</span>
      <ComboChips boats={perm.boats} ordered={ordered} />
      <div className="adler-bar-track">
        <div
          className="adler-bar-fill"
          style={{
            width: `${Math.max((perm.prob / maxProb) * 100, 2)}%`,
            background: THEME,
            opacity: rank === 1 ? 1 : 0.45,
          }}
        />
      </div>
      <span className="adler-perm-prob">{pct.toFixed(1)}%</span>
    </div>
  );
}

function PermList({ title, perms, ordered }) {
  if (!perms?.length) return null;
  const maxProb = perms[0].prob;
  return (
    <div className="adler-perm-list">
      <h4>{title}</h4>
      {perms.map((perm, i) => (
        <PermRow
          key={perm.label}
          perm={perm}
          rank={i + 1}
          maxProb={maxProb}
          ordered={ordered}
        />
      ))}
    </div>
  );
}

export default function RaceCard({ race }) {
  const top = race.permutations.trifecta[0];
  return (
    <details className="adler-race-card">
      <summary>
        <span className="adler-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="adler-race-time">
          {race.startTime ? race.startTime.slice(0, 5) : ""}
        </span>
        <span className="adler-race-pick">
          3連単本命 <strong>{top.label}</strong>
        </span>
        <span className="adler-prob-badge">{(top.prob * 100).toFixed(1)}%</span>
      </summary>
      <div className="adler-race-body">
        {!race.hasExhibition && (
          <p className="adler-note">※ 展示データ未取得（出走表のみで推理）</p>
        )}
        {!race.hasOdds && (
          <p className="adler-note">
            ※ オッズ未取得のため実力モデル単独の勝率から展開しています
          </p>
        )}
        <PermList
          title="🥇 3連単 TOP5"
          perms={race.permutations.trifecta}
          ordered
        />
        <div className="adler-perm-columns">
          <PermList
            title="🥈 2連単 TOP3"
            perms={race.permutations.exacta}
            ordered
          />
          <PermList
            title="🔗 3連複 TOP3"
            perms={race.permutations.trio}
            ordered={false}
          />
        </div>
      </div>
    </details>
  );
}
