import { useState, useEffect, useRef } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

/**
 * 「本日開催中の会場→本日のレース」選択の共通ロジック（BOA-280）
 * MotorConditionChart/ExhibitionTimeTrendChart/RacerFormChart/StPredictabilityChart
 * で完全に同一のコピペだった部分を切り出したもの。
 * embedded時（レース詳細への埋め込み）は過去日・確定済みレースも対象になり得るため、
 * 「本日開催」一覧に無い場合のフォールバック選択を行わず、渡された
 * initialVenueCode/initialRaceIdをそのまま使う。
 */
export function useVenueRaceSelector({
  initialVenueCode = null,
  initialRaceId = null,
  embedded = false,
  t,
}) {
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // RaceDetail等からのディープリンク用: 初回のみ指定のレースを優先する
  const pendingInitialRaceId = useRef(initialRaceId);

  useEffect(() => {
    if (embedded) return;
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
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load venues with today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (embedded) return;
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
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRaces();
  }, [selectedVenue, embedded]);

  return {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  };
}
