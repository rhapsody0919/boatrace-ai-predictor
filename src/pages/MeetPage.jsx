import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import DataFetchError from "../components/DataFetchError";
import MeetRankingTable from "../components/meet/MeetRankingTable";
import MeetQualifiersSection from "../components/meet/MeetQualifiersSection";
import { getMeetPage } from "../services/meetQueries3.js";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { getTodayJST } from "../utils/dateUtils";
import { GRADE_CONFIG } from "../constants/gradeConfig";
import {
  buildMeetRanking,
  listAbsentOnlyRacers,
  SEMIFINAL_DEFAULT_SLOTS,
  readOfficialPenalty,
} from "../pure/seriesPoints.js";
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
  const isNoindex = (valid, p) =>
    !valid ||
    (p && (["preOpen", "notFound", "outOfScope"].includes(p.state) || !p.knownMeet));
  // 取得結果は節のキーとセットで持つ（URL だけ変わったときに前の節が混ざらない）
  const [loaded, setLoaded] = useState({ key: null, page: null });
  const [failedKey, setFailedKey] = useState(null);

  useEffect(() => {
    if (!validParams) return undefined;
    let cancelled = false;
    getMeetPage(venueCode, startDate, getTodayJST())
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
  const state = page?.state;
  const venueName = validParams ? t(`venues.${venueCode}`) : "";
  // 宣言的な <meta> は index.html の静的 robots と重複するので DOM を書き換える
  useRobotsMeta(Boolean(isNoindex(validParams, page)));
  const backToVenue = (
    <Link to={localize(`/venue/${venueCode}`)} className="meet-page__back">
      {t("meetPage.backToVenue", { venue: venueName })}
    </Link>
  );
  let body;
  if (!validParams || state === "notFound") {
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
  } else if (state === "outOfScope") {
    body = (
      <div className="meet-page__message">
        <p>{t("meetPage.outOfScope")}</p>
        {backToVenue}
      </div>
    );
  } else if (state === "preOpen") {
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
    <MeetPageView
      validParams={validParams}
      failed={failed}
      venueCode={venueCode}
      venueName={venueName}
      startDate={startDate}
      page={page}
      body={body}
    />
  );
}

/** 節ページの外側（title・canonical・description・見出し・パンくず・本文の枠） */
function MeetPageView({
  validParams,
  failed,
  venueCode,
  venueName,
  startDate,
  page,
  body,
}) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const series = normalizeTitle(page?.title);
  // 日付の形でない URL（validParams が偽）は日付を作らない（「NaN/NaN開幕の節」を出さない）
  const meetLabel =
    series ??
    (validParams
      ? t("meetPage.meetFallback", { date: md(startDate) })
      : t("meetPage.titleFallback", { venue: venueName }));
  const canonicalPath = `/venue/${venueCode}/meet/${startDate}`;
  const metaTitle = t("meetPage.metaTitle", {
    venue: venueName,
    series: meetLabel,
  });
  const metaDescription = t("meetPage.metaDescription", {
    venue: venueName,
    series: meetLabel,
  });
  const breadcrumbItems = [
    { name: t("analysisPage.breadcrumbHome"), url: localize("/") },
    { name: venueName, url: localize(`/venue/${venueCode}`) },
    { name: meetLabel, url: localize(canonicalPath) },
  ];
  return (
    <>
      {/* 取得待ちでも URL から決まる会場・開幕日と canonical を出す。節名は取得後に更新する */}
      <title>{metaTitle}</title>
      <link
        rel="canonical"
        href={`https://www.boat-ai.jp${localize(canonicalPath)}`}
      />
      {(page || failed || !validParams) && (
        <meta name="description" content={metaDescription} />
      )}
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
          winner={pickWinner(page)}
        />
        {body}
      </div>
    </>
  );
}

/** 節が終わっていれば優勝者（決勝の1着）。それ以外は null */
function pickWinner(page) {
  return page?.state === "finished"
    ? (page.qualifiers?.finals?.[0]?.boats ?? []).find((b) => b.finish === 1)
    : null;
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
  winner,
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
      {/* 節が終わった後に来る人がまず知りたいのは優勝者。勝ち上がり欄は52人の表の
          後ろ（375px）にあるので、見出しの直下にも出す（ファン評価1周目） */}
      {winner && (
        <p className="meet-page__winner">
          {t("meetPage.winnerLabel")}{" "}
          <strong translate="no">{winner.playerName}</strong>{" "}
          {t("meetPage.winnerBoat", { boat: winner.boatNumber })}
        </p>
      )}
    </header>
  );
}

const CONFIRMED_STATES = ["prelimDone", "semifinalDay", "finalDay", "finished"];

/** 順位の対象外の選手（途中帰郷・賞典除外・今節F と、今節の走が全て欠場の選手） */
function buildExcluded(ranking, board) {
  // 順位の対象外: 途中帰郷・賞典除外・今節F（`buildMeetRanking` の withdrawn）と、
  // 今節の走が全て欠場で得点率が出ない選手（ランキングに載らないので足す。BOA-504）
  const rankedIds = new Set(ranking.map((r) => r.racerId));
  return [
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
}

/** 準優の目安（ボーダー）。まだ1走もしていない選手がいる間は null */
function pickBorder(rows, slots, notYetStarted) {
  return notYetStarted > 0 ? null : (rows[slots - 1]?.rate ?? null);
}

const buildClassByRacer = (board) =>
  Object.fromEntries(
    Object.entries(board?.pretestByRacer ?? {}).map(([id, p]) => [
      id,
      p?.racer_class ?? "",
    ]),
  );

const buildPenaltyByRacer = (board) =>
  Object.fromEntries(
    Object.entries(board?.officialByRacer ?? {})
      .map(([id, o]) => [id, readOfficialPenalty(o?.penalty_points ?? 0).deduct])
      .filter(([, p]) => p > 0),
  );

/** 順位表まわりの値（board から導く。副作用なし） */
function buildMeetBodyModel(page) {
  const board = page.board;
  const ranking = buildMeetRanking(board);
  const rows = ranking.filter((r) => !r.withdrawn);
  const excluded = buildExcluded(ranking, board);
  const slots = board?.semifinalSlots ?? SEMIFINAL_DEFAULT_SLOTS;
  const confirmed = CONFIRMED_STATES.includes(page.state);
  // まだ1走もしていない選手がいる間（ふつうは初日の途中）は、順位の対象がそろって
  // おらず目安が意味を持たないので伏せる（今節タブと同じ、BOA-690）。予選後は出す
  const notYetStarted = confirmed
    ? 0
    : (board?.notYetStartedRacerIds ?? []).length;
  const border = pickBorder(rows, slots, notYetStarted);
  const showRemaining = page.state === "prelimFinalDay";
  const remainingRuns = board?.remainingPrelimRunsByRacer ?? {};
  const remainingMax = board?.remainingPrelimMaxPointsByRacer ?? {};
  const shobugake = showRemaining
    ? pickShobugake(rows, border, slots, remainingRuns, remainingMax)
    : new Set();
  const classByRacer = buildClassByRacer(board);
  return {
    board,
    rows,
    excluded,
    slots,
    confirmed,
    notYetStarted,
    border,
    showRemaining,
    remainingRuns,
    remainingMax,
    shobugake,
    classByRacer,
  };
}

/** 順位表（または「まだ得点率が無い」の案内） */
function MeetRankingBlock({ page, m }) {
  const { t } = useTranslation();
  const {
    board,
    rows,
    excluded,
    slots,
    confirmed,
    border,
    showRemaining,
    remainingRuns,
    remainingMax,
    shobugake,
    classByRacer,
  } = m;
  // 初日の最初のレースの結果が出るまでは、得点率の付いた選手がいない。
  // 見出しだけの空の表と「全0人」を出さず、開幕前と同じ案内にする
  return rows.length === 0 && excluded.length === 0 ? (
    <p className="meet-page__message meet-page__no-rate">
      {t("meetPage.noRateYet")}
    </p>
  ) : (
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
      officialAsOfDay={page.officialAsOfDay ?? null}
      officialAsOfIsToday={page.officialAsOfIsToday ?? false}
      officialLink={`https://www.boatrace.jp/owpc/pc/race/pointrank?jcd=${String(page.venueCode).padStart(2, "0")}&hd=${getTodayJST().replaceAll("-", "")}`}
      penaltyByRacer={buildPenaltyByRacer(board)}
    />
  );
}

/** 予選中〜節終了のランキングと勝ち上がり */
function MeetBody({ page }) {
  const { t } = useTranslation();
  const m = buildMeetBodyModel(page);
  const { rows, notYetStarted, confirmed } = m;

  return (
    <div className="meet-page__body">
      <div className="meet-page__main">
        {notYetStarted > 0 && rows.length > 0 && (
          <p className="meet-page__note">
            {t("meetPage.borderPending", { count: notYetStarted })}
          </p>
        )}
        {page.state === "prelim" && rows.length > 0 && (
          <p className="meet-page__note">{t("meetPage.shobugakePending")}</p>
        )}
        <MeetRankingBlock page={page} m={m} />
        <p className="meet-page__source">
          {t(confirmed ? "meetPage.sourceConfirmed" : "meetPage.source")}
        </p>
      </div>
      <aside className="meet-page__side">
        <MeetQualifiersSection qualifiers={page.qualifiers} />
      </aside>
    </div>
  );
}

export default MeetPage;
