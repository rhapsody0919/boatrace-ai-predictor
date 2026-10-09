/**
 * 龍神ソナー（BOA-271 v16、承認版モック Version 16。screens S-1）。
 * レース詳細の独立したタブ「龍神ソナー」の中身（基本情報と AI予想の間。2026-10-08 に AI予想タブの下から移した。
 * 承認モック docs/design/analogy-finder/mock/APPROVED.md の「龍神ソナーの別タブ化」）。
 *
 * 上から副題、内部タブ（差がつく材料・類似レース・展開シナリオ。下に送っても固定）、着順と時点の箱、中身、
 * 一番下に「使っている項目」。画面の中の声は各内部タブの中身の終わり（折りたたみより上）に置く。
 * 節全体の状態（欠場・保存なし）は facts の応答の status で決める（画面は時刻で判定しない。plan「API」）。
 * facts・scenario は展示後の値（exhibition）も一緒に返すので stage=exhibition で1回だけ読み、時点の切り替えは
 * 画面で行う。類似レースは時点ごとに並びが違うので時点ごとに読む。タブ2・3は開いたときに初めて読む。
 * 選んだタブ・艇番・時点・着順は URL にも localStorage にも残さない（spec「やらないこと」）。
 * ただし投稿などから内部タブへ直接来られるよう、?sonar=facts|similar|scenario を開いたときに1回だけ読む
 * （読むだけで、押しても URL は書き換えない。2026-10-08 D3）。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import AnalogyControls, { AnalogyTabs } from "./AnalogyControls";
import AnalogyFeedback from "./AnalogyFeedback";
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
import { markAnalogySeen, trackEvent } from "../../../utils/analytics";
import {
  RACE_SONAR_PARAM,
  SONAR_TAB_IDS,
  parseSonarParam,
} from "../../../utils/raceUrlState";
import "./AnalogyV16.css";

const TABS = SONAR_TAB_IDS;
const SONAR_SECTION_ID = "ryujin-sonar";

// レースごとに1回だけにするための記録。RaceTabs は選んでいないタブの中身を外して作り直すので、
// コンポーネントの ref ではほかのタブから戻るたびに送り直してしまう（別タブにした 2026-10-08 から）
const viewedRaces = new Set();
const visibleRaces = new Set();
// ?sonar= を使い終えたレース。ほかのタブから戻るたびに内部タブを選び直さないため
const linkUsedRaces = new Set();

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

export default function AnalogyFinderSection({ raceId }) {
  const { t } = useTranslation();
  const headingId = useId();
  const tabsId = useId();
  const [stageChoice, setStageChoice] = useState(null);
  const [target, setTarget] = useState(1);
  const [searchParams] = useSearchParams();
  // 1回目の描画で決める（使い終えた印は描画の後に付ける）
  const [linkedTab] = useState(() =>
    linkUsedRaces.has(raceId)
      ? null
      : parseSonarParam(searchParams.get(RACE_SONAR_PARAM)),
  );
  useEffect(() => {
    if (linkedTab) linkUsedRaces.add(raceId);
  }, [linkedTab, raceId]);
  const [tab, setTab] = useState(linkedTab ?? "facts");
  const [opened, setOpened] = useState({
    facts: true,
    ...(linkedTab && { [linkedTab]: true }),
  });
  const [scenarioScope, setScenarioScope] = useState(null);

  const facts = useAnalogyFacts(raceId, "exhibition");
  const status = facts.data?.status ?? null;
  const exhibitionReady = status === "exhibition_ready";
  const stage = exhibitionReady ? (stageChoice ?? "exhibition") : "racecard";
  // 節の中身（facts）が出たら、レースごとに1回だけ「表示した」を送る（公開時の最小限の計測）
  const factsReady = Boolean(facts.data?.today);
  useEffect(() => {
    if (!factsReady || viewedRaces.has(raceId)) return;
    viewedRaces.add(raceId);
    trackEvent("analogy_section_view", {
      race_id: raceId,
      analogy_stage: stage,
    });
  }, [factsReady, raceId, stage]);
  // 節が画面に入ったら、レースごとに1回「見た」を送る（反応の計測、2026-10-08）。別タブにしてからは
  // タブを開くとほぼ必ず画面に入るので section_view とほぼ同じ数になる。7日以内の再訪を数えるための
  // 「最後に見た時刻」の記録に使う（docs/design/analogy-reaction-measurement/events.md）
  const sectionRef = useRef(null);
  useEffect(() => {
    const el = sectionRef.current;
    if (!factsReady || !el || visibleRaces.has(raceId)) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      visibleRaces.add(raceId);
      markAnalogySeen();
      trackEvent("analogy_section_visible", {
        race_id: raceId,
        analogy_stage: stage,
      });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [factsReady, raceId, stage]);
  // 条件の変更（時点・着順・艇・範囲など）を、data-af-control を付けた操作から拾う。
  // 各部品に計測を書かず、節で1か所にまとめる。押し直し（すでに選択中）は数えない
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const send = (target) => {
      const group = target.closest?.("[data-af-control]");
      if (!group || !el.contains(group)) return;
      trackEvent("analogy_control_change", {
        race_id: raceId,
        analogy_tab: tab,
        analogy_control: group.getAttribute("data-af-control"),
      });
    };
    // React の onClick より先に走る（capture）ので、aria-pressed は押す前の値。
    // 押し直しで選択を外す部品（data-af-toggle、ソナーの扇）は押し直しも数える
    const pressed = (btn) => {
      if (btn.disabled) return;
      if (
        btn.getAttribute("aria-pressed") === "true" &&
        !btn.closest("[data-af-toggle]")
      )
        return;
      send(btn);
    };
    const onClick = (e) => {
      // data-af-tap は、button ではないが押せる部品（ソナーの図の外の艇番）
      const btn = e.target.closest?.('button, [role="button"], [data-af-tap]');
      if (btn) pressed(btn);
    };
    // button でない role="button"（ソナーの扇は SVG）は Enter・Space で click が出ないので、キーで拾う
    const onKeyDown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const btn = e.target.closest?.('[role="button"]');
      if (btn && btn.tagName !== "BUTTON") pressed(btn);
    };
    // スライダー・選択肢は値が決まったとき（ネイティブの change）だけ
    const onChange = (e) => {
      if (e.target.matches?.("input, select")) send(e.target);
    };
    // button でない操作（ソナーの点のタップ・長押し）は、部品が af-control のイベントで知らせる
    const onCustom = (e) => {
      if (typeof e.detail !== "string") return;
      trackEvent("analogy_control_change", {
        race_id: raceId,
        analogy_tab: tab,
        analogy_control: e.detail,
      });
    };
    el.addEventListener("click", onClick, true);
    el.addEventListener("change", onChange, true);
    el.addEventListener("keydown", onKeyDown, true);
    el.addEventListener("af-control", onCustom);
    return () => {
      el.removeEventListener("af-control", onCustom);
      el.removeEventListener("keydown", onKeyDown, true);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("change", onChange, true);
    };
  }, [raceId, tab]);
  // 内部タブを下に送っても固定する位置。上に貼り付くヘッダー（.app-header）は縮むので高さを測り続ける
  useEffect(() => {
    const el = sectionRef.current;
    const header = document.querySelector(".app-header");
    if (!el || !header || typeof ResizeObserver === "undefined") return;
    const set = () =>
      el.style.setProperty(
        "--af-sticky-top",
        `${header.getBoundingClientRect().height}px`,
      );
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, [factsReady]);
  const similar = useAnalogySimilar(raceId, stage, Boolean(opened.similar));
  const scenario = useAnalogyScenario(
    raceId,
    scenarioScope,
    "exhibition",
    Boolean(opened.scenario),
    true, // 2〜6号艇の級をそろえた範囲も取る（③④。BOA-806）
  );

  const [, , , venueCode, raceNumber] = String(raceId).split("-");
  const heading = t("aiPredictionTab.analogy.heading", {
    venue: venueLabel(Number(venueCode), t),
    race: Number(raceNumber),
  });
  const wrap = (body) => (
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
    // 公開時の最小限の計測（2026-10-08 ユーザー決定）。パラメータ名は GA4 の予約語（source・medium・campaign・
    // content・id 等）を避ける（ga4_unassigned の件）
    trackEvent("analogy_tab_select", { race_id: raceId, analogy_tab: next });
  };
  const tabId = (name) => `${tabsId}-${name}`;
  // 画面の中の声（反応の計測）。各内部タブの中身の終わり、「割合の出し方・注意」などの折りたたみより上に置く
  // （承認モック v3。一番下だと差がつく材料では約4,900px 先になり届かなかった）
  const feedback = factsReady ? (
    <AnalogyFeedback raceId={raceId} stage={stage} tab={tab} />
  ) : null;
  let panel;
  if (tab === "facts")
    panel =
      facts.status === "error" ? (
        <TabError onRetry={facts.retry} />
      ) : facts.data?.today ? (
        <ConditionFactsTab
          data={facts.data}
          stage={stage}
          target={target}
          feedback={feedback}
        />
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
          feedback={feedback}
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
          feedback={feedback}
        />
      ) : (
        <p className="af-v16-line">
          {t("aiPredictionTab.analogy.states.loading")}
        </p>
      );

  const anyPeriod = Object.values(facts.data?.facts ?? {})[0]?.period ?? null;
  return wrap(
    <>
      <div className="af-tabs-sticky">
        <AnalogyTabs tabs={TABS} tab={tab} onTab={selectTab} tabId={tabId} />
      </div>
      <AnalogyControls
        stage={stage}
        exhibitionReady={exhibitionReady}
        stageChipKey={STAGE_CHIP[status] ?? "chipBefore"}
        onStage={setStageChoice}
        target={target}
        onTarget={setTarget}
        showTarget={tab !== "scenario"}
      />
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
