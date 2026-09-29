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

// ユーザーが自分でスクロールし始めたことを示すイベント（着地点の合わせ直しをやめる）
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

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
  // （最初に開いたページ・リロードは "default"）。リロードは、一覧を後から読み込むためブラウザが元の位置を
  // 復元できず最上部に戻るので、開いたときと同じく次のレースへ移す（ファン評価2周目）
  const navigationType = useNavigationType();
  const location = useLocation();
  const cameFromHistory =
    navigationType === "POP" && location.key !== "default";
  const gridRef = useRef(null);
  const markerRef = useRef(null);
  const scrolledRef = useRef(false);
  // 次のレースの目印（次のレースのカードの直上）まで1回だけスクロールする（BOA-546）。直上の会場カードは
  // 自分でデータを読み込むため、読み込みで高さが変わると目印が画面の下へ押し出される（ファン評価2周目）。
  // 着いてから5秒間は、ユーザーが操作するまで高さの変化に合わせて位置を合わせ直す
  useEffect(() => {
    if (scrolledRef.current || cameFromHistory) return undefined;
    const marker = markerRef.current;
    if (!marker) return undefined;
    scrolledRef.current = true;
    // 自分で合わせた位置。これと違う位置へのスクロールは、ユーザーの操作（スクロールバーのドラッグ等も含む）
    // とみなして合わせ直しをやめる
    // 高さが変わった直後のずれは、ブラウザのスクロール位置の自動調整（scroll anchoring）によるものなので、
    // ユーザーの操作とみなさず合わせ直す
    let expectedY = 0;
    let lastResizeAt = 0;
    const realign = () => {
      scrollBelowHeader(marker);
      expectedY = window.scrollY;
    };
    realign();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      lastResizeAt = Date.now();
      realign();
    });
    observer.observe(marker.parentElement);
    const onScroll = () => {
      if (Math.abs(window.scrollY - expectedY) <= 2) return;
      if (Date.now() - lastResizeAt < 300) realign();
      else stop();
    };
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      USER_SCROLL_EVENTS.forEach((type) =>
        window.removeEventListener(type, stop),
      );
    };
    const timer = setTimeout(stop, 5000);
    window.addEventListener("scroll", onScroll, { passive: true });
    USER_SCROLL_EVENTS.forEach((type) =>
      window.addEventListener(type, stop, { passive: true }),
    );
    return undefined;
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
  // 目印の「次の締切」は、いまの時刻で決める（位置は固定だが、開いたまま時間がたつと、開いた時点の「次」は
  // 締切を過ぎている。ファン評価2周目 P1）
  const liveNextIndex =
    nowHHMM == null
      ? -1
      : venueRaces.findIndex(
          (race) =>
            getRaceStatus(
              { startTime: race.startTime, result: race.rawData?.result },
              nowHHMM,
            ) === RACE_STATUS.UPCOMING,
        );
  const liveNextRace = liveNextIndex >= 0 ? venueRaces[liveNextIndex] : null;

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
              <div className="race-grid" ref={gridRef}>
                {venueRaces.map((race, index) => [
                  showCardsInGrid && index === cardsBeforeIndex && (
                    <div
                      key="venue-cards"
                      className="venue-race-list__next-race-cards"
                      data-testid="venue-next-race-cards"
                    >
                      {venueCards}
                      {/* 次のレースの目印（自動スクロールの着地点）。会場名と、いまの時刻で決めた次の締切を出し、
                          そのレースのカードへの近道を置く。会場カードは縦に長いため、目印は会場カードの下＝次の
                          レースのカードの直上に置き、着いた1画面目に次のレースが入るようにする（ファン評価2周目） */}
                      <p
                        ref={markerRef}
                        className="venue-race-list__next-race-marker"
                        data-testid="venue-next-race-marker"
                      >
                        <span>
                          {liveNextRace
                            ? t("venueRaceList.nextDeadlineMarker", {
                                venue: venueName,
                                race: liveNextRace.raceNumber,
                                time: liveNextRace.startTime,
                              })
                            : t("venueRaceList.allClosedMarker", {
                                venue: venueName,
                              })}
                        </span>
                        {liveNextRace && (
                          <button
                            type="button"
                            className="venue-race-list__next-race-jump"
                            onClick={() =>
                              scrollBelowHeader(
                                gridRef.current?.querySelectorAll(
                                  ":scope > .race-card",
                                )[liveNextIndex],
                              )
                            }
                          >
                            {t("venueRaceList.jumpToNextRace", {
                              race: liveNextRace.raceNumber,
                            })}
                          </button>
                        )}
                      </p>
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
