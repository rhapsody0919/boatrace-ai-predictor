import { useTranslation } from "react-i18next";
import BoatToggle from "./BoatToggle";
import { orderPoints } from "../../../utils/pastRate/count.js";
import { orderComboText } from "./format.js";

const K = "aiPredictionTab.pastRate.order";
const BOATS = [1, 2, 3, 4, 5, 6];

/**
 * 着順（spec FR-1）。1着は常に1艇。流さないときは押した艇に置き換わり、流すときは2着・3着を押すたびに
 * 入れ替える。同じ艇を別の着で選べる（点数には数えない）
 */
export default function OrderInput({ value, onChange }) {
  const { t } = useTranslation();
  const rows = [
    [1, value.first == null ? [] : [value.first]],
    [2, value.second],
    [3, value.third],
  ];
  const press = (row, boat) => {
    if (row === 1) return onChange({ ...value, first: boat });
    const key = row === 2 ? "second" : "third";
    const cur = value[key];
    const next = !value.nagashi
      ? [boat]
      : cur.includes(boat)
        ? cur.filter((b) => b !== boat)
        : [...cur, boat].sort((a, b) => a - b);
    onChange({ ...value, [key]: next });
  };
  const toggleNagashi = () =>
    onChange(
      value.nagashi
        ? {
            ...value,
            nagashi: false,
            second: value.second.slice(0, 1),
            third: value.third.slice(0, 1),
          }
        : { ...value, nagashi: true },
    );
  const ready = value.first != null && value.second.length && value.third.length;
  const points = ready ? orderPoints(value) : 0;
  return (
    <>
      {rows.map(([row, selected]) => (
        <div
          key={row}
          className="prc-row"
          role="group"
          aria-label={t(`${K}.rows.${row}`)}
        >
          <span className="prc-row-label" aria-hidden="true">
            {t(`${K}.rows.${row}`)}
          </span>
          <div className="prc-boats">
            {BOATS.map((b) => (
              <BoatToggle
                key={b}
                n={b}
                pressed={selected.includes(b)}
                onClick={() => press(row, b)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="prc-ctrl">
        <button
          type="button"
          className="prc-pill"
          aria-pressed={value.nagashi}
          onClick={toggleNagashi}
        >
          {t(`${K}.nagashi`)}
        </button>
        <button
          type="button"
          className="prc-pill"
          onClick={() =>
            onChange({ first: null, second: [], third: [], nagashi: value.nagashi })
          }
        >
          {t(`${K}.clear`)}
        </button>
        {ready ? (
          <span className="prc-points">
            {t(`${K}.points`, { combo: orderComboText(value), points })}
          </span>
        ) : null}
      </div>
    </>
  );
}
