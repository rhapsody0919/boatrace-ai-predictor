import { useTranslation } from "react-i18next";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  ENTRY_TYPES,
  MAE_SUB,
  MIN_SCENARIO,
} from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/**
 * ①進入はどうなる？（spec C-1、承認モック mock-scenario-v1）。型ごとに出現率（棒）と1号艇の1着率（30件未満は
 * 率を出さず件数と「—」）。列の見出しは上に1回だけ。展示後は今日の展示の型に札
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
    const share = total ? x.n / total : null;
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
          <i
            className="af-ent-bar"
            style={{ width: `${Math.max(2, (share ?? 0) * 44)}px` }}
            aria-hidden="true"
          />
          {fmtPct(share)}
        </span>
        <span className="af-ent-b1 af-num">
          {x.n >= MIN_SCENARIO ? (
            fmtPct(x.b1_win / x.n)
          ) : (
            <small>{t(`${k}.entryFew`, { n: fmtCount(x.n) })}</small>
          )}
        </span>
      </button>
    );
  };
  return (
    <div className="af-ents" data-af-control="entry_pattern">
      <div className="af-ent-head" aria-hidden="true">
        <span>{t(`${k}.entryColType`)}</span>
        <span>{t(`${k}.entryColShare`)}</span>
        <span>{t(`${k}.entryColB1`)}</span>
      </div>
      {ENTRY_TYPES.flatMap((e) =>
        e === "mae" && openMae
          ? [row(e), ...MAE_SUB.map((s) => row(s, true))]
          : [row(e)],
      )}
    </div>
  );
}
