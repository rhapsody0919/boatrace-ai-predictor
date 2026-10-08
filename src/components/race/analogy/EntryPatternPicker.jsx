import { useTranslation } from "react-i18next";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  ENTRY_TYPES,
  MAE_SUB,
  MIN_SCENARIO,
} from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/**
 * ①進入はどうなる？（spec C-1）。型ごとに出現率と1号艇の1着率（30件未満は率を出さない）。展示後は今日の展示の型に印
 * @param {{cells: object, entry: string, onEntry: (e: string) => void, todayEntry: string|null}} props
 */
export default function EntryPatternPicker({
  cells,
  entry,
  onEntry,
  todayEntry,
}) {
  const { t } = useTranslation();
  const total = cells.all.forms.any.n;
  const openMae = entry === "mae" || MAE_SUB.includes(entry);
  const row = (e, sub = false) => {
    const x = cells[e].forms.any;
    const today =
      todayEntry &&
      (e === todayEntry || (e === "mae" && MAE_SUB.includes(todayEntry)));
    return (
      <button
        key={e}
        type="button"
        className={`af-ent${sub ? " is-sub" : ""}`}
        aria-pressed={entry === e}
        onClick={() => onEntry(e)}
      >
        <span>
          {t(`${k}.entry.${e}`)}
          {today && (
            <span className="af-today-badge">{t(`${k}.todayExh`)}</span>
          )}
        </span>
        <span className="af-num af-ent-sh">
          {fmtPct(total ? x.n / total : null)}
        </span>
        <span className="af-ent-b1">
          {x.n >= MIN_SCENARIO
            ? t(`${k}.b1Win`, { p: fmtPct(x.b1_win / x.n) })
            : t(`${k}.fewRate`, { n: fmtCount(x.n) })}
        </span>
      </button>
    );
  };
  return (
    <div className="af-ents" data-af-control="entry_pattern">
      {ENTRY_TYPES.flatMap((e) =>
        e === "mae" && openMae
          ? [row(e), ...MAE_SUB.map((s) => row(s, true))]
          : [row(e)],
      )}
    </div>
  );
}
