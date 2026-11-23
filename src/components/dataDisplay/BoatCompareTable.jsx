/**
 * 6艇を比べる表（docs/reference/design-system.md「表とグラフ」決まり2・3、オーナー 2026-11-23 承認）。
 * 正はレース詳細の出走表（DataRaceTable）。その表の部分をそのまま切り出した部品で、
 * 見た目のクラス（drt-*）と CSS（race/DataRaceTable.css）も出走表のものを引き継ぐ。
 *
 * - 艇を列・指標を行。艇番の見出しは BOAT_COLORS で塗り、見出しと左のラベルの列を固定する
 * - 行の最良（row.best、判定は src/pure/bestOf.js）は金の強調。6艇を比べる表だけで使う
 * - 選んだ艇（?boat=）の列を強調する（selectedBoat）。onSelectBoat を渡すと艇番の見出しが
 *   押せるボタンになり、同じ艇をもう一度押すと選択を外す（null）
 *
 * 行（rows）の形: { key, best?: Set<number>, render(player), cellClass?(player) }。
 * ラベルの列の中身は画面ごとに違う（深いリンク・用語の説明・注記）ので renderLabel で受け取る。
 * 選手名の2段目の見出しは renderName を渡したときだけ出す。
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
