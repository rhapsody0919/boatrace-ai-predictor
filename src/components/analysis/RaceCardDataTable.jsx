/**
 * RaceCardDataTable - 出走表データ分析タブ（BOA-168）
 * レースAI予想内にあったAIデータ予想テーブル（PredictionTable）の
 * データ項目をデータ分析ツールへ外出ししたもの。
 * AI由来の項目（総合力スコア・AI予想順ソート）は含めず、枠番順の純粋な
 * 出走表データ（race_entries + racerStats + 展示データ）を表示する。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./MotorConditionChart.css";
import "./RaceCardDataTable.css";

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

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

// 列ごとにレース内順位を計算し、上位3位までのクラス名を返す。
// 全艇同値の列（例: モーター交換直後で全艇2連率0%）は順位の意味が無いため色付けしない
function rankClass(rows, accessor, value, dir = "max") {
  if (value === null) return "";
  const values = rows
    .map((r) => accessor(r))
    .filter((v) => v !== null && v !== undefined);
  if (values.length === 0 || Math.min(...values) === Math.max(...values))
    return "";
  const better = values.filter((v) =>
    dir === "min" ? v < value : v > value,
  ).length;
  const rank = better + 1;
  return rank <= 3 ? `rcd-rank-${rank}` : "";
}

function RaceCardDataTable({ initialVenueCode = null, initialRaceId = null }) {
  const { t } = useTranslation();
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [entries, setEntries] = useState([]);
  const [racerStats, setRacerStats] = useState(null);
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
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [entryRows, stats] = await Promise.all([
          supabaseDataService.getRaceEntriesDetail(selectedRace),
          supabaseDataService.getRaceRacerStats(selectedRace),
        ]);
        setEntries(entryRows ?? []);
        setRacerStats(stats);
      } catch (err) {
        setError(err.message || "出走表データの取得に失敗しました");
        console.error("Failed to load race card data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedRace]);

  const statsByBoat = new Map((racerStats ?? []).map((s) => [s.boatNumber, s]));

  const fmt = (value, digits = 2, suffix = "") => {
    const n = toNumber(value);
    return n !== null ? `${n.toFixed(digits)}${suffix}` : "—";
  };

  return (
    <div className="motor-condition-container">
      <h2>📋 出走表データ</h2>
      <p className="section-description">
        本日開催中のレースを選ぶと、出走する6選手の勝率・モーター・平均ST・展示・コース勝率などの出走表データを枠番順に一覧できます。数値の色はレース内の上位3位を示します。
      </p>

      {venues.length === 0 && !loading ? (
        <div className="empty-state">本日開催しているレースがありません</div>
      ) : (
        <div className="controls-section">
          <label htmlFor="race-card-venue-select">
            ボートレース場（本日開催中）:
          </label>
          <select
            id="race-card-venue-select"
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
              <label htmlFor="race-card-race-select">レース:</label>
              <select
                id="race-card-race-select"
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

      {!loading && !error && entries.length > 0 && (
        <div className="rcd-table-wrapper">
          <table className="rcd-table">
            <thead>
              <tr>
                <th>{t("table.boatNumber")}</th>
                <th>{t("table.playerName")}</th>
                <th>{t("table.class")}</th>
                <th>{t("table.age")}</th>
                <th>{t("table.nationalWinRate")}</th>
                <th>{t("table.nationalTop2Rate")}</th>
                <th>{t("table.localWinRate")}</th>
                <th>{t("table.motorTop2Rate")}</th>
                <th>{t("table.avgST")}</th>
                <th>{t("table.exhibitionTime")}</th>
                <th>{t("table.exhibitionST")}</th>
                <th>{t("table.courseWinRate")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const stats = statsByBoat.get(row.boat_number);
                const course = stats?.course ?? row.boat_number;
                const counts = stats?.courseRaceCounts?.[String(course)];
                return (
                  <tr key={row.boat_number}>
                    <td className="rcd-boat">{row.boat_number}</td>
                    <td className="rcd-name">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td>{row.grade ?? "—"}</td>
                    <td>{row.age ?? "—"}</td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(r.win_rate),
                        toNumber(row.win_rate),
                      )}
                    >
                      {fmt(row.win_rate)}
                    </td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(r.global_2rate),
                        toNumber(row.global_2rate),
                      )}
                    >
                      {fmt(row.global_2rate, 1, "%")}
                    </td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(r.local_win_rate),
                        toNumber(row.local_win_rate),
                      )}
                    >
                      {fmt(row.local_win_rate)}
                    </td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(r.motor_2rate),
                        toNumber(row.motor_2rate),
                      )}
                    >
                      {fmt(row.motor_2rate, 1, "%")}
                    </td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(statsByBoat.get(r.boat_number)?.avgST),
                        toNumber(stats?.avgST),
                        "min",
                      )}
                    >
                      {fmt(stats?.avgST)}
                    </td>
                    <td
                      className={rankClass(
                        entries,
                        (r) => toNumber(r.exhibition_time),
                        toNumber(row.exhibition_time),
                        "min",
                      )}
                    >
                      {fmt(row.exhibition_time)}
                    </td>
                    <td>{fmt(row.exhibition_st)}</td>
                    <td>
                      {counts && counts.total > 0
                        ? `${counts.wins ?? 0}/${counts.total}（${(((counts.wins ?? 0) / counts.total) * 100).toFixed(0)}%）`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="table-note">
        💡
        コース勝率は進入コースでの1着数/出走数（racerStats集計）。展示タイム・展示STは当日の展示航走が行われた後に表示されます。
      </p>
    </div>
  );
}

export default RaceCardDataTable;
