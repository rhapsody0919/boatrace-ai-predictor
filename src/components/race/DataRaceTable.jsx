/**
 * DataRaceTable - データ出走表（BOA-168）
 * 出走6選手×分析指標の転置マトリクス（行=指標、列=艇番）。
 * レースページの主役としてAI予想ブロック群より上に表示する。
 * 指標の定義（値レンダリング・最良艇判定）はraceIndicators.jsxに集約している。
 * 色分けはレース内相対順位ベース（行ごとに最良セルをハイライト）で、
 * 恣意的な絶対閾値は使わない。全艇同値の指標はハイライトしない。
 *
 * 2026-09-16追記(BOA-304): 直前情報系4指標（展示ST・展示タイム・チルト・
 * 調整重量、+部品交換）は「直前情報」タブ（RaceBeforeInfoTab）へ分離した。
 * buildBasicIndicatorRows（過去実績系のみ）を使う。全指標が必要な箇所
 * （RaceCardDataTable、開催場一覧ページのカード内出走表）は引き続き
 * buildIndicatorRowsを使う
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { useSixBoatCourseStats } from "../../hooks/useSixBoatCourseStats";
import { buildBasicIndicatorRows } from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import FlyingBadge from "./FlyingBadge";
import { useRaceEntryFlyingRows } from "../../hooks/useRaceEntryFlyingRows";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import InlineFetchError from "../InlineFetchError";
import FavoriteStarButton from "../common/FavoriteStarButton.jsx";
import BoatCompareTable from "../dataDisplay/BoatCompareTable";
import { useRaceUrlState } from "./PredictionPanelState";
import "./DataRaceTable.css";
import { splitRacerName } from "../../utils/racerName";
import { localizePath } from "../../pure/localizePath.js";

const nameParts = (name) =>
  splitRacerName(name).map((part, i) => (
    <span key={i} className="drt-name-part">
      {part}
    </span>
  ));

// 選手名の見出し（2段目）
function NameHeader({ p }) {
  return (
    <>
      {/* 姓と名を別の塊にする。スマホでは2行に分け、名前の途中で
          折れないようにする（BOA-612。PCでは続けて1行に並ぶ） */}
      {p.racerId ? (
        <Link to={`/racer/${p.racerId}`} translate="no">
          {nameParts(p.name)}
        </Link>
      ) : (
        <span translate="no">{nameParts(p.name)}</span>
      )}
      {p.racerId && (
        <div className="drt-name-favorite">
          <FavoriteStarButton
            type="racer"
            id={p.racerId}
            name={p.name}
            entry="race_table"
          />
        </div>
      )}
    </>
  );
}

/**
 * データ出走表の注記の下の案内のリンク。縦に並べる（幅のある画面で2本が隙間なく横につながらないように）。
 * 超展開データ（分析ツール）への入口は、基本情報タブの畳みを外した後の行き先（オーナー 2026-11-25）
 */
function GuideLinks({ deepLink }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="drt-guide-links">
      <Link
        to={localizePath(deepLink("attackdefense"), i18n.language)}
        className="drt-guide-link drt-attack-defense-link"
        onClick={() =>
          trackEvent("deep_link_click", {
            tab: "attackdefense",
            link_source: "data_race_table_note",
          })
        }
      >
        {"\u2694\ufe0f"} {t("dataTable.attackDefenseLink")}{"\u00a0"}→
      </Link>
      {i18n.language === "ja" && (
        <Link to="/blog/data-race-table-guide" className="drt-guide-link">
          📖 {t("dataTable.guideLink")} →
        </Link>
      )}
    </div>
  );
}

function RowLabel({ row, deepLink }) {
  return (
    <>
      {row.tab ? (
        <Link
          to={deepLink(row.tab)}
          className="drt-label-link"
          onClick={() =>
            trackEvent("deep_link_click", {
              tab: row.tab,
              link_source: "data_race_table",
            })
          }
        >
          <span className="drt-label-full">{row.label}</span>
          <span className="drt-label-short">{row.shortLabel}</span>
          <span className="drt-link-arrow">›</span>
        </Link>
      ) : (
        <>
          <span className="drt-label-full">{row.label}</span>
          <span className="drt-label-short">{row.shortLabel}</span>
        </>
      )}
      <TermHintButton
        termKey={row.hintKey ?? row.key}
        values={row.hintValues}
      />
      {row.note && (
        <span
          className={`drt-label-note${row.wrapNote ? " drt-label-note--wrap" : ""}`}
        >
          {row.note}
        </span>
      )}
    </>
  );
}

function DataRaceTable({ raceId, prediction, venueCode }) {
  const { t } = useTranslation();
  // 選んだ艇（?boat=）はほかのタブと同じ URL の値（BOA-492、オーナー 2026-11-23 承認の5）
  const { focusedBoat, handleFocusBoat } = useRaceUrlState();
  const analysis = useRaceAnalysisData(raceId, { venueCode });
  // 級別の後ろの F・L バッジ。基本情報タブの勝率バー・ST考察カードと同じ出所
  // （race_entries.f_count / l_count）と「今節」の判定を使う。以前はこの表にだけ出ず、
  // 同じ選手の F 持ちが表の側では分からなかった（BOA-638）
  const flyingRowByBoat = useRaceEntryFlyingRows(raceId);
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);

  const players = [...(prediction?.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  // 想定コース1着率の行は枠別情報タブの6艇の表と同じフック・同じ行から取る（BOA-1296）
  const courseStats = useSixBoatCourseStats({
    raceDate: raceId?.slice(0, 10),
    venueCode,
    players,
  });
  if (players.length === 0) return null;

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?tab=${tab}`;

  // 機力指数バッジ（BOA-265）: 個々の艇のモーターがどちら向きかを予告し、
  // クリックで該当モーターのドリルダウン画面に直接遷移させる
  const motorDeepLink = (motorNumber) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=motor&motor=${motorNumber}`
      : `/winning-technique?tab=motor`;

  const rows = buildBasicIndicatorRows({
    t,
    players,
    analysis,
    courseStats,
    pending: analysis.pending,
    motorDeepLink,
    gradeBadge: (p) => (
      <FlyingBadge
        count={flyingRowByBoat?.get(p.number)?.f_count}
        currentMeet={currentMeetFlyingBoats.has(p.number)}
        lateCount={flyingRowByBoat?.get(p.number)?.l_count}
      />
    ),
  });

  return (
    <div className="data-race-table" id="data-race-table">
      <h3 className="drt-title">
        📋 {t("dataTable.title")}
        {analysis.loading && (
          <span className="drt-loading-chip">{t("dataTable.loading")}</span>
        )}
      </h3>
      <p className="drt-subtitle">{t("dataTable.subtitle")}</p>

      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}
      {/* 想定コース1着率（直近3期）の取得失敗も「—」だけにしない（BOA-1296 /code-review） */}
      {courseStats.status === "error" && (
        <InlineFetchError
          message={t("wakuInfo.sixBoat.fetchError")}
          onRetry={courseStats.reload}
        />
      )}

      <div className="drt-table-wrapper">
        <BoatCompareTable
          players={players}
          rows={rows}
          renderLabel={(row) => <RowLabel row={row} deepLink={deepLink} />}
          renderName={(p) => <NameHeader p={p} />}
          selectedBoat={focusedBoat}
          onSelectBoat={handleFocusBoat}
        />
      </div>

      <p className="drt-note">💡 {t("dataTable.noteExpectedCourse")}</p>
      <GuideLinks deepLink={deepLink} />
    </div>
  );
}

export default DataRaceTable;
