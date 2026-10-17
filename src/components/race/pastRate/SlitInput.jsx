/**
 * スリットの入力（spec FR-1「スリットの判定」、確定モック v3、画面差分 D1・D2・D7）。
 * 7形から2つまで（3形目で最も古い形が外れる）、強さ2段（横一線・内3艇そろうだけなら隠して1段目に戻す）、
 * 定義から同時に起きない形は押せない、または「自分で作る」（各コース 指定なし→出る→凹む）
 */
import { useTranslation } from "react-i18next";
import SlitShapeIcon from "../analogy/SlitShapeIcon";
import {
  PAST_RATE_SLIT_EXAMPLE,
  SLIT_FORMS,
} from "../../../utils/analogyScenario.js";
import {
  incompatibleForms,
  levelBlocked,
} from "../../../utils/pastRate/count.js";
import {
  SLIT_RATES,
  SLIT_RATE_SOURCE,
} from "../../../utils/pastRate/slitRates.js";

const K = "aiPredictionTab.pastRate.slit";
const LEVEL_FREE = new Set(["flat", "wall"]);
const NEXT_STATE = { 0: 1, 1: -1, "-1": 0 };
// 強さの見本（2コースが内の2艇より遅れる差）
const LEVEL_DEMO = { 1: [0, 0.05, 0, 0, 0, 0], 2: [0, 0.08, 0, 0, 0, 0] };

const hidesLevel = (patterns) =>
  patterns.length > 0 && patterns.every((p) => LEVEL_FREE.has(p));

export default function SlitInput({ value, onChange }) {
  const { t, i18n } = useTranslation();

  if (value.mode === "custom") {
    // 絵: 凹むは0.06秒遅く、出るは0.04秒早く（モックの見せ方）
    const scene = value.courses.map((s) =>
      s === -1 ? 0.06 : s === 1 ? -0.04 : 0,
    );
    return (
      <>
        <div className="prc-scene">
          <SlitShapeIcon st={scene} height={150} />
        </div>
        <div className="prc-boats">
          {value.courses.map((s, i) => (
            <button
              key={i}
              type="button"
              className="prc-boat prc-boat-custom"
              aria-label={t(`${K}.courseState`, {
                course: i + 1,
                state: t(`${K}.states.${s}`),
              })}
              onClick={() =>
                onChange({
                  ...value,
                  courses: value.courses.map((x, j) =>
                    j === i ? NEXT_STATE[String(x)] : x,
                  ),
                })
              }
            >
              {i + 1}
              <span className="prc-boat-state">{t(`${K}.states.${s}`)}</span>
            </button>
          ))}
        </div>
        <p className="prc-note">{t(`${K}.customNote`)}</p>
        <div className="prc-ctrl">
          <button
            type="button"
            className="prc-pill"
            onClick={() => onChange({ ...value, mode: "pattern" })}
          >
            {t(`${K}.backToForms`)}
          </button>
        </div>
      </>
    );
  }

  const { patterns, level } = value;
  const blocked = new Set(incompatibleForms(patterns, level));
  const press = (f) => {
    const next = patterns.includes(f)
      ? patterns.filter((p) => p !== f)
      : [...patterns, f].slice(-2);
    onChange({ ...value, patterns: next, level: hidesLevel(next) ? 1 : level });
  };
  const showLevel = !hidesLevel(patterns);
  return (
    <>
      <p className="prc-note">{t(`${K}.lede`)}</p>
      <p className="prc-note">
        {t(`${K}.rateSource`, {
          from: SLIT_RATE_SOURCE.from,
          to: SLIT_RATE_SOURCE.to,
          // 「万」で数える言語（ja・zh-TW・ko）は万の単位、en はそのままの件数
          races: i18n.language?.startsWith("en")
            ? SLIT_RATE_SOURCE.races.toLocaleString("en-US")
            : (SLIT_RATE_SOURCE.races / 10000).toFixed(1),
        })}
      </p>
      <div className="prc-forms">
        {SLIT_FORMS.map((f) => {
          const disabled = blocked.has(f);
          return (
            <button
              key={f}
              type="button"
              className="prc-form"
              aria-pressed={patterns.includes(f)}
              disabled={disabled}
              onClick={() => press(f)}
            >
              <span className="prc-form-head">
                <span className="prc-form-name">{t(`${K}.forms.${f}`)}</span>
                <span className="prc-form-rate">
                  {t(`${K}.rate`, { p: SLIT_RATES[level][f].toFixed(1) })}
                </span>
              </span>
              <SlitShapeIcon
                st={PAST_RATE_SLIT_EXAMPLE[level][f]}
                height={120}
              />
              {disabled && (
                <span className="prc-note">{t(`${K}.incompatible`)}</span>
              )}
            </button>
          );
        })}
      </div>
      {showLevel && (
        <>
          <p className="prc-note">{t(`${K}.levelTitle`)}</p>
          <div className="prc-levels">
            {[1, 2].map((lv) => (
              <button
                key={lv}
                type="button"
                className="prc-level"
                aria-pressed={level === lv}
                disabled={lv === 2 && levelBlocked(patterns)}
                onClick={() => onChange({ ...value, level: lv })}
              >
                <SlitShapeIcon st={LEVEL_DEMO[lv]} height={60} compact />
                <span>{t(`${K}.levels.${lv}.main`)}</span>
                <span className="prc-level-sub">
                  {t(`${K}.levels.${lv}.sub`)}
                </span>
              </button>
            ))}
          </div>
          {patterns.includes("kado") && (
            <p className="prc-note">{t(`${K}.kadoNote`)}</p>
          )}
        </>
      )}
      <p className="prc-note">{t(`${K}.boatLengthNote`)}</p>
      <div className="prc-ctrl">
        <button
          type="button"
          className="prc-pill"
          onClick={() => onChange({ ...value, mode: "custom" })}
        >
          {t(`${K}.custom`)}
        </button>
      </div>
    </>
  );
}
