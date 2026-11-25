/**
 * VenueCharacteristicsDetails - 会場特徴カードの「もっと詳しく」（BOA-269）
 * 過去90日・枠番別の2連率・3連率の表と、枠番ごとの勝ったときの決まり手の全内訳を、
 * 初期は閉じた折りたたみで出す。出目分布（outcome_distribution）と決まり手（winning_technique_stats）を自分で取る。
 * 1着率の列は BOA-1189 で外した（カードの上は直近1年・進入コース別の1着率。同じ画面に期間の違う同じ指標を並べない）。
 * 出目のランキングは分析ツールの出目タブにあるため、ここにはリンクだけを置く
 * （2026-10-02 ユーザー承認）。
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import InlineFetchError from "../InlineFetchError";
import { placeRatesByBoat } from "../../utils/venuePlaceRates";
import { useVenueDetailsData } from "./VenueCharacteristicsDetailsData";
import {
  buildOutcomeLink,
  hasEnoughRaces,
} from "./VenueCharacteristicsDetailsLogic";
import PlaceRatesSection from "./VenueCharacteristicsDetailsPlaceRates";
import TechniqueSection from "./VenueCharacteristicsDetailsTechniques";
import "./VenueCharacteristicsDetails.css";

export default function VenueCharacteristicsDetails({ venueCode }) {
  const { t, i18n } = useTranslation();
  const { loaded, failedVenue, retry } = useVenueDetailsData(venueCode);

  if (failedVenue === venueCode) {
    return (
      <InlineFetchError
        message={t("venueCharacteristics.fetchError")}
        onRetry={retry}
      />
    );
  }
  if (loaded.venueCode !== venueCode) return null;
  const { outcomeData, techniqueData } = loaded.data;
  if (!hasEnoughRaces(outcomeData)) return null;
  const rates = placeRatesByBoat(outcomeData);
  if (!rates) return null;
  const outcomeLink = buildOutcomeLink(venueCode, i18n.resolvedLanguage);

  return (
    <details className="venue-details" data-testid="venue-details">
      <summary className="venue-details__summary">
        {t("venueCharacteristics.details.summary")}
      </summary>
      <div className="venue-details__body">
        {/* 上の直近1年（進入コース別）と窓・数え方が違うことを先に書く（オーナー 2026-11-25） */}
        <p className="venue-details__lead">
          {t("venueCharacteristics.details.windowNote")}
        </p>
        <PlaceRatesSection t={t} outcomeData={outcomeData} rates={rates} />

        <TechniqueSection t={t} techniqueData={techniqueData} />

        <p className="venue-details__link">
          <Link to={outcomeLink}>
            {t("venueCharacteristics.details.outcomeLink")}
          </Link>
        </p>
      </div>
    </details>
  );
}
