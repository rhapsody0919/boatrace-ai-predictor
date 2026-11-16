/**
 * MeetFormTrendCard - 直前情報タブ「今節の足の推移と着順」（BOA-885、2026-10-15 承認のモック
 * docs/design/boa-885-meet-exhibition-trend/mock/APPROVED.md）。
 *
 * 6艇の今節の展示（展示タイム・一周・まわり足・直線）を線で重ね、選んだ艇だけ太くして、
 * 点の中に実際の着順を出す。下の行は選んだ艇の日・R・枠・進入・値・着順で、各点の真下にそろえる。
 * 「上がっている」の判定・印は出さない（効き目を確かめていないため。ファン4人の結論）。
 *
 * 全貌動画で撮るので、線・点・チップ・行に data-boat を付ける。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MEET_FORM_ANCHOR, buildMeetFormTrend } from "./meetFormTrend";
import { MetricTabs, BoatChips } from "./MeetFormTrendControls";
import MeetFormTrendChart from "./MeetFormTrendChart";
import { chartScales, deriveView } from "./MeetFormTrendScales";
import InlineFetchError from "../InlineFetchError";
import "./MeetFormTrendCard.css";

const METRIC_LABEL_KEY = {
  exhibition: "beforeInfo.meetFormMetricExhibition",
  lap: "beforeInfo.meetFormMetricLap",
  turn: "beforeInfo.meetFormMetricTurn",
  straight: "beforeInfo.meetFormMetricStraight",
};

/** 描く枠の幅を測る（ResizeObserver）。カードが出ている間だけ */
function useChartWidth(hasData) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!hasData || !el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);
  return { wrapRef, width };
}

/** 導線（#meet-form-trend 付き）で開いたときは、カードが出たら1回だけそこまで下げる */
function useAnchorScroll(hasData) {
  const sectionRef = useRef(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!hasData || scrolled.current) return;
    if (window.location.hash !== `#${MEET_FORM_ANCHOR}`) return;
    scrolled.current = true;
    sectionRef.current?.scrollIntoView({ block: "start" });
  }, [hasData]);
  return sectionRef;
}

function MeetFormTrendCard({
  focusedBoat = null,
  onFocusBoat,
  players,
  trendByRacer,
  originalByKey,
  runsByRacer,
  scopedByRacer,
  venueDailyAvg,
  turnTimeDiffers = false,
  finishFailed = false,
  onRetryFinish,
}) {
  const { t } = useTranslation();
  const [metricKey, setMetricKey] = useState("exhibition");
  // 選んだ艇はタブをまたいで共有する（?boat=、BOA-492・493）。思考アシスト等から
  // ?tab=beforeInfo&boat=N で開いたときもその艇を強調する。共有が無いとき（直前情報タブを
  // 単独で使う場合）は自分で持つ。まだどの艇も選んでいなければ1号艇
  const [localBoat, setLocalBoat] = useState(null);
  const boat = focusedBoat ?? localBoat ?? 1;
  const selectBoat = (b) => (onFocusBoat ? onFocusBoat(b) : setLocalBoat(b));

  const model = buildMeetFormTrend({
    players,
    trendByRacer,
    originalByKey,
    runsByRacer,
    scopedByRacer,
  });
  // 今節の初戦（前の走が無い）は出さない。表の「今節初戦」に任せる
  const hasData = model.maxRuns > 0 && model.metrics.length > 0;
  const { wrapRef, width } = useChartWidth(hasData);
  const sectionRef = useAnchorScroll(hasData);

  if (!hasData) return null;

  const { metric, selected, showAvg, avgOf, domain, drawOrder } = deriveView(
    model,
    metricKey,
    boat,
    venueDailyAvg,
  );
  const metricLabel = (key) =>
    `${t(METRIC_LABEL_KEY[key])}${turnTimeDiffers && key === "turn" ? " ※" : ""}`;

  const { L, W, H, x, y, ticks } = chartScales(width, model.maxRuns, domain);

  return (
    <section
      ref={sectionRef}
      id={MEET_FORM_ANCHOR}
      className="rbi-card mft-card"
      data-testid="meet-form-trend"
    >
      <h3 className="rbi-heading">{t("beforeInfo.meetFormTitle")}</h3>
      <MetricTabs
        metrics={model.metrics}
        metric={metric}
        metricLabel={metricLabel}
        onSelect={setMetricKey}
      />
      <BoatChips
        t={t}
        boats={model.boats}
        selected={selected}
        onSelect={selectBoat}
      />
      {finishFailed && (
        <InlineFetchError
          message={t("beforeInfo.meetFormFinishFailed")}
          onRetry={onRetryFinish}
        />
      )}
      <div ref={wrapRef} className="mft-chart">
        {width > 0 && domain && selected && (
          <MeetFormTrendChart
            t={t}
            W={W}
            H={H}
            L={L}
            x={x}
            y={y}
            ticks={ticks}
            maxRuns={model.maxRuns}
            metric={metric}
            metricLabel={metricLabel}
            selected={selected}
            showAvg={showAvg}
            avgOf={avgOf}
            drawOrder={drawOrder}
          />
        )}
      </div>
      <p className="rbi-chart-note">
        {t("beforeInfo.meetFormNote")}
        {showAvg ? t("beforeInfo.meetFormNoteAvg") : ""}
      </p>
    </section>
  );
}

export default MeetFormTrendCard;
