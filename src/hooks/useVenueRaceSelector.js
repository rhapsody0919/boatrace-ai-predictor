import { useState, useEffect, useRef } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

/**
 * 「本日開催中の会場→本日のレース」選択の共通ロジック（BOA-280）
 * MotorConditionChart/ExhibitionTimeTrendChart/RacerFormChart/StPredictabilityChart
 * で完全に同一のコピペだった部分を切り出したもの。
 * embedded時（レース詳細への埋め込み）は過去日・確定済みレースも対象になり得るため、
 * 「本日開催」一覧に無い場合のフォールバック選択を行わず、渡された
 * initialVenueCode/initialRaceIdをそのまま使う。
 *
 * embedded=false（/winning-technique経由）でも、initialVenueCode/initialRaceIdが
 * 明示的に渡された場合は同様に「本日開催」一覧の有無を問わず信頼する（BOA-265、
 * 選手ページ「今節のモーター状況カード」・データ出走表「機力↑/↓」バッジのように、
 * 過去レース・当日終了済みレースへの具体的なディープリンクが実際に存在するため）。
 * 会場・レースの選択肢（venues/races）自体は引き続き「本日開催」一覧から表示する
 * （純粋な素通り訪問時のブラウズ用）。ディープリンク先の会場・レースがその
 * 一覧に無い場合、選択肢UIには反映されないがデータ取得自体は正しいIDで行われる
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
        // 明示的なディープリンクは「本日開催」一覧の有無に関わらず信頼する
        const preferred =
          initialVenueCode !== null ? initialVenueCode : (list[0] ?? null);
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
    // StrictMode（開発時）はマウント→クリーンアップ→再マウントで本エフェクトを
    // 2回実行する。pendingInitialRaceIdは一度参照したら消費するrefのため、
    // 使い捨ての1回目でクリアしてしまうと本当の2回目が「既に消費済み」と誤認識し、
    // list[0]に落ちてしまう。cleanup側でスナップショットに戻すことで、
    // 実際に適用できた回（appliedになった回）だけ最終的にクリアされるようにする
    const pendingSnapshot = pendingInitialRaceId.current;
    let cancelled = false;
    let applied = false;
    const loadRaces = async () => {
      try {
        setLoading(true);
        setError(null);
        const list =
          await supabaseDataService.getTodaysRacesForVenue(selectedVenue);
        if (cancelled) return;
        setRaces(list);

        // 明示的なディープリンクは「本日開催」一覧に無くても信頼する
        // （過去レース・当日終了済みレースへの具体的なリンクが実在するため）
        setSelectedRace(
          pendingSnapshot !== null
            ? pendingSnapshot
            : (list[0]?.race_id ?? null),
        );
        pendingInitialRaceId.current = null;
        applied = true;
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load today's races:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadRaces();
    return () => {
      cancelled = true;
      if (!applied) pendingInitialRaceId.current = pendingSnapshot;
    };
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
