/**
 * RacerBoatReturnRateChart - 選手×艇番別 回収率分析（BOA-167）
 * 本日開催中の会場・レースを選ぶと、出走6選手それぞれについて
 * 過去180日間・同じ艇番で出走したレースでの単勝回収率・複勝回収率を表示する。
 * AI予想モデルの確率は使わず、過去の実績払戻金のみを集計する。
 */
import { useState, useEffect, useRef } from "react";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./MotorConditionChart.css";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function RacerBoatReturnRateChart({
  initialVenueCode = null,
  initialRaceId = null,
}) {
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const pendingInitialRaceId = useRef(initialRaceId);

  useEffect(() => {
    const loadVenues = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await supabaseDataService.getVenuesWithTodaysRaces();
        setVenues(list);
        const preferred =
          initialVenueCode !== null && list.includes(initialVenueCode)
            ? initialVenueCode
            : (list[0] ?? null);
        setSelectedVenue(preferred);
      } catch (err) {
        setError(err.message || "会場一覧の取得に失敗しました");
        console.error("Failed to load venues with today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedVenue === null) {
      setRaces([]);
      return;
    }
    const loadRaces = async () => {
      try {
        setLoading(true);
        setError(null);
        const list =
          await supabaseDataService.getTodaysRacesForVenue(selectedVenue);
        setRaces(list);

        const pending = pendingInitialRaceId.current;
        const pendingExists =
          pending !== null && list.some((r) => r.race_id === pending);
        setSelectedRace(pendingExists ? pending : (list[0]?.race_id ?? null));
        pendingInitialRaceId.current = null;
      } catch (err) {
        setError(err.message || "レース一覧の取得に失敗しました");
        console.error("Failed to load today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRaces();
  }, [selectedVenue]);

  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await supabaseDataService.getRaceRacerBoatReturnRate(selectedRace);
        setBreakdown(data);
      } catch (err) {
        setError(err.message || "回収率の取得に失敗しました");
        console.error("Failed to load race racer boat return rate:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  const bestWinReturnRate =
    breakdown.length > 0
      ? Math.max(
          ...breakdown
            .filter((r) => r.win_return_rate !== null)
            .map((r) => r.win_return_rate),
        )
      : null;

  return (
    <div className="motor-condition-container">
      <h2>💰 選手×艇番別 回収率分析</h2>
      <p className="section-description">
        本日開催中のレースを選ぶと、出走する6選手それぞれについて、過去180日間・同じ艇番で出走したレースでの単勝回収率・複勝回収率がわかります。勝率だけでなく、実際に買って儲かるかという視点での判断材料です。
      </p>

      {venues.length === 0 && !loading ? (
        <div className="empty-state">本日開催しているレースがありません</div>
      ) : (
        <div className="controls-section">
          <label htmlFor="return-rate-venue-select">
            ボートレース場（本日開催中）:
          </label>
          <select
            id="return-rate-venue-select"
            value={selectedVenue ?? ""}
            onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
            className="venue-select"
          >
            {venues.map((v) => (
              <option key={v} value={v}>
                {VENUE_NAMES[v] || v}
              </option>
            ))}
          </select>

          {races.length > 0 && (
            <>
              <label htmlFor="return-rate-race-select">レース:</label>
              <select
                id="return-rate-race-select"
                value={selectedRace ?? ""}
                onChange={(e) => setSelectedRace(e.target.value)}
                className="venue-select"
              >
                {races.map((r) => (
                  <option key={r.race_id} value={r.race_id}>
                    {r.race_number}R（{r.start_time?.slice(0, 5)}〜）
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {loading && <div className="loading-state">データを読み込み中...</div>}
      {error && <div className="error-state">エラー: {error}</div>}

      {!loading && !error && breakdown.length > 0 && (
        <div className="table-wrapper">
          <table className="motor-ranking-table">
            <thead>
              <tr>
                <th>枠番</th>
                <th>選手名</th>
                <th>サンプル数（180日）</th>
                <th>単勝回収率</th>
                <th>複勝回収率</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr
                  key={row.boat_number}
                  className={`motor-ranking-row non-clickable-row ${
                    row.win_return_rate === bestWinReturnRate &&
                    bestWinReturnRate > 0
                      ? "best-motor"
                      : ""
                  }`}
                >
                  <td className="rank">{row.boat_number}</td>
                  <td translate="no">{row.player_name?.replace(/\s+/g, "")}</td>
                  <td className="rate">{row.sample_count}</td>
                  <td className="rate">
                    {row.win_return_rate !== null
                      ? `${row.win_return_rate.toFixed(0)}%`
                      : "データなし"}
                  </td>
                  <td className="rate">
                    {row.place_return_rate !== null
                      ? `${row.place_return_rate.toFixed(0)}%`
                      : "データなし"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="table-note">
        💡
        回収率は過去180日間・同じ艇番から出走した全レースを対象に、単勝/複勝を100円ずつ購入し続けた場合の払戻金合計の割合です。サンプル数が少ない選手は信頼度が低くなる点にご注意ください。
      </p>
    </div>
  );
}

export default RacerBoatReturnRateChart;
