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
import { BOAT_COLORS } from "../../utils/colors";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { buildBasicIndicatorRows } from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import FlyingBadge from "./FlyingBadge";
import { useRaceEntryFlyingRows } from "../../hooks/useRaceEntryFlyingRows";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import InlineFetchError from "../InlineFetchError";
import "./DataRaceTable.css";
import { splitRacerName } from "../../utils/racerName";

const nameParts = (name) =>
  splitRacerName(name).map((part, i) => (
    <span key={i} className="drt-name-part">
      {part}
    </span>
  ));

function DataRaceTable({ raceId, prediction, venueCode }) {
  const { t, i18n } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });
  // 級別の後ろの F・L バッジ。基本情報タブの勝率バー・ST考察カードと同じ出所
  // （race_entries.f_count / l_count）と「今節」の判定を使う。以前はこの表にだけ出ず、
  // 同じ選手の F 持ちが表の側では分からなかった（BOA-638）
  const flyingRowByBoat = useRaceEntryFlyingRows(raceId);
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);

  const players = [...(prediction?.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );
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

  const cellClass = (boat, best) =>
    `drt-cell ${best?.has(boat) ? "drt-best" : ""}`;

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

      <div className="drt-table-wrapper">
        <table className="drt-table">
          <thead>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => {
                const color = BOAT_COLORS[p.number] || {};
                return (
                  <th
                    key={p.number}
                    className="drt-boat-th"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {p.number}
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => (
                <th key={p.number} className="drt-name-th">
                  {/* 姓と名を別の塊にする。スマホでは2行に分け、名前の途中で
                      折れないようにする（BOA-612。PCでは続けて1行に並ぶ） */}
                  {p.racerId ? (
                    <Link to={`/racer/${p.racerId}`} translate="no">
                      {nameParts(p.name)}
                    </Link>
                  ) : (
                    <span translate="no">{nameParts(p.name)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="drt-label-cell">
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
                  <TermHintButton termKey={row.key} />
                  {row.note && (
                    <span className="drt-label-note">{row.note}</span>
                  )}
                </td>
                {players.map((p) => (
                  <td key={p.number} className={cellClass(p.number, row.best)}>
                    {row.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="drt-note">💡 {t("dataTable.note")}</p>
      {i18n.language === "ja" && (
        <Link to="/blog/data-race-table-guide" className="drt-guide-link">
          📖 {t("dataTable.guideLink")} →
        </Link>
      )}
    </div>
  );
}

export default DataRaceTable;
