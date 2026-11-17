/**
 * VenueRaceListPage - 会場別レース一覧ページ
 * 本日（`/venue/:venueCode`）と過去日付（`/races/:date/:venueCode`）の両方で使う。
 * 1R〜12Rを一覧表示し、各レースカードからレース詳細（/race/:raceId）へ遷移する。
 */
import { useRef, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isInCautionEnabled } from "../config/featureFlags";
import { useVisibleOnce } from "../hooks/useVisibleOnce";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { trackEvent } from "../utils/analytics";
import { cautionVisibleEvent } from "../utils/cautionEvents";
import { useDatePredictions } from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { getNowHHMMJST, getTodayJST } from "../utils/dateUtils";
import { getTodayVenuePageMeta } from "../utils/pageMeta";
import { venueNameOf } from "../utils/raceListDisplay";
import {
  buildListState,
  pastPageMeta,
  venueBreadcrumbItems,
} from "./VenueRaceListPageModel";
import { useScrollPersistence, useLandingScroll } from "./VenueRaceListPageScroll";
import VenueRaceListView from "./VenueRaceListPageView";
import "./VenueRaceListPage.css";

function VenueRaceListPage() {
  const { date: dateParam, venueCode: venueCodeParam } = useParams();
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();

  const isToday = !dateParam;
  const date = dateParam || getTodayJST();
  // parseIntは"5abc"のような末尾に余分な文字があるパラメータも5として通してしまうため、
  // 全体が数字のみであることを正規表現で先に検証する
  const venueCode = /^\d+$/.test(venueCodeParam || "")
    ? parseInt(venueCodeParam, 10)
    : NaN;

  const { races: allRaces, loading, error } = useDatePredictions(date);
  // 注意度の定義の1行（一覧の札の上）が画面に入ったら、会場・日付ごとに1回 caution_visible（BOA-822 task 27）
  const cautionNoteRef = useVisibleOnce(
    isInCautionEnabled() ? `race_list|${date}|${venueCodeParam}` : null,
    () => {
      const ev = cautionVisibleEvent({ surface: "race_list" });
      if (ev) trackEvent(ev.name, ev.params);
    },
  );
  // Hooksはearly returnより前で無条件に呼ぶ必要があるため、venueCode不正時のNavigateより前に置く
  const nowHHMM = useNowHHMM(isToday);
  // 次の発走レースの位置は、開いた時点の時刻で決めて固定する（読んでいる途中でカードが動いたり
  // 再スクロールしたりしないように。開き直すと新しい位置になる。BOA-546）
  const [openedHHMM] = useState(() => (isToday ? getNowHHMMJST() : null));
  const savedScrollY = useScrollPersistence();
  const gridRef = useRef(null);
  const markerRef = useRef(null);
  useLandingScroll(savedScrollY, gridRef, markerRef);

  const venueName = venueNameOf(t, venueCode);
  const { venueRaces, cardsBeforeIndex, liveNextIndex, liveNextRace } =
    buildListState(allRaces, venueCode, venueName, openedHHMM, nowHHMM);

  const backLink = isToday ? localize("/") : `/races/${date}`;
  const breadcrumbItems = venueBreadcrumbItems({
    isToday,
    t,
    date,
    venueCode,
    venueName,
    lang: i18n.resolvedLanguage,
  });

  // /races/:date/:venueCode（過去日付）はja専用パス（TRANSLATED_PATHS未登録）のため、
  // 「本日」を前提にしたi18nの見出しをそのまま使い回さず日付入りの日本語文言にする
  // （VenueGridPageのPastVenueGridPageと同じ方針。BOA-XXX的発見: 過去日付ページでも
  // 「本日のレース一覧」というタイトルになっていた実装漏れの修正）
  // 本日分は、ボット向け HTML（ADR 0089）と同じ関数で title・description・canonical を組む。
  // SG・G1 開催中は節タイトルを title・description に入れる（ja は「{会場}競艇のAI予想 {節タイトル}」。他言語は従来の文言に節タイトルを括弧書きで添える）
  const pageMeta = isToday
    ? getTodayVenuePageMeta(
        t,
        venueCode,
        venueRaces.map((r) => r.rawData),
        i18n.resolvedLanguage,
      )
    : pastPageMeta(venueName, date, venueCode);
  useSocialMeta({
    title: pageMeta.title,
    description: pageMeta.description,
    url: pageMeta.canonical,
  });

  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    return <Navigate to={isToday ? "/" : `/races/${date}`} replace />;
  }

  return (
    <VenueRaceListView
      {...{
        t,
        localize,
        isToday,
        date,
        venueCode,
        venueName,
        backLink,
        loading,
        error,
        pageMeta,
        breadcrumbItems,
        venueRaces,
        cardsBeforeIndex,
        liveNextIndex,
        liveNextRace,
        nowHHMM,
        cautionNoteRef,
        gridRef,
        markerRef,
      }}
    />
  );
}

export default VenueRaceListPage;
