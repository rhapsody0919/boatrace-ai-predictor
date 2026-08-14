import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, Link } from "react-router-dom";
import Header from "../components/Header";
import { localizePath, getLanguage } from "../config/languages";
import {
  WinningTechniqueChart,
  MotorConditionChart,
  RacerFormChart,
  OutcomeDistributionTable,
  StPredictabilityChart,
  TopStartChart,
  LosingTechniqueChart,
  NigeOutcomeChart,
  ExhibitionTimeTopChart,
  ExhibitionTimeTrendChart,
  RacerTechniqueProfileChart,
  RacerFormRankingChart,
  RacerBoatReturnRateChart,
  AttackDefenseAnalysis,
  RaceCardDataTable,
  VenueRankingChart,
  VolatilityAccuracyChart,
} from "../components/analysis";
import "./OutcomeDistribution.css";
import "./WinningTechniqueAnalysis.css";

const TAB_KEYS = [
  "outcome",
  "technique",
  "motor",
  "racer",
  "st",
  "topstart",
  "losing",
  "nige",
  "extime",
  "extrend",
  "techprofile",
  "formranking",
  "returnrate",
  "attackdefense",
  "racecard",
  "venueranking",
  "volatility",
];

// 詳しい解説記事（ja専用ブログのため、非ja言語では該当info-cardごと非表示にする）
const BLOG_LINKS = {
  technique: "/blog/winning-technique-analysis-guide",
  motor: "/blog/motor-condition-guide",
  racer: "/blog/racer-form-guide",
  st: "/blog/st-timing-gap-guide",
  topstart: "/blog/top-start-guide",
  losing: "/blog/losing-technique-guide",
  nige: "/blog/nige-outcome-guide",
  extime: "/blog/exhibition-time-top-guide",
  extrend: "/blog/exhibition-time-trend-guide",
  techprofile: "/blog/racer-technique-profile-guide",
  formranking: "/blog/racer-form-ranking-guide",
  returnrate: "/blog/racer-boat-return-rate-guide",
};

const SITE_URL = "https://www.boat-ai.jp";
const PAGE_PATH = "/winning-technique";

function WinningTechniqueAnalysis() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const venueCodeParam = params.get("venue_code");
  const initialVenueCode = venueCodeParam ? parseInt(venueCodeParam, 10) : null;
  const initialRaceId = params.get("race_id");
  const initialTab = params.get("tab");

  const [activeTab, setActiveTab] = useState(
    TAB_KEYS.includes(initialTab) ? initialTab : "technique",
  );

  const canonicalUrl = `${SITE_URL}${localizePath(PAGE_PATH, i18n.resolvedLanguage)}`;
  const homeUrl = `${SITE_URL}${localizePath("/", i18n.resolvedLanguage)}`;

  return (
    <div className="outcome-distribution-page">
      <>
        <title>{t("analysisPage.meta.title")}</title>
        <meta name="description" content={t("analysisPage.meta.description")} />
        <meta
          property="og:locale"
          content={getLanguage(i18n.resolvedLanguage).ogLocale}
        />
        <link rel="canonical" href={canonicalUrl} />

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: t("analysisPage.itemListName"),
            description: t("analysisPage.itemListDescription"),
            itemListElement: TAB_KEYS.map((key, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: t(`analysisPage.features.${key}.name`),
              description: t(`analysisPage.features.${key}.description`),
            })),
          })}
        </script>

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: t("analysisPage.breadcrumbHome"),
                item: homeUrl,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: t("analysisPage.itemListName"),
                item: canonicalUrl,
              },
            ],
          })}
        </script>
      </>

      <Header />

      <main className="content">
        <div className="container">
          <div className="page-header">
            <h1>{t("analysisPage.h1")}</h1>
            <p className="page-subtitle">{t("analysisPage.subtitle")}</p>
          </div>

          <div className="analysis-tabs">
            {TAB_KEYS.map((key) => (
              <button
                key={key}
                className={`analysis-tab-btn ${activeTab === key ? "active" : ""}`}
                onClick={() => setActiveTab(key)}
              >
                {t(`analysisPage.tabs.${key}`)}
              </button>
            ))}
          </div>

          {activeTab === "outcome" && (
            <OutcomeDistributionTable
              initialVenueCode={
                initialVenueCode !== null
                  ? String(initialVenueCode).padStart(2, "0")
                  : null
              }
            />
          )}
          {activeTab === "technique" && (
            <WinningTechniqueChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "motor" && (
            <MotorConditionChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "racer" && (
            <RacerFormChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "st" && (
            <StPredictabilityChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "topstart" && (
            <TopStartChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "losing" && (
            <LosingTechniqueChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "nige" && (
            <NigeOutcomeChart
              initialVenueCode={
                initialVenueCode !== null
                  ? String(initialVenueCode).padStart(2, "0")
                  : null
              }
            />
          )}
          {activeTab === "extime" && (
            <ExhibitionTimeTopChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "extrend" && (
            <ExhibitionTimeTrendChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "techprofile" && (
            <RacerTechniqueProfileChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "formranking" && <RacerFormRankingChart />}
          {activeTab === "returnrate" && (
            <RacerBoatReturnRateChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "attackdefense" && (
            <AttackDefenseAnalysis
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "racecard" && (
            <RaceCardDataTable
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "venueranking" && <VenueRankingChart />}
          {activeTab === "volatility" && <VolatilityAccuracyChart />}

          <section className="info-section">
            {TAB_KEYS.includes(activeTab) &&
              (() => {
                const info = t(`analysisPage.info.${activeTab}`, {
                  returnObjects: true,
                });
                return (
                  <div>
                    <h2>{info.title}</h2>

                    <div className="info-card">
                      <h3>{t("analysisPage.dataViewHeading")}</h3>
                      <p>{info.dataView}</p>
                    </div>

                    <div className="info-card">
                      <h3>{t("analysisPage.tipsHeading")}</h3>
                      <ul>
                        {info.tips.map((tip, idx) => (
                          <li key={idx}>
                            {tip.strong ? (
                              <>
                                <strong>{tip.strong}</strong>
                                {tip.text}
                              </>
                            ) : (
                              tip.text
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {i18n.resolvedLanguage === "ja" &&
                      BLOG_LINKS[activeTab] && (
                        <div className="info-card">
                          <h3>{t("analysisPage.articleHeading")}</h3>
                          <p>
                            <Link to={BLOG_LINKS[activeTab]}>
                              {info.articleLinkText}
                            </Link>
                          </p>
                        </div>
                      )}
                  </div>
                );
              })()}

            <div className="info-card">
              <h3>{t("analysisPage.noticeHeading")}</h3>
              <ul>
                {t("analysisPage.notice.items", { returnObjects: true }).map(
                  (item, idx) => (
                    <li key={idx}>{item}</li>
                  ),
                )}
              </ul>
            </div>
          </section>
        </div>
      </main>

      <footer className="page-footer">
        <p>
          {t("analysisPage.footerText", { year: new Date().getFullYear() })}
        </p>
      </footer>
    </div>
  );
}

export default WinningTechniqueAnalysis;
