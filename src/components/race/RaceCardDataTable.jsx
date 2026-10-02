/**
 * RaceCardDataTable - レース一覧カード内のミニ出走表
 * 勝率・当地・モーターの3行はentries（一覧APIレスポンス）だけで表示でき、
 * 追加のデータ取得は発生しない。折りたたみを開いた時だけそのレースの
 * useRaceAnalysisDataを取得し、残りの行（調子〜単勝回収率、チルト・調整重量含む）を表示する。
 * 行定義はDataRaceTableと同じraceIndicators.jsxのbuildIndicatorRowsを共有する。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { buildIndicatorRows } from "./raceIndicators";
import InlineFetchError from "../InlineFetchError";
import { splitRacerName } from "../../utils/racerName";
import "./RaceCardDataTable.css";

const ALWAYS_VISIBLE_KEYS = ["winRate", "localWinRate", "motor"];

function RaceCardDataTable({ raceId, players }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // expanded=falseの間はraceIdの代わりにnullを渡し、フックの呼び出し順は
  // 保ったままデータ取得だけを遅延させる（useRaceAnalysisDataはraceId無しなら
  // 内部のuseEffectが何もしないため、フェッチが発生しない）
  const analysis = useRaceAnalysisData(expanded ? raceId : null);

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  if (sortedPlayers.length === 0) return null;

  const rows = buildIndicatorRows({
    t,
    players: sortedPlayers,
    analysis,
    pending: analysis.pending,
  });
  const alwaysRows = rows.filter((r) => ALWAYS_VISIBLE_KEYS.includes(r.key));
  const collapsedRows = rows.filter(
    (r) => !ALWAYS_VISIBLE_KEYS.includes(r.key),
  );

  const cellClass = (boat, best) =>
    `rcdt-cell ${best?.has(boat) ? "rcdt-best" : ""}`;

  const renderRows = (list) =>
    list.map((row) => (
      <tr key={row.key}>
        <td className="rcdt-label-cell">{row.shortLabel}</td>
        {sortedPlayers.map((p) => (
          <td key={p.number} className={cellClass(p.number, row.best)}>
            {row.render(p)}
          </td>
        ))}
      </tr>
    ));

  return (
    <div className="rcdt" onClick={(e) => e.stopPropagation()}>
      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}
      <div className="rcdt-table-wrapper">
        <table className="rcdt-table">
          <thead>
            <tr>
              <th className="rcdt-label-th"></th>
              {sortedPlayers.map((p) => {
                const color = BOAT_COLORS[p.number] || {};
                return (
                  <th
                    key={p.number}
                    className="rcdt-boat-th"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {p.number}
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="rcdt-label-th"></th>
              {sortedPlayers.map((p) => (
                <th key={p.number} className="rcdt-name-th" translate="no">
                  {/* 姓と名を別の塊にして、折り返すなら境目で折る。1つの文字列だと
                      「小森信/雄」のように名前の途中で折れ、姓名の区切りを読み違える
                      （出走表の名前は姓と名の間を全角スペースで詰めてある。BOA-559） */}
                  {splitRacerName(p.name).map((part, i) => (
                    <span key={i} className="rcdt-name-part">
                      {part}
                    </span>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{renderRows(alwaysRows)}</tbody>
        </table>
      </div>

      <button
        type="button"
        className="rcdt-expand-btn"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {t("raceCard.dataTableExpand")}
        <span className={`rcdt-chevron ${expanded ? "rcdt-chevron-open" : ""}`}>
          ▾
        </span>
      </button>

      {expanded && (
        <div className="rcdt-table-wrapper">
          <table className="rcdt-table">
            <tbody>{renderRows(collapsedRows)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RaceCardDataTable;
