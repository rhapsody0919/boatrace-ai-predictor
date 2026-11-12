/**
 * RaceBeforeInfoTab の「展示情報」表（6艇×指標）。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { Link } from "react-router-dom";
import { BOAT_COLORS } from "../../utils/colors";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import TermHintButton from "./TermHintButton";

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

function TableRow({ row, sortedPlayers, deepLink, onLinkClick }) {
  return (
    <tr>
      <td className="drt-label-cell">
        {row.turnMark ? (
          <TurnMarkLabel row={row} />
        ) : (
          <PlainLabel row={row} deepLink={deepLink} onLinkClick={onLinkClick} />
        )}
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
    </div>
  );
}
