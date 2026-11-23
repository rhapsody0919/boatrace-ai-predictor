/**
 * RaceCardDataTable - レース一覧カード内のミニ出走表
 * 勝率・当地・モーターの3行はentries（一覧APIレスポンス）だけで表示でき、
 * 追加のデータ取得は発生しない。折りたたみを開いた時だけそのレースの
 * useRaceAnalysisDataを取得し、残りの行（調子〜単勝回収率、チルト・調整重量含む）を同じ表の2つ目の tbody に表示する。
 * 行定義はDataRaceTableと同じraceIndicators.jsxのbuildIndicatorRowsを共有する。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { buildIndicatorRows } from "./raceIndicators";
import InlineFetchError from "../InlineFetchError";
import { sortPlayers, partitionRows } from "./RaceCardDataTableLogic";
import { RcdtHead, RcdtRows } from "./RaceCardDataTableParts";
import "./RaceCardDataTable.css";

function RaceCardDataTable({ raceId, players, linkRacerNames = false }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // expanded=falseの間はraceIdの代わりにnullを渡し、フックの呼び出し順は
  // 保ったままデータ取得だけを遅延させる（useRaceAnalysisDataはraceId無しなら
  // 内部のuseEffectが何もしないため、フェッチが発生しない）
  const analysis = useRaceAnalysisData(expanded ? raceId : null);

  const sortedPlayers = sortPlayers(players);
  if (sortedPlayers.length === 0) return null;

  const rows = buildIndicatorRows({
    t,
    players: sortedPlayers,
    analysis,
    pending: analysis.pending,
  });
  const { alwaysRows, collapsedRows } = partitionRows(rows);

  return (
    <div className="rcdt" onClick={(e) => e.stopPropagation()}>
      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}
      <div className="rcdt-table-wrapper">
        <table className="rcdt-table">
          <RcdtHead
            sortedPlayers={sortedPlayers}
            linkRacerNames={linkRacerNames}
          />
          <tbody>
            <RcdtRows list={alwaysRows} sortedPlayers={sortedPlayers} />
          </tbody>
          {/* 開いた行も同じ表に置き、列の幅を見出し（艇番）と共有する。別の表にすると列の幅が
              中身で決まり、展示ST 等が隣の艇の列の下に出て、6号艇の列が枠の外へ切れた（2026-11-23 ファン評価 P0） */}
          {expanded && (
            <tbody className="rcdt-collapsed-rows">
              <RcdtRows list={collapsedRows} sortedPlayers={sortedPlayers} />
            </tbody>
          )}
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
    </div>
  );
}

export default RaceCardDataTable;
