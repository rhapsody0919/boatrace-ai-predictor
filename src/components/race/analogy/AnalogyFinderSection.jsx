/**
 * アナロジー・ファインダー節（BOA-271 v16、承認版モック Version 16。screens S-1）。
 * レース詳細の AI予想タブの既存ブロックの下に置く（RaceAiPredictionTab の PredictionBlocks の外）。
 *
 * 上部の操作（時点・着順・タブ）と3タブ（差がつく材料・類似レース・展開シナリオ）、下部の「使っている項目」。
 * 節全体の状態（欠場・保存なし）は facts の応答の status で決める（画面は時刻で判定しない。plan「API」）。
 * facts・scenario は展示後の値（exhibition）も一緒に返すので stage=exhibition で1回だけ読み、時点の切り替えは
 * 画面で行う。類似レースは時点ごとに並びが違うので時点ごとに読む。タブ2・3は開いたときに初めて読む。
 * 選んだタブ・艇番・時点・着順は URL にも localStorage にも残さない（spec「やらないこと」）。
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import AnalogyControls from "./AnalogyControls";
import ConditionFactsTab from "./ConditionFactsTab";
import SimilarRacesTab from "./SimilarRacesTab";
import ScenarioTab from "./ScenarioTab";
import DataSources from "./DataSources";
import {
  useAnalogyFacts,
  useAnalogyScenario,
  useAnalogySimilar,
} from "../../../hooks/useAnalogyV16";
import { venueLabel } from "../../../utils/analogyFormat";
import "./AnalogyV16.css";

const TABS = ["facts", "similar", "scenario"];

/** 時点の切り替えの下の1行（screens「状態」） */
const STAGE_NOTE = {
  before_exhibition: "noteBefore",
  exhibition_reflecting: "noteReflecting",
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

export default function AnalogyFinderSection({ raceId }) {
  const { t } = useTranslation();
  const headingId = useId();
  const tabsId = useId();
  const [stageChoice, setStageChoice] = useState(null);
  const [target, setTarget] = useState(1);
  const [tab, setTab] = useState("facts");
  const [opened, setOpened] = useState({ facts: true });
  const [scenarioScope, setScenarioScope] = useState(null);

  const facts = useAnalogyFacts(raceId, "exhibition");
  const status = facts.data?.status ?? null;
  const exhibitionReady = status === "exhibition_ready";
  const stage = exhibitionReady ? (stageChoice ?? "exhibition") : "racecard";
  const similar = useAnalogySimilar(raceId, stage, Boolean(opened.similar));
  const scenario = useAnalogyScenario(
    raceId,
    scenarioScope,
    "exhibition",
    Boolean(opened.scenario),
  );

  const [, , , venueCode, raceNumber] = String(raceId).split("-");
  const heading = t("aiPredictionTab.analogy.heading", {
    venue: venueLabel(Number(venueCode), t),
    race: Number(raceNumber),
  });
  const wrap = (body) => (
    <section className="af-v16" aria-labelledby={headingId}>
      <h2 id={headingId} className="af-v16-eyebrow">
        {heading}
      </h2>
      {body}
    </section>
  );

  // 節全体の状態は、タブごとの取得の失敗より優先する（screens「細部の約束」）
  if (status === "absent" || status === "not_saved")
    return wrap(
      <p className="af-v16-box af-v16-line">
        {t(
          `aiPredictionTab.analogy.states.${status === "absent" ? "absent" : "notSaved"}`,
        )}
      </p>,
    );
  if (facts.status === "loading" && !facts.data)
    return wrap(
      <p className="af-v16-box af-v16-line">
        {t("aiPredictionTab.analogy.states.loading")}
      </p>,
    );

  const selectTab = (next) => {
    setTab(next);
    setOpened((o) => ({ ...o, [next]: true }));
  };
  const tabId = (name) => `${tabsId}-${name}`;
  let panel;
  if (tab === "facts")
    panel =
      facts.status === "error" ? (
        <TabError onRetry={facts.retry} />
      ) : facts.data?.today ? (
        <ConditionFactsTab data={facts.data} stage={stage} target={target} />
      ) : (
        <p className="af-v16-line">
          {t("aiPredictionTab.analogy.states.notSaved")}
        </p>
      );
  else if (tab === "similar")
    panel =
      similar.status === "error" ? (
        <TabError onRetry={similar.retry} />
      ) : similar.data && similar.status !== "loading" ? (
        <SimilarRacesTab
          data={similar.data}
          stage={stage}
          target={target}
          exhibition={facts.data?.exhibition ?? null}
        />
      ) : (
        <p className="af-v16-line">
          {t("aiPredictionTab.analogy.states.loading")}
        </p>
      );
  else
    panel =
      scenario.status === "error" ? (
        <TabError onRetry={scenario.retry} />
      ) : scenario.data && scenario.status !== "loading" ? (
        <ScenarioTab
          data={scenario.data}
          stage={stage}
          onScope={setScenarioScope}
          today={facts.data?.today ?? null}
          raceId={raceId}
        />
      ) : (
        <p className="af-v16-line">
          {t("aiPredictionTab.analogy.states.loading")}
        </p>
      );

  const noteKey = !exhibitionReady ? STAGE_NOTE[status] : null;
  const anyPeriod = Object.values(facts.data?.facts ?? {})[0]?.period ?? null;
  return wrap(
    <>
      <div className="af-v16-box">
        <AnalogyControls
          stage={stage}
          exhibitionReady={exhibitionReady}
          stageNote={
            noteKey ? t(`aiPredictionTab.analogy.stage.${noteKey}`) : null
          }
          onStage={setStageChoice}
          target={target}
          onTarget={setTarget}
          showTarget={tab !== "scenario"}
          tabs={TABS}
          tab={tab}
          onTab={selectTab}
          tabId={tabId}
        />
      </div>
      <div
        className="af-v16-box"
        role="tabpanel"
        id={`${tabId(tab)}-panel`}
        aria-labelledby={tabId(tab)}
      >
        {panel}
      </div>
      <DataSources
        stage={stage}
        period={anyPeriod}
        conditions={similar.data?.similar?.conditions ?? null}
      />
    </>,
  );
}
