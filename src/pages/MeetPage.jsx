import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import DataFetchError from "../components/DataFetchError";
import MeetRankingTable from "../components/meet/MeetRankingTable";
import MeetQualifiersSection from "../components/meet/MeetQualifiersSection";
import { supabaseDataService } from "../services/supabaseDataService";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { getTodayJST } from "../utils/dateUtils";
import { GRADE_CONFIG } from "../constants/gradeConfig";
import {
  buildMeetRanking,
  listAbsentOnlyRacers,
  SEMIFINAL_DEFAULT_SLOTS,
} from "../components/race/seriesPoints";
import { pickShobugake } from "../utils/meetPageModel";
import "./MeetPage.css";

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 節タイトルの全角数字等を半角にそろえる（会場ページの title・SG帯と同じ） */
const normalizeTitle = (title) =>
  title ? title.normalize("NFKC").trim() || null : null;

/**
 * 節ページ `/venue/:venueCode/meet/:startDate`（BOA-682）。
 *
 * 節の全選手の得点率ランキング・準優ボーダー・勝ち上がりを1ページで出す。
 * 設計: docs/design/meet-page/{spec,screens,plan}.md
 */
function MeetPage() {
  const { venueCode: venueParam, startDate } = useParams();
  const venueCode = Number(venueParam);
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const validParams =
    Number.isInteger(venueCode) &&
    venueCode >= 1 &&
    venueCode <= 24 &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "");
  const key = `${venueCode}-${startDate}`;
  // 取得結果は節のキーとセットで持つ（URL だけ変わったときに前の節が混ざらない）
  const [loaded, setLoaded] = useState({ key: null, page: null });
  const [failedKey, setFailedKey] = useState(null);

  useEffect(() => {
    if (!validParams) return undefined;
    let cancelled = false;
    supabaseDataService
      .getMeetPage(venueCode, startDate, getTodayJST())
      .then((page) => {
        if (!cancelled) setLoaded({ key, page });
      })
      .catch((err) => {
        console.error("節ページの取得に失敗", err);
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key, validParams, venueCode, startDate]);

  const page = loaded.key === key ? loaded.page : null;
  const failed = failedKey === key;
  const venueName = validParams ? t(`venues.${venueCode}`) : "";
  const series = normalizeTitle(page?.title);
  const meetLabel =
    series ??
    t("meetPage.meetFallback", { date: md(startDate ?? "0000-00-00") });
  const canonicalPath = `/venue/${venueCode}/meet/${startDate}`;
  const metaTitle = t("meetPage.metaTitle", {
    venue: venueName,
    series: meetLabel,
  });
  const metaDescription = t("meetPage.metaDescription", {
    venue: venueName,
    series: meetLabel,
  });
  const noindex =
    !validParams ||
    (page &&
      (["notFound", "outOfScope"].includes(page.state) || !page.knownMeet));
  // 宣言的な <meta> は index.html の静的 robots と重複するので DOM を書き換える
  useRobotsMeta(Boolean(noindex));

  const breadcrumbItems = [
    { name: t("analysisPage.breadcrumbHome"), url: localize("/") },
    { name: venueName, url: localize(`/venue/${venueCode}`) },
    { name: meetLabel, url: localize(canonicalPath) },
  ];

  const backToVenue = (
    <Link to={localize(`/venue/${venueCode}`)} className="meet-page__back">
      {t("meetPage.backToVenue", { venue: venueName })}
    </Link>
  );

  let body;
  if (!validParams || page?.state === "notFound") {
    body = (
      <div className="meet-page__message">
        <p>{t("meetPage.notFound")}</p>
        {validParams && backToVenue}
      </div>
    );
  } else if (failed) {
    body = <DataFetchError />;
  } else if (!page) {
    body = (
      <LoadingScreen
        title={t("home.loadingTitle")}
        description={t("home.loadingDesc")}
      />
    );
  } else if (page.state === "outOfScope") {
    body = (
      <div className="meet-page__message">
        <p>{t("meetPage.outOfScope")}</p>
        {backToVenue}
      </div>
    );
  } else if (page.state === "preOpen") {
    body = (
      <div className="meet-page__message">
        <p>
          {t("meetPage.preOpen", {
            month: Number(startDate.slice(5, 7)),
            day: Number(startDate.slice(8, 10)),
          })}
        </p>
        {backToVenue}
      </div>
    );
  } else {
    body = <MeetBody page={page} />;
  }

  return (
    <>
      <title>{metaTitle}</title>
      <meta name="description" content={metaDescription} />
      <link rel="canonical" href={`https://www.boat-ai.jp${canonicalPath}`} />
      <Header />
      <div className="meet-page">
        <Breadcrumb items={breadcrumbItems} />
        <MeetHeader
          venueName={venueName}
          series={series}
          grade={page?.grade ?? null}
          startDate={startDate}
          endDate={page?.endDate ?? null}
          seriesDay={page?.seriesDayToday ?? null}
          state={page?.state ?? null}
        />
        {body}
      </div>
    </>
  );
}

/** 節の見出し（会場・節タイトル・グレード・期間・何日目・段階。spec FR-1.1） */
function MeetHeader({
  venueName,
  series,
  grade,
  startDate,
  endDate,
  seriesDay,
  state,
}) {
  const { t } = useTranslation();
  const gradeConfig = grade ? GRADE_CONFIG[grade] : null;
  const showStage = state && !["notFound", "outOfScope"].includes(state);
  return (
    <header className="meet-page__header">
      <div className="meet-page__meta">
        {gradeConfig && (
          <span
            className="meet-page__grade"
            style={{ backgroundColor: gradeConfig.color }}
            translate="no"
          >
            {gradeConfig.label}
          </span>
        )}
        <span>{venueName}</span>
        {startDate && (
          <span>
            {endDate
              ? t("meetPage.period", { start: md(startDate), end: md(endDate) })
              : t("meetPage.periodFrom", { start: md(startDate) })}
          </span>
        )}
        {seriesDay != null && (
          <span>{t("meetPage.dayN", { n: seriesDay })}</span>
        )}
        {showStage && (
          <span className="meet-page__stage">
            {t(`meetPage.stage.${state}`)}
          </span>
        )}
      </div>
      <h1>{series ?? t("meetPage.titleFallback", { venue: venueName })}</h1>
    </header>
  );
}

const CONFIRMED_STATES = ["prelimDone", "semifinalDay", "finalDay", "finished"];

/** 予選中〜節終了のランキングと勝ち上がり */
function MeetBody({ page }) {
  const { t } = useTranslation();
  const board = page.board;
  const ranking = buildMeetRanking(board);
  const rows = ranking.filter((r) => !r.withdrawn);
  // 順位の対象外: 途中帰郷・賞典除外・今節F（`buildMeetRanking` の withdrawn）と、
  // 今節の走が全て欠場で得点率が出ない選手（ランキングに載らないので足す。BOA-504）
  const rankedIds = new Set(ranking.map((r) => r.racerId));
  const excluded = [
    ...ranking
      .filter((r) => r.withdrawn)
      .map((r) => ({
        racerId: r.racerId,
        playerName: r.playerName,
        finishes: r.finishes,
        reason: r.excludedReason ?? "withdrawn",
      })),
    ...listAbsentOnlyRacers(board)
      .filter((r) => !rankedIds.has(r.racerId))
      .map((r) => ({ ...r, reason: "absent" })),
  ];
  const slots = board?.semifinalSlots ?? SEMIFINAL_DEFAULT_SLOTS;
  const border = rows[slots - 1]?.rate ?? null;
  const confirmed = CONFIRMED_STATES.includes(page.state);
  const showRemaining = page.state === "prelimFinalDay";
  const remainingRuns = board?.remainingPrelimRunsByRacer ?? {};
  const remainingMax = board?.remainingPrelimMaxPointsByRacer ?? {};
  const shobugake = showRemaining
    ? pickShobugake(rows, border, slots, remainingRuns, remainingMax)
    : new Set();
  const classByRacer = Object.fromEntries(
    Object.entries(board?.pretestByRacer ?? {}).map(([id, p]) => [
      id,
      p?.racer_class ?? "",
    ]),
  );

  return (
    <div className="meet-page__body">
      <div className="meet-page__main">
        {page.state === "prelim" && (
          <p className="meet-page__note">{t("meetPage.shobugakePending")}</p>
        )}
        <MeetRankingTable
          rows={rows}
          excluded={excluded}
          slots={slots}
          border={border}
          confirmed={confirmed}
          showRemaining={showRemaining}
          remainingRuns={remainingRuns}
          remainingMax={remainingMax}
          shobugake={shobugake}
          classByRacer={classByRacer}
        />
        <p className="meet-page__source">{t("meetPage.source")}</p>
      </div>
      <aside className="meet-page__side">
        <MeetQualifiersSection qualifiers={page.qualifiers} />
      </aside>
    </div>
  );
}

export default MeetPage;
