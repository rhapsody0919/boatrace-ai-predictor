import RaceCard from "./HolmesAdlerRaceCard";

// 本日のライブ推理
export function AdlerLiveSection({ races, loading }) {
  return (
    <section className="holmes-section">
      <h3>🕐 本日の推理（ブラウザ内でリアルタイム計算）</h3>
      {loading ? (
        <p className="adler-loading">推理中…</p>
      ) : races.length === 0 ? (
        <p className="adler-loading">本日の出走データがまだありません</p>
      ) : (
        <>
          <p className="adler-summary-line">
            {races.length}レースの順列確率を計算（シャーロックの勝率 ×
            Plackett-Luce 展開）
          </p>
          <div className="adler-race-list">
            {races.map((r) => (
              <RaceCard key={r.raceId} race={r} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
