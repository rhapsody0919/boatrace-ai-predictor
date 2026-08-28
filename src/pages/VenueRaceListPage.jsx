/**
 * VenueRaceListPage - 会場別レース一覧ページ
 * 本日（`/venue/:venueCode`）と過去日付（`/races/:date/:venueCode`）の両方で使う。
 * 1R〜12Rを一覧表示し、各レースカードからレース詳細（/race/:raceId）へ遷移する。
 */
import { useParams, Link, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import { RaceCard } from "../components/race";
import { useDatePredictions } from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { getTodayJST } from "../utils/dateUtils";
import { formatDate } from "../utils/formatters";
import "./VenueRaceListPage.css";

function VenueRaceListPage() {
  const { date: dateParam, venueCode: venueCodeParam } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const localize = useLocalizedPath();

  const isToday = !dateParam;
  const date = dateParam || getTodayJST();
  const venueCode = parseInt(venueCodeParam, 10);

  const { races: allRaces, loading, error } = useDatePredictions(date);

  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    return <Navigate to={isToday ? "/" : `/races/${date}`} replace />;
  }

  const venueName = t(`venues.${venueCode}`);
  const venueRaces = allRaces
    .filter((r) => r.venueCode === venueCode)
    .sort((a, b) => a.raceNumber - b.raceNumber)
    .map((race) => ({
      id: race.raceId,
      venue: venueName,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime,
      rawData: race,
    }));

  const backLink = isToday ? localize("/") : `/races/${date}`;
  const breadcrumbItems = isToday
    ? [
        { name: t("analysisPage.breadcrumbHome"), url: localize("/") },
        { name: venueName, url: localize(`/venue/${venueCode}`) },
      ]
    : [
        { name: t("analysisPage.breadcrumbHome"), url: "/" },
        { name: "過去の予想", url: "/races" },
        { name: formatDate(date), url: `/races/${date}` },
        { name: venueName, url: `/races/${date}/${venueCode}` },
      ];

  const canonicalPath = isToday
    ? `/venue/${venueCode}`
    : `/races/${date}/${venueCode}`;

  return (
    <>
      <title>{t("venueRaceList.metaTitle", { venue: venueName })}</title>
      <meta
        name="description"
        content={t("venueRaceList.metaDescription", { venue: venueName })}
      />
      <link rel="canonical" href={`https://www.boat-ai.jp${canonicalPath}`} />
      <Header />

      <div className="venue-race-list-page">
        <Breadcrumb items={breadcrumbItems} />

        <div className="venue-race-list-container">
          <header className="page-header">
            <h1>
              🏁 {venueName} {t("venueRaceList.title")}
              {!isToday && ` (${formatDate(date)})`}
            </h1>
            <Link to={backLink} className="back-link">
              {t("venueRaceList.backToVenues")}
            </Link>
          </header>

          {loading ? (
            <LoadingScreen
              title={t("home.loadingTitle")}
              description={t("home.loadingDesc")}
            />
          ) : error || venueRaces.length === 0 ? (
            <div className="venue-race-list-page__empty">
              <p>{t("home.noRacesToday")}</p>
              <Link to={backLink} className="back-link">
                {t("venueRaceList.backToVenues")}
              </Link>
            </div>
          ) : (
            <section className="race-list-section">
              <div className="race-grid">
                {venueRaces.map((race) => (
                  <RaceCard
                    key={race.id}
                    race={race}
                    onAnalyzeRace={(r) => navigate(localize(`/race/${r.id}`))}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default VenueRaceListPage;
