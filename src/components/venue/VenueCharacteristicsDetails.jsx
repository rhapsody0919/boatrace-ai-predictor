/**
 * VenueCharacteristicsDetails - 会場特徴カードの「もっと詳しく」（BOA-269）
 * 枠番別の1着率・2連率・3連率の表と、枠番ごとの勝ったときの決まり手の全内訳を、
 * 初期は閉じた折りたたみで出す。カードが既に取得した2つのデータだけを使う。
 * 出目のランキングは分析ツールの出目タブにあるため、ここにはリンクだけを置く
 * （2026-10-02 ユーザー承認）。
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translateTechnique } from "../race/raceIndicators";
import { SMALL_SAMPLE_THRESHOLD } from "../race/basicInfoStats";
import { BOAT_COLORS } from "../../utils/colors";
import { localizePath } from "../../config/languages";
import {
  placeRatesByBoat,
  techniqueBreakdown,
} from "../../utils/venuePlaceRates";
import "./VenueCharacteristicsDetails.css";

const TECHNIQUE_SLUG = {
  逃げ: "nige",
  差し: "sashi",
  まくり: "makuri",
  まくり差し: "makurizashi",
  抜き: "nuki",
  恵まれ: "megumare",
};

function Lane({ boat }) {
  const color = BOAT_COLORS[boat] ?? {};
  return (
    <span
      className="venue-details-lane"
      style={{ background: color.bg, color: color.text }}
    >
      {boat}
    </span>
  );
}

export default function VenueCharacteristicsDetails({
  venueCode,
  outcomeData,
  techniqueData,
}) {
  const { t, i18n } = useTranslation();
  const rates = placeRatesByBoat(outcomeData);
  if (!rates) return null;
  const pct = (v) => `${v.toFixed(1)}%`;
  const outcomeLink = localizePath(
    `/winning-technique?venue_code=${venueCode}&tab=outcome`,
    i18n.resolvedLanguage,
  );

  return (
    <details className="venue-details" data-testid="venue-details">
      <summary className="venue-details__summary">
        {t("venueCharacteristics.details.summary")}
      </summary>
      <div className="venue-details__body">
        <section>
          <h3>{t("venueCharacteristics.details.placeRatesTitle")}</h3>
          <p className="venue-details__sub">
            {t("venueCharacteristics.details.placeRatesNote", {
              count: outcomeData.total_races,
            })}
          </p>
          <table className="venue-details__table">
            <thead>
              <tr>
                <th scope="col">{t("venueCharacteristics.details.boat")}</th>
                <th scope="col">{t("venueCharacteristics.details.winRate")}</th>
                <th scope="col">
                  {t("venueCharacteristics.details.top2Rate")}
                </th>
                <th scope="col">
                  {t("venueCharacteristics.details.top3Rate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.boat}>
                  <td>
                    <Lane boat={r.boat} />
                  </td>
                  <td>{pct(r.winRate)}</td>
                  <td>{pct(r.top2Rate)}</td>
                  <td>{pct(r.top3Rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3>{t("venueCharacteristics.details.techniqueTitle")}</h3>
          <p className="venue-details__sub">
            {t("venueCharacteristics.details.techniqueNote")}
          </p>
          <ul className="venue-details__legend" aria-hidden="true">
            {Object.entries(TECHNIQUE_SLUG).map(([name, slug]) => (
              <li key={slug}>
                <i className={`venue-details__swatch is-${slug}`} />
                {translateTechnique(t, name)}
              </li>
            ))}
          </ul>
          <div className="venue-details__techniques">
            {[1, 2, 3, 4, 5, 6].map((boat) => {
              const { total, items } = techniqueBreakdown(
                techniqueData?.data?.[boat],
              );
              if (total === 0) return null;
              const label = items
                .map(
                  (x) =>
                    `${translateTechnique(t, x.technique)} ${x.share.toFixed(0)}%(${x.count})`,
                )
                .join(t("listSeparator"));
              const isSmall = total < SMALL_SAMPLE_THRESHOLD;
              return (
                <div
                  className="venue-details__technique-row"
                  key={boat}
                  data-testid={`venue-details-technique-${boat}`}
                >
                  <Lane boat={boat} />
                  <span
                    className="venue-details__stack"
                    role="img"
                    aria-label={label}
                  >
                    {items.map((x) => (
                      <span
                        key={x.technique}
                        className={`venue-details__swatch is-${TECHNIQUE_SLUG[x.technique] ?? "other"}`}
                        style={{ width: `${x.share}%` }}
                      />
                    ))}
                  </span>
                  <span
                    className={`venue-details__count${isSmall ? " is-small-sample" : ""}`}
                  >
                    {t("venueCharacteristics.details.winCount", {
                      count: total,
                    })}
                  </span>
                  <span className="venue-details__breakdown">{label}</span>
                </div>
              );
            })}
          </div>
          <p className="venue-details__sub">
            {t("venueCharacteristics.details.smallSampleNote")}
          </p>
        </section>

        <p className="venue-details__link">
          <Link to={outcomeLink}>
            {t("venueCharacteristics.details.outcomeLink")}
          </Link>
        </p>
      </div>
    </details>
  );
}
