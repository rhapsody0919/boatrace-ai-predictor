import { useTranslation } from "react-i18next";
import SlitShapeIcon from "./SlitShapeIcon";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  SLIT_EXAMPLE,
  SLIT_FORMS,
} from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/** 形の割合・件数・1号艇の1着率の1行（30件未満は1着率を出さない） */
function useStat(forms) {
  const { t } = useTranslation();
  const inEntry = forms.any.n;
  return (f) => {
    const x = forms[f];
    const b1 =
      x.n >= MIN_SCENARIO ? fmtPct(x.b1_win / x.n) : t(`${k}.slitNoRate`);
    return f === "any" || inEntry < MIN_SCENARIO
      ? t(`${k}.slitStatAny`, { n: fmtCount(x.n), b1 })
      : t(`${k}.slitStat`, {
          p: fmtPct(inEntry ? x.n / inEntry : null),
          n: fmtCount(x.n),
          b1,
        });
  };
}

/**
 * ②スタートはどう並ぶ？（spec C-3、承認モック mock-scenario-v1）。凡例は格子の上に1回、「どの形でも」は横幅いっぱい、
 * 7つの形は2列の格子（絵は小さく）。手がかりの札と今日の展示の札
 * @param {{forms: object, slit: string, onSlit: (f: string) => void, badges: Record<string, object>,
 *   todayForms?: string[]}} props forms は選んだ進入の cells[entry].forms
 */
export default function SlitShapePicker({
  forms,
  slit,
  onSlit,
  badges,
  todayForms = [],
}) {
  const { t } = useTranslation();
  const stat = useStat(forms);
  return (
    <>
      <p className="af-pat-legend">
        <span>┃ {t(`${k}.slitLine`)}</span>
        <span>├┤ {t(`${k}.slitScale`)}</span>
        <span>{t(`${k}.slitB1Legend`)}</span>
      </p>
      <div className="af-pats" data-af-control="slit_shape">
        {["any", ...SLIT_FORMS].map((f) => (
          <button
            key={f}
            id={`af-pat-${f}`}
            type="button"
            className={`af-pat${f === "any" ? " is-any" : ""}`}
            aria-pressed={slit === f}
            onClick={() => onSlit(f)}
          >
            {f !== "any" && (
              <SlitShapeIcon st={SLIT_EXAMPLE[f]} height={72} compact />
            )}
            <span className="af-pat-k">{t(`${k}.forms.${f}.name`)}</span>
            <span className="af-pat-fq af-num">{stat(f)}</span>
            {(badges[f] || todayForms.includes(f)) && (
              <span className="af-pat-tags">
                {badges[f] && (
                  <span className="af-hintb">{t(`${k}.hintBadge`)}</span>
                )}
                {todayForms.includes(f) && (
                  <span className="af-today-badge">{t(`${k}.todayExh`)}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * ②で形を選んだ後の1行（承認モック mock-scenario-v1: ②を畳み、③が②のすぐ下に来る）。「変える」で②を開く
 * @param {{forms: object, slit: string, onChange: () => void}} props
 */
export function SlitChosen({ forms, slit, onChange }) {
  const { t } = useTranslation();
  const stat = useStat(forms);
  return (
    <div className="af-pat-chosen" data-testid="analogy-slit-chosen">
      <span className="af-pat-chosen-ico">
        <SlitShapeIcon st={SLIT_EXAMPLE[slit]} height={56} compact />
      </span>
      <span className="af-pat-chosen-t">
        <b>{t(`${k}.forms.${slit}.name`)}</b>
        <span className="af-num">{stat(slit)}</span>
      </span>
      <button
        type="button"
        className="af-btn af-pat-change"
        aria-expanded="false"
        onClick={onChange}
      >
        {t(`${k}.slitChange`)}
      </button>
    </div>
  );
}
