import { Link } from "react-router-dom";
import { racerPagePath } from "../../utils/racerPagePath";
import { BOAT_COLORS } from "../../utils/colors";
import { splitRacerName } from "../../utils/racerName";
import { cellClass } from "./RaceCardDataTableLogic";

const nameParts = (name) =>
  splitRacerName(name).map((part, i) => (
    <span key={i} className="rcdt-name-part">
      {part}
    </span>
  ));

export function RcdtHead({ sortedPlayers, linkRacerNames }) {
  return (
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
            {linkRacerNames && p.racerId ? (
              <Link to={racerPagePath(p.racerId)} translate="no">
                {nameParts(p.name)}
              </Link>
            ) : (
              nameParts(p.name)
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function RcdtRows({ list, sortedPlayers }) {
  return list.map((row) => (
    <tr key={row.key}>
      <td className="rcdt-label-cell">{row.shortLabel}</td>
      {sortedPlayers.map((p) => (
        <td key={p.number} className={cellClass(p.number, row.best)}>
          {row.render(p)}
        </td>
      ))}
    </tr>
  ));
}
