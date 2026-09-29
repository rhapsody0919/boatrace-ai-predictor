/**
 * VenueRaceListPage - 会場別レース一覧ページ
 * 本日（`/venue/:venueCode`）と過去日付（`/races/:date/:venueCode`）の両方で使う。
 * 1R〜12Rを一覧表示し、各レースカードからレース詳細（/race/:raceId）へ遷移する。
 */
import { useEffect, useRef, useState } from "react";
import {
  useParams,
  Link,
  useNavigate,
  Navigate,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import { RaceCard } from "../components/race";
import VenueCharacteristicsCard from "../components/venue/VenueCharacteristicsCard";
import VenueDaySummaryCard from "../components/race/VenueDaySummaryCard";
import DataFetchError from "../components/DataFetchError";
import {
  useDatePredictions,
  FETCH_FAILED_ERROR,
} from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { getNowHHMMJST, getTodayJST } from "../utils/dateUtils";
import { getRaceStatus, RACE_STATUS } from "../utils/raceStatus";
import { formatDate } from "../utils/formatters";
import "./VenueRaceListPage.css";

// sticky ヘッダーに隠れない位置へスクロールする（ヘッダーはスクロールすると低くなるため、いまの高さで少し余裕を持たせる）
function scrollBelowHeader(el) {
  if (!el) return;
  const headerHeight =
    document.querySelector(".app-header")?.getBoundingClientRect().height ?? 0;
  window.scrollTo({
    top: el.getBoundingClientRect().top + window.scrollY - headerHeight - 8,
  });
}

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
  // 次の発走レースの位置は、開いた時点の時刻で決めて固定する（読んでいる途中でカードが動いたり
  // 再スクロールしたりしないように。開き直すと新しい位置になる。BOA-546）
  const [openedHHMM] = useState(() => (isToday ? getNowHHMMJST() : null));
  // ブラウザの戻る・進む（履歴の移動）で来たときは自動スクロールしない（ブラウザのスクロール位置の復元を優先）。
  // ページを最初に開いたときも react-router は "POP" になるため、履歴の移動かは location.key で見分ける
  // （最初に開いたページは "default"）
  const navigationType = useNavigationType();
  const location = useLocation();
  const cameFromHistory =
    navigationType === "POP" && location.key !== "default";
  // リロード（これも "POP"）で開いたときも、読んでいた位置へ戻すブラウザの復元を優先する（ファン評価1周目）。
  // リロードは location.key が "default" に戻ることがあり、履歴の移動と見分けられない。そこで、このタブで
  // 一度自動スクロールした会場ページを "POP" で開き直したときはスクロールしない（sessionStorage に記録）
  const autoScrollKey = `venueAutoScrolled:${location.pathname}`;
  const [reopenedInTab] = useState(() => {
    try {
      return (
        navigationType === "POP" &&
        window.sessionStorage.getItem(autoScrollKey) === "1"
      );
    } catch {
      return false;
    }
  });
  const venueCardsRef = useRef(null);
  const scrolledRef = useRef(false);
  // 会場カードを次の発走レースの直前に差し込んだら、そこまで1回だけスクロールする（BOA-546）
  useEffect(() => {
    if (scrolledRef.current || cameFromHistory || reopenedInTab) return;
    const el = venueCardsRef.current;
    if (!el) return;
    scrolledRef.current = true;
    scrollBelowHeader(el);
    try {
      window.sessionStorage.setItem(autoScrollKey, "1");
    } catch {
      // 保存できない環境（プライベートモード等）では、リロード時にもう一度スクロールするだけ
    }
  });

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

  // 会場カード2枚（この会場の特徴・この日の水面傾向）を差し込む位置（BOA-546）。本日ビューで、最初の
  // 発走前（UPCOMING）のレースの直前。締切後・結果待ちのレースはその上に残る（もう舟券を買えないため）。
  // 1Rが発走前（先頭）・発走前のレースが無い（全レース締切後）・過去日付は、従来どおり最上部
  const nextRaceIndex =
    openedHHMM == null
      ? -1
      : venueRaces.findIndex(
          (race) =>
            getRaceStatus(
              { startTime: race.startTime, result: race.rawData?.result },
              openedHHMM,
            ) === RACE_STATUS.UPCOMING,
        );
  const cardsBeforeIndex = nextRaceIndex > 0 ? nextRaceIndex : null;

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

  const venueCards = (
    <>
      <VenueCharacteristicsCard venueCode={venueCode} />

      {/* この日の水面傾向（phase a FR-5 / BOA-222）。直上の
          VenueCharacteristicsCard は過去90日のベースラインで、
          こちらはこの日1日分。カードの注記で日付とレース数を明示する */}
      <VenueDaySummaryCard venueCode={venueCode} date={date} />
    </>
  );
  const showCardsInGrid = !loading && !error && cardsBeforeIndex != null;

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

          {/* 本日ビューでは、レースの並びが決まるまで会場カードを出さない（最上部に出してから次の発走レースの
              直前へ移すと、カードが飛んで見える＝レイアウトシフト） */}
          {!(isToday && loading) && !showCardsInGrid && venueCards}

          {loading ? (
            <LoadingScreen
              title={t("home.loadingTitle")}
              description={t("home.loadingDesc")}
            />
          ) : error === FETCH_FAILED_ERROR ? (
            // 取得失敗（DBタイムアウト等）を「開催なし」と誤表示しない
            <DataFetchError />
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
                {venueRaces.map((race, index) => [
                  showCardsInGrid && index === cardsBeforeIndex && (
                    <div
                      key="venue-cards"
                      ref={venueCardsRef}
                      className="venue-race-list__next-race-cards"
                      data-testid="venue-next-race-cards"
                    >
                      {/* 自動スクロールで着いた位置で、ここがどこか（上は締切済み、下から発走前）と次のレースを示す。
                          会場カードは縦に長く、次のレースが最初の1画面に入らないため、そこへの近道も置く
                          （ファン評価1周目） */}
                      <p
                        className="venue-race-list__next-race-marker"
                        data-testid="venue-next-race-marker"
                      >
                        <span>
                          {t("venueRaceList.nextRaceMarker", {
                            race: race.raceNumber,
                            time: race.startTime,
                          })}
                        </span>
                        {/* 会場カードの直後（グリッドの次の要素）が次のレースのカード */}
                        <button
                          type="button"
                          className="venue-race-list__next-race-jump"
                          onClick={() =>
                            scrollBelowHeader(
                              venueCardsRef.current?.nextElementSibling,
                            )
                          }
                        >
                          {t("venueRaceList.jumpToNextRace", {
                            race: race.raceNumber,
                          })}
                        </button>
                      </p>
                      {venueCards}
                    </div>
                  ),
                  <RaceCard
                    key={race.id}
                    race={race}
                    nowHHMM={nowHHMM}
                    onAnalyzeRace={(r) => navigate(localize(`/race/${r.id}`))}
                  />,
                ])}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default VenueRaceListPage;
