/**
 * 6艇を比べる表（design-system.md「表とグラフ」決まり2・3、オーナー 2026-11-23 承認）。正の出走表（DataRaceTable）の
 * 表の部分を切り出した部品で、クラス（drt-*）と CSS も出走表のものを引き継ぐ。艇を列・指標を行、行の最良は金、
 * 選んだ艇（selectedBoat）の列を強調。onSelectBoat を渡すと艇番の見出しが押せる（同じ艇をもう一度押すと null）。
 * 行: { key, best?, render(player), cellClass?(player) }。ラベルの列は renderLabel、名前の2段目は renderName。
 */
import { BOAT_COLORS } from "../../utils/colors";
import "../race/DataRaceTable.css";

const selectedClass = (boat, selectedBoat) =>
  boat === selectedBoat ? " drt-selected" : "";

function BoatHeaderCell({ number, selectedBoat, onSelectBoat }) {
  const color = BOAT_COLORS[number] || {};
  const selected = number === selectedBoat;
  return (
    <th
      className={`drt-boat-th${selectedClass(number, selectedBoat)}`}
      style={{ background: color.bg, color: color.text }}
    >
      {onSelectBoat ? (
        <button
          type="button"
          className="drt-boat-select"
          aria-pressed={selected}
          onClick={() => onSelectBoat(selected ? null : number)}
        >
          {number}
        </button>
      ) : (
        number
      )}
    </th>
  );
}

export default function BoatCompareTable({
  players,
  rows,
  renderLabel,
  renderName,
  selectedBoat = null,
  onSelectBoat,
}) {
  return (
    <table className="drt-table">
      <thead>
        <tr>
          <th className="drt-label-th"></th>
          {players.map((p) => (
            <BoatHeaderCell
              key={p.number}
              number={p.number}
              selectedBoat={selectedBoat}
              onSelectBoat={onSelectBoat}
            />
          ))}
        </tr>
        {renderName && (
          <tr>
            <th className="drt-label-th"></th>
            {players.map((p) => (
              <th
                key={p.number}
                className={`drt-name-th${selectedClass(p.number, selectedBoat)}`}
              >
                {renderName(p)}
              </th>
            ))}
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="drt-label-cell">{renderLabel(row)}</td>
            {players.map((p) => (
              <td
                key={p.number}
                className={`drt-cell${row.best?.has(p.number) ? " drt-best" : ""}${selectedClass(p.number, selectedBoat)}${row.cellClass ? ` ${row.cellClass(p)}` : ""}`}
              >
                {row.render(p)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
