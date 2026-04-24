/**
 * PredictionTable - AIデータ予想テーブル + 統計的な注目ポイント + データの見方
 */

import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";

function generateInsights(prediction, showExhibition, volatility) {
  const candidates = [];
  const players = prediction.allPlayers || [];
  const racerStats = prediction.racerStats || [];
  const exhibition = prediction.exhibitionData || [];
  const turn = prediction.turnPrediction;
  const top3 = prediction.top3 || [];

  // ルール1: スタート力の差（avgST <= 0.12 & stStddev <= 0.04）
  for (const s of racerStats) {
    if (s.avgST != null && s.avgST <= 0.12 && s.stStddev != null && s.stStddev <= 0.04) {
      const boost = top3.includes(s.boatNumber) ? 1 : 0;
      candidates.push({
        priority: 7 + boost,
        text: `${s.boatNumber}号艇は平均ST ${s.avgST.toFixed(2)}と非常にスタートが速く、安定感も高い（標準偏差${s.stStddev.toFixed(2)}）`,
      });
    }
  }

  // ルール2: イン崩れ指数の示唆
  if (volatility?.score != null) {
    if (volatility.score >= 55) {
      candidates.push({
        priority: 7,
        text: `イン崩れ指数${volatility.score} — 1コースが崩れやすい。まくり・差しに注目`,
      });
    } else if (volatility.score < 42) {
      candidates.push({
        priority: 7,
        text: `イン崩れ指数${volatility.score} — 1コースが安定。本命筋が有利`,
      });
    }
  }

  // ルール3: 展開予測の決まり手（probability >= 0.35）
  if (turn?.technique && turn.probability >= 0.35) {
    const techName = TECHNIQUE_NAMES[turn.technique] || turn.technique;
    const pct = Math.round(turn.probability * 100);
    candidates.push({
      priority: 6,
      text: `AIは「${techName}」決着の確率を${pct}%と予測。${turn.winnerCourse}号艇が有力`,
    });
  }

  // ルール4: 展示タイムの優位性
  if (showExhibition && exhibition.length >= 6) {
    const valid = exhibition.filter((e) => e.exhibition_time != null);
    if (valid.length >= 6) {
      const sorted = [...valid].sort((a, b) => a.exhibition_time - b.exhibition_time);
      const best = sorted[0];
      const othersAvg =
        sorted.slice(1).reduce((sum, e) => sum + e.exhibition_time, 0) / (sorted.length - 1);
      const diff = othersAvg - best.exhibition_time;
      if (diff >= 0.05) {
        const boost = top3.includes(best.boat_number) ? 1 : 0;
        candidates.push({
          priority: 6 + boost,
          text: `${best.boat_number}号艇の展示タイム${best.exhibition_time.toFixed(2)}は他艇平均より${diff.toFixed(2)}秒速く、当日の機力が際立つ`,
        });
      }
    }
  }

  // ルール5: コース勝率の注目（当該コース勝率 >= 40%、10走以上）
  for (const s of racerStats) {
    const courseStr = String(s.boatNumber);
    const counts = s.courseRaceCounts?.[courseStr];
    if (counts && counts.total >= 10 && counts.wins / counts.total >= 0.4) {
      const pct = Math.round((counts.wins / counts.total) * 100);
      const boost = top3.includes(s.boatNumber) ? 1 : 0;
      candidates.push({
        priority: 5 + boost,
        text: `${s.boatNumber}号艇は${courseStr}コースでの勝率${pct}%（${counts.wins}/${counts.total}）と突出した実績`,
      });
    }
  }

  // ルール6: 当地勝率の優位性（>= 6.0 かつ 2位と1.0以上差）
  const sortedByLocal = [...players].sort(
    (a, b) => parseFloat(b.localWinRate) - parseFloat(a.localWinRate),
  );
  if (sortedByLocal.length >= 2) {
    const top = parseFloat(sortedByLocal[0].localWinRate);
    const second = parseFloat(sortedByLocal[1].localWinRate);
    if (top >= 6.0 && top - second >= 1.0) {
      const p = sortedByLocal[0];
      const boost = top3.includes(p.number) ? 1 : 0;
      candidates.push({
        priority: 5 + boost,
        text: `${p.number}号艇の${p.name}選手は当地勝率${p.localWinRate}で、2位と${(top - second).toFixed(1)}差の得意レース場`,
      });
    }
  }

  // ルール7: 好モーター（motor2Rate > 40）
  const goodMotors = players.filter((p) => parseFloat(p.motor2Rate) > 40);
  if (goodMotors.length > 0) {
    const motorList = goodMotors.map((p) => `${p.number}号艇（${p.motor2Rate}%）`).join("、");
    candidates.push({
      priority: 4,
      text: `${motorList}のモーターは2連率が高く好調`,
    });
  }

  // ルール8: 総合力の大差（boatStrengths 1位と2位が0.20以上差）
  if (turn?.boatStrengths?.length === 6) {
    const indexed = turn.boatStrengths.map((s, i) => ({ boat: i + 1, strength: s }));
    indexed.sort((a, b) => b.strength - a.strength);
    const gap = indexed[0].strength - indexed[1].strength;
    if (gap >= 0.2) {
      candidates.push({
        priority: 4,
        text: `${indexed[0].boat}号艇の総合力${Math.round(indexed[0].strength * 100)}%は2位と${Math.round(gap * 100)}ポイント差。圧倒的に有利`,
      });
    }
  }

  // ルール9: 高全国勝率（winRate >= 7.0）
  const topRacers = players.filter((p) => parseFloat(p.winRate) >= 7.0);
  if (topRacers.length > 0) {
    const racerList = topRacers.map((p) => `${p.number}号艇（勝率${p.winRate}）`).join("、");
    candidates.push({
      priority: 3,
      text: `${racerList}は全国勝率が高い実力者`,
    });
  }

  // priority 降順ソート → 上位5件
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 5).map((c) => c.text);
}

function PredictionTable({ prediction, showExhibition = false, volatility }) {
  if (!prediction?.allPlayers || prediction.allPlayers.length === 0)
    return null;

  const top3 = prediction.top3 || [];
  const strengths = prediction.turnPrediction?.boatStrengths || [];
  const sorted = [...prediction.allPlayers].sort((a, b) => {
    const aIdx = top3.indexOf(a.number);
    const bIdx = top3.indexOf(b.number);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return (strengths[b.number - 1] || 0) - (strengths[a.number - 1] || 0);
  });

  const insights = generateInsights(prediction, showExhibition, volatility);

  return (
    <div className="detailed-analysis">
      <h3>
        <span aria-hidden="true">📊</span> AIデータ予想
      </h3>

      <div className="enhanced-table">
        <table className="players-table-detailed" aria-label="選手詳細データ">
          <thead>
            <tr>
              <th scope="col">艇番</th>
              <th scope="col">選手名</th>
              <th scope="col">級別</th>
              <th scope="col">年齢</th>
              <th scope="col">全国勝率</th>
              <th scope="col">全国2連率</th>
              <th scope="col">当地勝率</th>
              <th scope="col">モーター2率</th>
              <th scope="col">平均ST</th>
              {showExhibition && <th scope="col">展示タイム</th>}
              {showExhibition && <th scope="col">展示ST</th>}
              <th scope="col">総合力</th>
              <th scope="col">コース勝率</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player) => (
              <tr
                key={player.number}
                className={top3.includes(player.number) ? "recommended" : ""}
              >
                <th scope="row">
                  <strong>{player.number}</strong>
                </th>
                <td>{player.name}</td>
                <td>{player.grade}</td>
                <td>{player.age || "-"}</td>
                <td>{player.winRate}</td>
                <td>
                  {player.global2Rate ? `${player.global2Rate}%` : "-"}
                </td>
                <td>
                  {player.localWinRate}
                  {parseFloat(player.localWinRate) > 7.0 && (
                    <span className="fire" aria-label="優秀">
                      🔥
                    </span>
                  )}
                </td>
                <td>
                  {player.motor2Rate}%
                  {parseFloat(player.motor2Rate) > 40 && (
                    <span className="fire" aria-label="優秀">
                      🔥
                    </span>
                  )}
                </td>
                <td>
                  {(() => {
                    const stats = prediction.racerStats?.find(
                      (s) => s.boatNumber === player.number,
                    );
                    return stats?.avgST != null
                      ? stats.avgST.toFixed(2)
                      : "-";
                  })()}
                </td>
                {showExhibition && (
                  <td>
                    {(() => {
                      const ex = prediction.exhibitionData?.find(
                        (e) => e.boat_number === player.number,
                      );
                      return ex?.exhibition_time != null
                        ? ex.exhibition_time.toFixed(2)
                        : "-";
                    })()}
                  </td>
                )}
                {showExhibition && (
                  <td>
                    {(() => {
                      const ex = prediction.exhibitionData?.find(
                        (e) => e.boat_number === player.number,
                      );
                      return ex?.start_timing != null
                        ? ex.start_timing.toFixed(2)
                        : "-";
                    })()}
                  </td>
                )}
                <td>
                  {prediction.turnPrediction?.boatStrengths?.[
                    player.number - 1
                  ] != null
                    ? `${Math.round(prediction.turnPrediction.boatStrengths[player.number - 1] * 100)}%`
                    : "-"}
                </td>
                <td>
                  {(() => {
                    const stats = prediction.racerStats?.find(
                      (s) => s.boatNumber === player.number,
                    );
                    const courseCounts =
                      stats?.courseRaceCounts?.[String(player.number)];
                    if (!courseCounts) return "-";
                    return `${courseCounts.wins || 0}/${courseCounts.total || 0}`;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {insights.length > 0 && (
        <div className="statistical-insights">
          <h4>
            <span aria-hidden="true">📌</span> 統計的な注目ポイント
          </h4>
          <ul>
            {insights.map((insight, idx) => (
              <li key={idx}>{insight}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="data-guide">
        <summary>
          <h4>
            <span aria-hidden="true">💡</span> データの見方
          </h4>
        </summary>
        <div className="guide-grid">
          <div className="guide-item">
            <strong>全国勝率</strong>
            <p>選手の全国での勝率。6.0以上でA級レベル。</p>
          </div>
          <div className="guide-item">
            <strong>全国2連率</strong>
            <p>2着以内に入る確率。舟券に絡む力を示す。</p>
          </div>
          <div className="guide-item">
            <strong>当地勝率</strong>
            <p>このレース場での勝率。得意度を示す。</p>
          </div>
          <div className="guide-item">
            <strong>モーター2率</strong>
            <p>モーターの2連率。40%以上なら好機。</p>
          </div>
          <div className="guide-item">
            <strong>平均ST</strong>
            <p>平均スタートタイミング。小さいほどスタートが速い。</p>
          </div>
          <div className="guide-item">
            <strong>🔥マーク</strong>
            <p>特に優れた数値（平均より大きく上回る）。</p>
          </div>
          {showExhibition && (
            <div className="guide-item">
              <strong>展示タイム</strong>
              <p>直線の走行タイム。数字が小さいほど機力が良い。</p>
            </div>
          )}
          {showExhibition && (
            <div className="guide-item">
              <strong>展示ST</strong>
              <p>スタートタイミング。小さいほどスタート力が高い。</p>
            </div>
          )}
          <div className="guide-item">
            <strong>総合力</strong>
            <p>ST優位性とモーター性能から算出した総合的な強さ指標。</p>
          </div>
          <div className="guide-item">
            <strong>コース勝率</strong>
            <p>そのコースでの過去の勝利数と出走数。</p>
          </div>
        </div>
      </details>
    </div>
  );
}

export default PredictionTable;
