import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getOutcomeDistribution,
  getWinningTechniqueStats,
} from "../../services/venueQueries.js";

// prediction から topPick を取得し、1着コースを抽出
export function useFirstBoat(prediction, selectedModel) {
  const [firstBoat, setFirstBoat] = useState(null);

  useEffect(() => {
    if (!prediction) {
      // 元の部品の挙動（初回描画は null、effect で確定）を保つため同期 setState のまま
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFirstBoat(null);
      return;
    }

    // prediction.topPick は選手オブジェクト { number: 1-6, name, ... } の形式
    const topPick = prediction.topPick;

    if (!topPick) {
      setFirstBoat(null);
      return;
    }

    // topPick.number から艇番を取得
    if (topPick.number) {
      setFirstBoat(topPick.number);
    } else {
      setFirstBoat(null);
    }
  }, [prediction, selectedModel]);

  return firstBoat;
}

// expanded が true になったとき、データを取得
export function useOutcomeData(expanded, venueCode, firstBoat) {
  const { t } = useTranslation();
  const [outcomeData, setOutcomeData] = useState(null);
  const [boatTotalRaces, setBoatTotalRaces] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!expanded || !venueCode || firstBoat === null) {
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        // outcome_distributionのprobability列は「会場の総レース数」を分母にした
        // 出現率のため、この艇が1着だった場合の確率としては過小評価になる
        // （例: 1号艇の勝率55%の会場では実際の約半分の数値になる）。
        // winning_technique_stats.total_races（=この枠番が1着だった回数、
        // 決まり手行の分母と同一）を分母に取り直して再計算する
        const [data, techniqueStats] = await Promise.all([
          getOutcomeDistribution(venueCode),
          getWinningTechniqueStats(venueCode),
        ]);
        setOutcomeData(data);
        setBoatTotalRaces(
          techniqueStats?.data?.[firstBoat]?.total_races ?? null,
        );
      } catch (err) {
        setError(err.message || t("outcomePreview.fetchError"));
        console.error("Failed to load outcome data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [expanded, venueCode, firstBoat, t]);

  return { outcomeData, boatTotalRaces, loading, error };
}
