import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * 上部の操作（screens S-1 2）: 時点・着順・タブ。着順は展開シナリオのタブでは出さない
 */
export default function AnalogyControls({
  stage,
  exhibitionReady,
  stageNote,
  onStage,
  target,
  onTarget,
  showTarget,
  tabs,
  tab,
  onTab,
  tabId,
}) {
  const { t } = useTranslation();
  const stageLabel = useId();
  const targetLabel = useId();
  const k = "aiPredictionTab.analogy";
  const onTabKey = (e) => {
    const i = tabs.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length]
        : e.key === "ArrowLeft"
          ? tabs[(i + tabs.length - 1) % tabs.length]
          : null;
    if (!next) return;
    e.preventDefault();
    onTab(next);
    document.getElementById(tabId(next))?.focus();
  };
  return (
    <>
      <div className="af-ctl-row">
        <span className="af-lbl" id={stageLabel}>
          {t(`${k}.stage.label`)}
        </span>
        <div className="af-seg" role="group" aria-labelledby={stageLabel}>
          <button
            type="button"
            aria-pressed={stage === "racecard"}
            onClick={() => onStage("racecard")}
          >
            {t(`${k}.stage.racecard`)}
          </button>
          <button
            type="button"
            aria-pressed={stage === "exhibition"}
            disabled={!exhibitionReady}
            onClick={() => onStage("exhibition")}
          >
            {t(`${k}.stage.exhibition`)}
          </button>
        </div>
      </div>
      {stageNote && <p className="af-foot">{stageNote}</p>}
      {showTarget && (
        <div className="af-ctl-row">
          <span className="af-lbl" id={targetLabel}>
            {t(`${k}.targetsLabel`)}
          </span>
          <div className="af-seg" role="group" aria-labelledby={targetLabel}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={target === n}
                onClick={() => onTarget(n)}
              >
                {t(`${k}.targets.${n}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="af-tabs"
        role="tablist"
        aria-label={t(`${k}.tabs.label`)}
        onKeyDown={onTabKey}
      >
        {tabs.map((name) => (
          <button
            key={name}
            id={tabId(name)}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${tabId(name)}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => onTab(name)}
          >
            {t(`${k}.tabs.${name}`)}
          </button>
        ))}
      </div>
    </>
  );
}
