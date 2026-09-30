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
import { getVenueSeriesTitle } from "../utils/venueSeriesTitle";
import "./VenueRaceListPage.css";

// 着いた1画面目に見せる次のレースのカードの高さ（見出し・締切・状態が読める程度）
const NEXT_RACE_PEEK_PX = 160;

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
  // ブラウザの戻る・進む・リロード（どれも react-router では "POP"）で開き直したときは、読んでいた位置に戻す
  // （ユーザー判断: リロードで次のレースへ飛ばさない）。一覧を後から読み込むため、ブラウザの位置の復元は効かない。
  // そこで、ページを離れるとき（アプリ内の移動・リロード）の位置をこのタブに保存し、一覧を出した後に戻す。
  // 保存が無い "POP"（最初に開いたページ等）は、新しく開いたときと同じく次のレースへ移す
  const navigationType = useNavigationType();
  const location = useLocation();
  const scrollKey = `venueScrollY:${location.pathname}`;
  const [savedScrollY] = useState(() => {
    if (navigationType !== "POP") return null;
    try {
      const v = window.sessionStorage.getItem(scrollKey);
      return v == null ? null : Number(v);
    } catch {
      return null;
    }
  });
  // ブラウザ自身のスクロール位置の復元は、一覧を後から読み込むため効かないうえ、読み込み後にこちらの復元を
  // 上書きして最上部へ戻すことがある。このページを開いている間は止め、戻る・進む・リロードの位置はすべて
  // 自前で保存・復元する（離れるときに元へ戻す）
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  useEffect(() => {
    const save = () => {
      try {
        window.sessionStorage.setItem(scrollKey, String(window.scrollY));
      } catch {
        // 保存できない環境では、開き直したときに次のレースへ移るだけ
      }
    };
    // 離れるときだけに頼らず、スクロールのたびに保存する（描画が止まるタブでも保存されるよう、
    // requestAnimationFrame を介さず同期的に書く。sessionStorage への書き込みは軽い）
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [scrollKey]);
  const gridRef = useRef(null);
  const markerRef = useRef(null);
  const scrolledRef = useRef(false);
  // 次のレースの目印（次のレースのカードの直上）まで1回だけスクロールする（BOA-546）。直上の会場カードは
  // 自分でデータを読み込むため、読み込みで高さが変わると目印が画面の下へ押し出される（ファン評価2周目）。
  // 着いてから5秒間は、ユーザーが操作するまで高さの変化に合わせて位置を合わせ直す
  useEffect(() => {
    if (scrolledRef.current) return undefined;
    if (savedScrollY != null) {
      // 一覧（レースのカード）を出してから、読んでいた位置に戻す
      if (!gridRef.current) return undefined;
      scrolledRef.current = true;
      window.scrollTo({ top: savedScrollY });
      // 直後に高さの変化などで位置がずれたら、ユーザーが操作していなければ1回だけ戻し直す
      let touched = false;
      const markTouched = () => {
        touched = true;
      };
      USER_SCROLL_EVENTS.forEach((type) =>
        window.addEventListener(type, markTouched, {
          passive: true,
          once: true,
        }),
      );
      setTimeout(() => {
        USER_SCROLL_EVENTS.forEach((type) =>
          window.removeEventListener(type, markTouched),
        );
        if (!touched && Math.abs(window.scrollY - savedScrollY) > 50) {
          window.scrollTo({ top: savedScrollY });
        }
      }, 500);
      return undefined;
    }
    const marker = markerRef.current;
    if (!marker) return undefined;
    scrolledRef.current = true;
    // 自分で合わせた位置。これと違う位置へのスクロールは、ユーザーの操作（スクロールバーのドラッグ等も含む）
    // とみなして合わせ直しをやめる
    // 高さが変わった直後のずれは、ブラウザのスクロール位置の自動調整（scroll anchoring）によるものなので、
    // ユーザーの操作とみなさず合わせ直す
    let expectedY = 0;
    let lastResizeAt = 0;
    // 着地点: 会場カード（折りたたみ）＋目印＋次のレースの頭が1画面に入るなら会場カードの先頭。
    // 開いた状態を覚えていて入らないときは、次のレースを優先して目印に着く
    const holder = marker.parentElement;
    const target = () => {
      const header =
        document.querySelector(".app-header")?.getBoundingClientRect().height ??
        0;
      const fits =
        holder.getBoundingClientRect().height + NEXT_RACE_PEEK_PX <=
        window.innerHeight - header;
      return fits ? holder : marker;
    };
    const realign = () => {
      scrollBelowHeader(target());
      expectedY = window.scrollY;
    };
    realign();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      lastResizeAt = Date.now();
      realign();
    });
    observer.observe(holder);
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
  // SG・G1 開催中は節タイトルを title・description に入れる（ja は「{会場}競艇のAI予想 {節タイトル}」。他言語は従来の文言に節タイトルを括弧書きで添える）
  const seriesTitle = getVenueSeriesTitle(venueRaces.map((r) => r.rawData));
  const todayMetaParams = { venue: venueName, series: seriesTitle };
  const metaTitle = isToday
    ? t(
        seriesTitle
          ? "venueRaceList.metaTitleSeries"
          : "venueRaceList.metaTitle",
        todayMetaParams,
      )
    : `${venueName} ${formatDate(date)}のレース一覧・AIデータ分析 - 龍神レーダー`;
  const metaDescription = isToday
    ? t(
        seriesTitle
          ? "venueRaceList.metaDescriptionSeries"
          : "venueRaceList.metaDescription",
        todayMetaParams,
      )
    : `${venueName}ボートレース場の${formatDate(date)}の全レース一覧。各レースのAIデータ分析・結果を確認できます。`;
  const noRacesMessage = isToday
    ? t("home.noRacesToday")
    : "このレース場のデータはありません";

  const showCardsInGrid = !loading && !error && cardsBeforeIndex != null;
  // 次のレースの直上に差し込むときは、見出しと要約1行に折りたたむ（会場カードと次のレースを1画面に入れる。
  // ファン評価3周目を受けたユーザー判断）。最上部に置くときは従来どおり全部を出す
  const venueCards = (
    <>
      <VenueCharacteristicsCard
        venueCode={venueCode}
        collapsible={showCardsInGrid}
      />

      {/* この日の水面傾向（phase a FR-5 / BOA-222）。直上の
          VenueCharacteristicsCard は過去90日のベースラインで、
          こちらはこの日1日分。カードの注記で日付とレース数を明示する */}
      <VenueDaySummaryCard
        venueCode={venueCode}
        date={date}
        collapsible={showCardsInGrid}
      />
    </>
  );

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
              🏁 {venueName}{" "}
              {isToday
                ? t("venueRaceList.todayTitle")
                : `${t("venueRaceList.title")} (${formatDate(date)})`}
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
