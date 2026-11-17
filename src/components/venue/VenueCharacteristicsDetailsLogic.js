/**
 * VenueCharacteristicsDetails の純な計算（BOA-269）。表示の可否・数値の整形・リンク・決まり手の行を作る
 */
import { translateTechnique } from "../race/raceIndicators";
import { SMALL_SAMPLE_THRESHOLD } from "../race/basicInfoStats";
import { localizePath } from "../../config/languages";
import { techniqueBreakdown } from "../../utils/venuePlaceRates";

export const TECHNIQUE_SLUG = {
  逃げ: "nige",
  差し: "sashi",
  まくり: "makuri",
  まくり差し: "makurizashi",
  抜き: "nuki",
  恵まれ: "megumare",
};

// このレース数を下回る会場は出さない（ノイズが大きいため。以前のカードと同じ）
export const MIN_TOTAL_RACES = 20;

export const BOATS = [1, 2, 3, 4, 5, 6];

export const formatPct = (v) => `${v.toFixed(1)}%`;

export function hasEnoughRaces(outcomeData) {
  return !(!outcomeData || outcomeData.total_races < MIN_TOTAL_RACES);
}

export function buildOutcomeLink(venueCode, language) {
  return localizePath(
    `/winning-technique?venue_code=${venueCode}&tab=outcome`,
    language,
  );
}

export function slugOf(technique) {
  return TECHNIQUE_SLUG[technique] ?? "other";
}

// 枠ごとの決まり手の行。勝ちが 0 の枠は null（出さない）
export function buildTechniqueRow(boat, techniqueData, t) {
  const { total, items } = techniqueBreakdown(techniqueData?.data?.[boat]);
  if (total === 0) return null;
  const itemLabels = items.map(
    (x) =>
      `${translateTechnique(t, x.technique)} ${x.share.toFixed(0)}%(${x.count})`,
  );
  return {
    boat,
    total,
    items,
    itemLabels,
    label: itemLabels.join(t("listSeparator")),
    isSmall: total < SMALL_SAMPLE_THRESHOLD,
  };
}
