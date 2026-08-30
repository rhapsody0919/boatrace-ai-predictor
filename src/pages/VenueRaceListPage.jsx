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
import { useNowHHMM } from "../hooks/useNowHHMM";
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
  // parseIntは"5abc"のような末尾に余分な文字があるパラメータも5として通してしまうため、
  // 全体が数字のみであることを正規表現で先に検証する
  const venueCode = /^\d+$/.test(venueCodeParam || "")
    ? parseInt(venueCodeParam, 10)
    : NaN;

  const { races: allRaces, loading, error } = useDatePredictions(date);
  // Hooksはearly returnより前で無条件に呼ぶ必要があるため、venueCode不正時のNavigateより前に置く
  const nowHHMM = useNowHHMM(isToday);

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

  // /races/:date/:venueCode（過去日付）はja専用パス（TRANSLATED_PATHS未登録）のため、
  // 「本日」を前提にしたi18nの見出しをそのまま使い回さず日付入りの日本語文言にする
  // （VenueGridPageのPastVenueGridPageと同じ方針。BOA-XXX的発見: 過去日付ページでも
  // 「本日のレース一覧」というタイトルになっていた実装漏れの修正）
  const metaTitle = isToday
    ? t("venueRaceList.metaTitle", { venue: venueName })
    : `${venueName} ${formatDate(date)}のレース一覧・AIデータ分析 - 龍神レーダー`;
  const metaDescription = isToday
    ? t("venueRaceList.metaDescription", { venue: venueName })
    : `${venueName}ボートレース場の${formatDate(date)}の全レース一覧。各レースのAIデータ分析・結果を確認できます。`;
  const noRacesMessage = isToday
    ? t("home.noRacesToday")
    : "このレース場のデータはありません";

  return (
    <>
      <title>{metaTitle}</title>
      <meta name="description" content={metaDescription} />
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
              <p>{noRacesMessage}</p>
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
                    nowHHMM={nowHHMM}
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
