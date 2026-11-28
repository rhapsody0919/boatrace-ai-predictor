/**
 * RaceBeforeInfoTab の「展示情報」表（6艇×指標）。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import TermHintButton from "./TermHintButton";
import ExhibitionPositionDots from "./ExhibitionPositionDots";

const cellClass = (boat, best) =>
  `drt-cell ${best?.has(boat) ? "drt-best" : ""}`;

function TurnMarkLabel({ row }) {
  // 末尾の1文字・※・? を束ねて、※と? だけが2行目に落ちないようにする
  return (
    <>
      <span className="drt-label-full">{row.label.slice(0, -3)}</span>
      <span className="drt-label-short">{row.shortLabel.slice(0, -3)}</span>
      <span className="drt-turn-tail">
        <span className="drt-label-full">{row.label.slice(-3)}</span>
        <span className="drt-label-short">{row.shortLabel.slice(-3)}</span>
        <TermHintButton termKey={row.key} />
      </span>
    </>
  );
}

// 指標名の長い形と短い形（幅で CSS が片方だけ見せる）
function LabelText({ row }) {
  return (
    <>
      <span className="drt-label-full">{row.label}</span>
      <span className="drt-label-short">{row.shortLabel}</span>
    </>
  );
}

function PlainLabel({ row, deepLink, onLinkClick }) {
  return (
    <>
      {row.tab ? (
        <Link
          to={deepLink(row.tab)}
          className="drt-label-link"
          onClick={onLinkClick(row.tab)}
        >
          <LabelText row={row} />
          <span className="drt-link-arrow">›</span>
        </Link>
      ) : (
        <LabelText row={row} />
      )}
      <TermHintButton termKey={row.key} />
    </>
  );
}

function TableHead({ sortedPlayers }) {
  return (
    <thead>
      <tr>
        <th className="drt-label-th"></th>
        {sortedPlayers.map((p) => {
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
    </thead>
  );
}

// 行の名の下の札（意味づけ 2026-11-26、承認のモック）。色を付けない理由を行ごとに言う。
// fact: 良し悪しの無い事実。bestOnly: 1位の金枠だけで、上位・下位で1着に差が出るとは確かめられていない
// （展示ST・直線。stat-findings.md 10行・27行で、上位・下位の効き目は確かめられていない）
const ROW_NOTE = {
  exhibitionCourse: "fact",
  exSt: "bestOnly",
  oriStraight: "bestOnly",
  todayWeight: "fact",
  tilt: "fact",
  adjustmentWeight: "fact",
  partsChanged: "fact",
};

function RowNote({ rowKey }) {
  const { t } = useTranslation();
  const note = ROW_NOTE[rowKey];
  if (!note) return null;
  return (
    <span className="drt-row-note" data-note={note}>
      {t(note === "fact" ? "beforeInfo.rowNoteFact" : "beforeInfo.rowNoteBestOnly")}
    </span>
  );
}

// 6艇の上位2・下位2の印（緑▲速い・赤▼遅い）と凡例は外した（plan.md §14、オーナー 2026-11-28 案A: 値だけ。
// 差の大きさは表の下の「6艇の位置」の図で見る。row.tiers はその図に出す行を選ぶのにだけ使う）
function TableRow({ row, sortedPlayers, deepLink, onLinkClick }) {
  return (
    <tr>
      <td className="drt-label-cell">
        {row.turnMark ? (
          <TurnMarkLabel row={row} />
        ) : (
          <PlainLabel row={row} deepLink={deepLink} onLinkClick={onLinkClick} />
        )}
        <RowNote rowKey={row.key} />
      </td>
      {sortedPlayers.map((p) => (
        <td
          key={p.number}
          className={`${cellClass(p.number, row.best)} ${row.cellClass?.(p) ?? ""}`}
        >
          {row.render(p)}
        </td>
      ))}
    </tr>
  );
}

export default function RaceBeforeInfoTabTable({
  sortedPlayers,
  rows,
  detailScroll,
  scrollRef,
  deepLink,
  onLinkClick,
}) {
  return (
    /* 6艇×多指標の表は390pxだと5号艇までで切れ、**6号艇が存在しない
        ように見える**（2026-09-27、ファン視点のレビューで実測）。
        切れていることが分かる手がかりを出す */
    <div className={`hscroll-hint${detailScroll.hasMore ? " has-more" : ""}`}>
      <HorizontalScrollButtons
        hasMore={detailScroll.hasMore}
        hasLess={detailScroll.hasLess}
        onMore={detailScroll.scrollRight}
        onLess={detailScroll.scrollLeft}
      />
      <div
        className="drt-table-wrapper"
        ref={scrollRef}
        onScroll={detailScroll.update}
      >
        <table className="drt-table">
          <TableHead sortedPlayers={sortedPlayers} />
          <tbody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                row={row}
                sortedPlayers={sortedPlayers}
                deepLink={deepLink}
                onLinkClick={onLinkClick}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ExhibitionPositionDots
        rows={rows
          .filter((row) => row.tiers?.size > 0)
          .map((row) => ({ key: row.key, label: row.shortLabel ?? row.label, values: row.values }))}
      />
    </div>
  );
}
