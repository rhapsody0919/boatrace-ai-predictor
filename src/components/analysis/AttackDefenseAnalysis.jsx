/**
 * AttackDefenseAnalysis - 超展開データ分析タブ（BOA-168）
 * レースAI予想内にあった超展開データ（AttackDefenseTable）を
 * データ分析ツールへ外出ししたもの。本日開催中の会場・レースを選ぶと、
 * 出走6選手のコース別の攻め手/守り手データを表示する。
 * テーブル本体は既存のAttackDefenseTableをそのまま再利用する。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import AttackDefenseTable from "../race/AttackDefenseTable";
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

function AttackDefenseAnalysis({
  initialVenueCode = null,
  initialRaceId = null,
}) {
  const { t } = useTranslation();
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [racerStats, setRacerStats] = useState(null);
  const [players, setPlayers] = useState([]);
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
        const [stats, entries] = await Promise.all([
          supabaseDataService.getRaceRacerStats(selectedRace),
          supabaseDataService.getRaceEntriesDetail(selectedRace),
        ]);
        setRacerStats(stats);
        setPlayers(
          (entries ?? []).map((e) => ({
            number: e.boat_number,
            name: e.player_name,
          })),
        );
      } catch (err) {
        setError(err.message || "超展開データの取得に失敗しました");
        console.error("Failed to load attack/defense data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedRace]);

  return (
    <div className="motor-condition-container">
      <h2>⚔️ 超展開データ</h2>
      <p className="section-description">
        本日開催中のレースを選ぶと、出走する6選手それぞれの進入コースでの「攻め手」（差し・まくり等でどう攻めるか）と、1コースの「守り手」（どう攻められて敗れるか）の実績分布がわかります。
      </p>

      {venues.length === 0 && !loading ? (
        <div className="empty-state">{t("analysis.noRacesToday")}</div>
      ) : (
        <div className="controls-section">
          <label htmlFor="attack-defense-venue-select">
            {t("analysis.venueSelectTodayLabel")}
          </label>
          <select
            id="attack-defense-venue-select"
            value={selectedVenue ?? ""}
            onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
            className="venue-select"
          >
            {venues.map((v) => (
              <option key={v} value={v}>
                {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
              </option>
            ))}
          </select>

          {races.length > 0 && (
            <>
              <label htmlFor="attack-defense-race-select">{t("analysis.raceSelectLabel")}</label>
              <select
                id="attack-defense-race-select"
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

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && <div className="error-state">{t("analysis.error", { message: error })}</div>}

      {!loading && !error && racerStats && racerStats.length >= 6 && (
        <AttackDefenseTable racerStats={racerStats} players={players} />
      )}

      {!loading && !error && (!racerStats || racerStats.length < 6) && (
        <div className="empty-state">
          このレースの超展開データがまだ生成されていません
        </div>
      )}
    </div>
  );
}

export default AttackDefenseAnalysis;
