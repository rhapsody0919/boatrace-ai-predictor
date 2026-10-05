import { useTranslation } from "react-i18next";
import SlitShapeIcon from "./SlitShapeIcon";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  SLIT_EXAMPLE,
  SLIT_FORMS,
} from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/**
 * ②スタートはどう並ぶ？（spec C-3）。「どの形でも」と7つの形。各形に絵・割合・件数・1号艇の1着率、手がかりの札
 * @param {{forms: object, slit: string, onSlit: (f: string) => void, badges: Record<string, object>}} props
 *   forms は選んだ進入の cells[entry].forms
 */
export default function SlitShapePicker({ forms, slit, onSlit, badges }) {
  const { t } = useTranslation();
  const inEntry = forms.any.n;
  return (
    <div className="af-pats">
      {["any", ...SLIT_FORMS].map((f) => {
        const x = forms[f];
        const badge = badges[f];
        return (
          <button
            key={f}
            id={`af-pat-${f}`}
            type="button"
            className={`af-pat${f === "any" ? " is-any" : ""}`}
            aria-pressed={slit === f}
            onClick={() => onSlit(f)}
          >
            <span className="af-pat-k">
              {t(`${k}.forms.${f}.name`)}
              {badge && <span className="af-hintb">{t(`${k}.hintBadge`)}</span>}
            </span>
            {f !== "any" && <SlitShapeIcon st={SLIT_EXAMPLE[f]} />}
            <span className="af-pat-fq">
              {f === "any" || inEntry < MIN_SCENARIO
                ? t("aiPredictionTab.analogy.count", { n: fmtCount(x.n) })
                : t(`${k}.shareCount`, {
                    p: fmtPct(inEntry ? x.n / inEntry : null),
                    n: fmtCount(x.n),
                  })}
              {x.n >= MIN_SCENARIO &&
                `${t("aiPredictionTab.analogy.listSeparator")}${t(`${k}.b1Win`, { p: fmtPct(x.b1_win / x.n) })}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
