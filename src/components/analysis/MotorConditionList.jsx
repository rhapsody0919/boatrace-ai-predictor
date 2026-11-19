/** MotorConditionChart の一覧の画面と表の下の注記（MotorConditionChart.jsx から本文を字のまま移した） */
import { useTranslation } from "react-i18next";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import DrillDownHeader from "./DrillDownHeader";
import InlineFetchError from "../InlineFetchError";
import { SMALL_SAMPLE_THRESHOLD } from "../../pure/basicInfoStats.js";
import { powerIndexTone } from "../../utils/smallSampleRate";
import { translatePartName } from "../race/raceIndicators";
import { MotorListHead, MotorListRow } from "./MotorConditionListRow";

function MotorPartsNotes({ expandedParts, currentParts }) {
  const { t } = useTranslation();
  return (
    <>
      {expandedParts && (
        <p id="mcc-parts-names" className="table-note mcc-parts-names">
          {expandedParts.parts.map((part) => translatePartName(t, part)).join("、")}
        </p>
      )}
      <p className="table-note mcc-parts-note">{t("analysis.motor.partsCountNote")}</p>
      {currentParts.some((row) => row.failed) && (
        <div className="mcc-parts-error"><InlineFetchError /></div>
      )}
    </>
  );
}

function OwnRateNote({ rateViews, explainView, explainRow }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 「※」の数字の出どころ（BOA-830）。押した艇の説明を出す。押す前は押せることだけ書く */}
      {rateViews.some((v) => v.kind === "own") && (
        <p className="table-note motor-fresh-own-note">
          {explainView?.kind === "own"
            ? t("analysis.motor.freshOwnExplainBoat", {
                boat: explainRow.boat_number,
                explain: t("analysis.motor.freshOwnExplain", {
                  n: explainView.runs,
                }),
              })
            : t("analysis.motor.freshOwnHint")}
        </p>
      )}
    </>
  );
}

function VenueRankNote({ breakdown, venueRanks, selectedVenue }) {
  const { t } = useTranslation();
  return (
    <>
      {/* BOA-451 / ADR-0067: 生値をそのまま出す列（前検タイム・公式2連率）
        の出典を表のすぐ下に1回だけ置く。集計・加工した列（期間別の
        2連率/3連率・機力指数）は当社の計算なので出典の対象外。
        横スクロールの枠（右端のフェード）の外に置く。枠の中だと375pxで
        各行の末尾がフェードに隠れて読めない（2026-09-29 ファン評価） */}
      {/* 会場内順位の出どころ（BOA-428）。棒は BOATRACE 公式の2連率、順位は会場公式サイトの
          2連率で、出どころが違う（2026-10-02 ユーザー判断で注記の形）。日付は「取得日」と書く。
          会場によっては節ごとにしか中身が変わらず、取得日をデータの時点と読ませないため */}
      {breakdown.length > 0 && (
        <p className="table-note motor-venue-rank-note">
          {venueRanks?.state === "ok" && (
            <>
              {/* 日付は、会場サイトの集計の締め日があればそれ（「9/18 締め」）、無ければ取得日 */}
              {t(
                venueRanks.periodEnd
                  ? "analysis.motor.venueRankSourceNotePeriodEnd"
                  : "analysis.motor.venueRankSourceNote",
                {
                  venue: t(
                    `venues.${selectedVenue}`,
                    VENUE_NAMES[selectedVenue] || String(selectedVenue),
                  ),
                  date: (venueRanks.periodEnd ?? venueRanks.scrapedDate)
                    .replaceAll("-", "/")
                    .replace(/\/0(\d)/g, "/$1"),
                },
              )}
              <br />
            </>
          )}
          {/* 選手の実力が混ざる注意は、会場内順位の有無にかかわらず出す（ファン評価） */}
          {t("analysis.motor.barScaleNote")}
          {t("analysis.motor.motorRiderMixNote")}
        </p>
      )}
    </>
  );
}

function OfficialSourceNote({ breakdown, officialMode, listPowerIndex, venueColsLabel }) {
  const { t } = useTranslation();
  return (
    <>
      {officialMode
        ? t(
            // 自前の値（公式 0 の艇・機力指数）を出している過去レース（BOA-830）
            breakdown.some((r) => r.generation_runs != null)
              ? "analysis.motor.officialModeSourceNoteFresh"
              : "analysis.motor.officialModeSourceNote",
          )
        : t("analysis.motor.officialSourceNote")}
      {/* 会場公式サイト由来の列（1着率・優出数・優勝数）は、表に出ているものだけを
          挙げる。1つも無い会場（戸田など）では文ごと出さない（BOA-513。列名が空の
          まま「…の値、はそのレース日以前…」と文が崩れるのを防ぐ） */}
      {/* 一覧のオレンジ色の機力指数の意味（6走未満の参考値）。該当する行が
          あるときだけ書く（2026-09-29 ファン評価） */}
      {breakdown.some(
        (r) =>
          powerIndexTone(
            listPowerIndex(r).value,
            listPowerIndex(r).n,
            SMALL_SAMPLE_THRESHOLD,
          ) === "small",
      ) &&
        t("analysis.motor.powerIndexSmallSampleNote", {
          n: SMALL_SAMPLE_THRESHOLD,
        })}
      {venueColsLabel &&
        `${t(
          officialMode
            ? "analysis.motor.venueColsPastNote"
            : "analysis.motor.venueColsTodayNote",
          { venueCols: venueColsLabel },
        )}`}
    </>
  );
}

// 新しいモーターの最初の節（BOA-830、2026-10-11 ユーザー決定の文言）
function FreshMeetBanner({ freshness, selectedVenue }) {
  const { t } = useTranslation();
  return (
    <p className="motor-fresh-banner">
      {t("analysis.motor.freshFirstMeetBanner", {
        venue: t(
          `venues.${selectedVenue}`,
          VENUE_NAMES[selectedVenue] || String(selectedVenue),
        ),
        month: Number(freshness.generationStart.slice(5, 7)),
        day: Number(freshness.generationStart.slice(8, 10)),
      })}
    </p>
  );
}

function MotorListTable({ m, v, scroll, scrollRef }) {
  const {
    breakdown, periodDays, focusedBoat, onFocusBoat, setDrillDownMotor,
    partsBoat, setPartsBoat, explainBoat, setExplainBoat,
  } = m;
  return (
    <div
      className={`table-wrapper hscroll-hint mcc-list-hint${scroll.hasMore ? " has-more" : ""}`}
    >
      <HorizontalScrollButtons
        hasMore={scroll.hasMore}
        hasLess={scroll.hasLess}
        onMore={scroll.scrollRight}
        onLess={scroll.scrollLeft}
      />
      <div
        className="table-scroll"
        ref={scrollRef}
        onScroll={scroll.update}
      >
        <table className="motor-ranking-table mcc-list-table">
          <MotorListHead firstMeet={v.firstMeet} showVenueRank={v.showVenueRank} officialMode={v.officialMode} periodDays={periodDays} hasPretest={v.hasPretest} showFirstPlaceRate={v.showFirstPlaceRate} showFinalCount={v.showFinalCount} showChampionshipCount={v.showChampionshipCount} />
          <tbody>
            {breakdown.map((row, i) => (
              <MotorListRow key={row.boat_number} row={row} i={i} view={v} focusedBoat={focusedBoat} setDrillDownMotor={setDrillDownMotor} onFocusBoat={onFocusBoat} currentParts={v.currentParts} partsBoat={partsBoat} setPartsBoat={setPartsBoat} explainBoat={explainBoat} setExplainBoat={setExplainBoat} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MotorListView({ m, v, scroll, scrollRef }) {
  const { t } = useTranslation();
  const { freshness, selectedVenue, embedded, breakdown, venueRanks } = m;
  return (
    <>
      {v.firstMeet && freshness?.generationStart && (
        <FreshMeetBanner freshness={freshness} selectedVenue={selectedVenue} />
      )}
      <MotorListTable m={m} v={v} scroll={scroll} scrollRef={scrollRef} />
      {embedded && (
        <MotorPartsNotes expandedParts={v.expandedParts} currentParts={v.currentParts} />
      )}
      <OwnRateNote rateViews={v.rateViews} explainView={v.explainView} explainRow={v.explainRow} />
      <VenueRankNote breakdown={breakdown} venueRanks={venueRanks} selectedVenue={selectedVenue} />
      {v.venueStatsFailed && (
        <p className="table-note motor-venue-stats-failed-note">
          {t("analysis.motor.venueStatsFailedNote")}
        </p>
      )}
      <p className="table-note motor-official-source-note">
        <OfficialSourceNote breakdown={breakdown} officialMode={v.officialMode} listPowerIndex={v.listPowerIndex} venueColsLabel={v.venueColsLabel} />
      </p>
    </>
  );
}

export function DrillPreGenerationView({ drillDownMotor, setDrillDownMotor }) {
  const { t } = useTranslation();
  return (
    <>
      <DrillDownHeader
        onBack={() => setDrillDownMotor(null)}
        backLabel={t("analysis.backToList")}
        heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
      />
      <div className="empty-state">
        {t("analysis.motor.drillPreGeneration", { n: drillDownMotor })}
      </div>
    </>
  );
}
