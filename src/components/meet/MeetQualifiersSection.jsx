import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { BOAT_COLORS } from "../../utils/colors";
import "./MeetQualifiersSection.css";

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 勝ち上がり（準優勝戦・優勝戦の番組と着順、BOA-682 spec FR-1.5）。
 * 番組が出るまでは案内を出す。各レースはレース詳細へリンクする。
 *
 * @param {{qualifiers: {semifinals: Array, finals: Array}}} props `buildQualifiers` の値
 */
function MeetQualifiersSection({ qualifiers }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const { semifinals = [], finals = [] } = qualifiers ?? {};

  const renderRace = (race, labelKey) => (
    <Link
      key={race.raceId}
      to={localize(`/race/${race.raceId}`)}
      className="meet-qualifiers__race"
    >
      <span className="meet-qualifiers__race-head">
        <span>{t(labelKey, { n: race.raceNumber })}</span>
        <span className="meet-qualifiers__to-race">{t("meetPage.toRace")}</span>
      </span>
      <span className="meet-qualifiers__boats">
        {race.boats.map((b) => {
          const c = BOAT_COLORS[b.boatNumber] ?? {};
          return (
            <span key={b.boatNumber} className="meet-qualifiers__boat">
              <span
                className="meet-qualifiers__boat-no"
                style={{ backgroundColor: c.bg, color: c.text }}
              >
                {b.boatNumber}
              </span>
              <span translate="no">{b.playerName}</span>
              {b.finish != null && (
                <span className="meet-qualifiers__finish">
                  {t("meetPage.finishPlace", { place: b.finish })}
                </span>
              )}
            </span>
          );
        })}
      </span>
      {!race.hasResult && (
        <span className="meet-qualifiers__note">
          {t("meetPage.resultPending")}
        </span>
      )}
    </Link>
  );

  return (
    <section
      className="meet-qualifiers"
      aria-labelledby="meet-qualifiers-title"
    >
      <h2 id="meet-qualifiers-title">{t("meetPage.qualifiersTitle")}</h2>
      {semifinals.length > 0 ? (
        <>
          <h3>{t("meetPage.semifinals", { date: md(semifinals[0].date) })}</h3>
          {semifinals.map((r) => renderRace(r, "meetPage.raceSemi"))}
        </>
      ) : (
        <p className="meet-qualifiers__pending">
          {t("meetPage.semifinalsPending")}
        </p>
      )}
      {finals.length > 0 ? (
        <>
          <h3>{t("meetPage.finals", { date: md(finals[0].date) })}</h3>
          {finals.map((r) => renderRace(r, "meetPage.raceFinal"))}
        </>
      ) : (
        semifinals.length > 0 && (
          <p className="meet-qualifiers__pending">
            {t("meetPage.finalsPending")}
          </p>
        )
      )}
    </section>
  );
}

export default MeetQualifiersSection;
