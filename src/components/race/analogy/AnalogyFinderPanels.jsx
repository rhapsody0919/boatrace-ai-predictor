import { useTranslation } from "react-i18next";
import AnalogyControls, { AnalogyTabs } from "./AnalogyControls";
import ConditionFactsTab from "./ConditionFactsTab";
import SimilarRacesTab from "./SimilarRacesTab";
import ScenarioTab from "./ScenarioTab";
import DataSources from "./DataSources";
import { venueLabel } from "../../../utils/analogyFormat";
import { SONAR_TAB_IDS } from "../../../utils/raceUrlState";

const TABS = SONAR_TAB_IDS;
const SONAR_SECTION_ID = "ryujin-sonar";

/** 展示前の時点の札（screens「状態」）。展示後はボタン2つにする */
const STAGE_CHIP = {
  before_exhibition: "chipBefore",
  exhibition_reflecting: "chipReflecting",
};

function TabError({ onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="af-tab-error">
      <p className="af-warn">{t("aiPredictionTab.analogy.states.error")}</p>
      <button type="button" className="af-btn" onClick={onRetry}>
        {t("aiPredictionTab.analogy.states.retry")}
      </button>
    </div>
  );
}

function LoadingLine() {
  const { t } = useTranslation();
  return (
    <p className="af-v16-line">{t("aiPredictionTab.analogy.states.loading")}</p>
  );
}

function FactsPanel({ facts, stage, target, feedback }) {
  const { t } = useTranslation();
  if (facts.status === "error") return <TabError onRetry={facts.retry} />;
  if (facts.data?.today)
    return (
      <ConditionFactsTab
        data={facts.data}
        stage={stage}
        target={target}
        feedback={feedback}
      />
    );
  return (
    <p className="af-v16-line">
      {t("aiPredictionTab.analogy.states.notSaved")}
    </p>
  );
}

function SimilarPanel({ similar, facts, stage, target, feedback }) {
  if (similar.status === "error") return <TabError onRetry={similar.retry} />;
  if (similar.data && similar.status !== "loading")
    return (
      <SimilarRacesTab
        data={similar.data}
        stage={stage}
        target={target}
        exhibition={facts.data?.exhibition ?? null}
        feedback={feedback}
      />
    );
  return <LoadingLine />;
}

function ScenarioPanel({ scenario, facts, props }) {
  if (scenario.status === "error") return <TabError onRetry={scenario.retry} />;
  if (scenario.data && scenario.status !== "loading")
    return (
      <ScenarioTab
        data={scenario.data}
        today={facts.data?.today ?? null}
        {...props}
      />
    );
  return <LoadingLine />;
}

function SonarPanel({ tab, scenarioProps, scenario, similar, ...rest }) {
  if (tab === "facts") return <FactsPanel {...rest} />;
  if (tab === "similar") return <SimilarPanel similar={similar} {...rest} />;
  return (
    <ScenarioPanel
      scenario={scenario}
      facts={rest.facts}
      props={scenarioProps}
    />
  );
}

function SonarShell({ sectionRef, headingId, raceId, children }) {
  const { t } = useTranslation();
  const [, , , venueCode, raceNumber] = String(raceId).split("-");
  const heading = t("aiPredictionTab.analogy.heading", {
    venue: venueLabel(Number(venueCode), t),
    race: Number(raceNumber),
  });
  return (
    <section
      className="af-v16"
      id={SONAR_SECTION_ID}
      aria-labelledby={headingId}
      ref={sectionRef}
    >
      {/* 見出しはタブ名とページ上部のレース名で足りるので画面には出さない（承認モック v3）。読み上げ用に残す */}
      <h2 id={headingId} className="af-sr-only">
        {heading}
      </h2>
      <p className="af-v16-subtitle">{t("aiPredictionTab.analogy.subtitle")}</p>
      {children}
    </section>
  );
}

function SonarBody({
  tab,
  onTab,
  tabId,
  stage,
  status,
  exhibitionReady,
  onStage,
  target,
  onTarget,
  facts,
  similar,
  children,
}) {
  const anyPeriod = Object.values(facts.data?.facts ?? {})[0]?.period ?? null;
  return (
    <>
      <div className="af-tabs-sticky">
        <AnalogyTabs tabs={TABS} tab={tab} onTab={onTab} tabId={tabId} />
      </div>
      <AnalogyControls
        stage={stage}
        exhibitionReady={exhibitionReady}
        stageChipKey={STAGE_CHIP[status] ?? "chipBefore"}
        onStage={onStage}
        target={target}
        onTarget={onTarget}
        showTarget={tab !== "scenario"}
      />
      <div
        className="af-v16-box"
        role="tabpanel"
        id={`${tabId(tab)}-panel`}
        aria-labelledby={tabId(tab)}
      >
        {children}
      </div>
      <DataSources
        stage={stage}
        period={anyPeriod}
        conditions={similar.data?.similar?.conditions ?? null}
      />
    </>
  );
}

export { SonarPanel, SonarShell, SonarBody };
