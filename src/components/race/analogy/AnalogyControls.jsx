import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * 上部の操作（承認モック sonar-tab v3）。内部タブ（差がつく材料／類似レース／展開シナリオ）は一番上に置いて
 * 下に送っても固定し、着順と時点はその下の1つの小さな箱にまとめる。
 * 時点は展示前は押せる先が1つしかないので、ボタンではなく1行の札にする（展示後はボタン2つ）
 */
export function AnalogyTabs({ tabs, tab, onTab, tabId }) {
  const { t } = useTranslation();
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
  );
}

export default function AnalogyControls({
  stage,
  exhibitionReady,
  stageChipKey,
  onStage,
  target,
  onTarget,
  showTarget,
}) {
  const { t } = useTranslation();
  const stageLabel = useId();
  const targetLabel = useId();
  const k = "aiPredictionTab.analogy";
  return (
    <div className="af-ctl-box">
      {showTarget && (
        <div className="af-ctl-row">
          <span className="af-lbl" id={targetLabel}>
            {t(`${k}.targetsLabel`)}
          </span>
          <div
            className="af-seg"
            role="group"
            aria-labelledby={targetLabel}
            data-af-control="target"
          >
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
      {exhibitionReady ? (
        <div className="af-ctl-row">
          <span className="af-lbl" id={stageLabel}>
            {t(`${k}.stage.label`)}
          </span>
          <div
            className="af-seg"
            role="group"
            aria-labelledby={stageLabel}
            data-af-control="stage"
          >
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
              onClick={() => onStage("exhibition")}
            >
              {t(`${k}.stage.exhibition`)}
            </button>
          </div>
        </div>
      ) : (
        <p className="af-stage-chip" data-testid="analogy-stage-chip">
          {t(`${k}.stage.${stageChipKey}`)}
        </p>
      )}
    </div>
  );
}
