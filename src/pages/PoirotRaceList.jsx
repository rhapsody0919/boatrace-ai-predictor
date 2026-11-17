import PoirotRaceCard from "./PoirotRaceCard";

export default function PoirotRaceList({ loading, races, date, modelVersion }) {
  if (loading) {
    return (
      <div className="poirot-placeholder">
        <p>読み込み中...</p>
      </div>
    );
  }
  if (races.length === 0) {
    return (
      <div className="poirot-placeholder">
        <p>本日の予想はまだありません。</p>
        <p className="poirot-placeholder-sub">
          予想は日次バッチで生成されます。しばらくしてから再度お試しください。
        </p>
      </div>
    );
  }
  return (
    <>
      <p className="poirot-list-note">
        3連単の予測確率が高い順に表示（
        {date} / {races.length}レース）
      </p>
      <ul className="poirot-race-list">
        {races.map((race) => (
          <PoirotRaceCard
            key={race.race_id}
            race={race}
            modelVersion={modelVersion}
          />
        ))}
      </ul>
    </>
  );
}
