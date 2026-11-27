/**
 * RaceMeetTab 詳細の、今節の走順に並べた小さな線（ST・展示）。数字の羅列だと8走ぶんの上下を
 * 頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
 * 判定文は出さず、形と基準線を見せて読み手に委ねる。
 * 線は共通の推移の図（basic-info/TrendChart）の1艇版で、横軸は上の6艇の推移（R-43）と同じ日付
 * （オーナー 2026-11-26「既に線がある部品を共通の図へ」）。基準（ST の通常の平均・展示のその日の会場平均）は破線で重ねる。
 */
import { meetStVerdictTone, MEET_ST_DIFF_THRESHOLD } from "../../pure/basicInfoStats.js";
import { trendScaleOf } from "../../pure/trendMetricScale.js";
import { dayTicksOf, pointOf } from "./RaceMeetTabTrend";
import TrendChart from "./basic-info/TrendChart";
import "./basic-info/TrendChart.css";

// 通常より早い＝緑、遅い＝赤（R2）。差の数字に −/+ が付く。
// 小さな差・走数の少ないときは色を付けない（meetStVerdictTone）
function StVerdict({ m }) {
  const { t, st } = m;
  return (
    <span
      className={`rmt-verdict${
        {
          good: " ind-good",
          bad: " ind-bad",
        }[meetStVerdictTone(st.diff, st.meetN)] ?? ""
      }`}
    >
      {st.diff <= -MEET_ST_DIFF_THRESHOLD
        ? t("basicInfo.meetTrendStPush", {
            diff: Math.abs(st.diff).toFixed(2),
          })
        : st.diff >= MEET_ST_DIFF_THRESHOLD
          ? t("basicInfo.meetTrendStCareful", {
              diff: st.diff.toFixed(2),
            })
          : t("basicInfo.meetTrendStFlat")}
    </span>
  );
}

function StHead({ m }) {
  const { t, st } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">{t("meetTab.sparkStTitle")}</span>
      {st.diff !== null && (
        <span className="rmt-spark-base">
          {t("meetTab.sparkStMeta", {
            avg: st.meetAvg.toFixed(2),
            n: st.meetN,
            base: st.baseAvg === null ? "—" : st.baseAvg.toFixed(2),
          })}{" "}
          <StVerdict m={m} />
        </span>
      )}
    </div>
  );
}

function SparkFoot({ m, last }) {
  const { t } = m;
  // 走の日付は図の横軸に出る。ここは前走の値だけ（F のときも値でなく F）
  return (
    <div className="rmt-spark-foot">
      <span>
        {last === null
          ? "—"
          : t("meetTab.sparkLast", { value: last.mark ?? last.value.toFixed(2) })}
      </span>
    </div>
  );
}

// 選んだ艇の今節の走を、共通の図の点にする（上の6艇の推移と同じ点・同じ横位置）
function selectedSeries(m, trendKey) {
  const { trendRows, selectedBoat, meetRows, finishLabelOf } = m;
  const row = trendRows.find((r) => r.player.number === selectedBoat);
  if (!row || row.runs.length === 0) return null;
  const byId = new Map((meetRows ?? []).map((r) => [r.raceId, r]));
  return row.runs.map((r, j) =>
    pointOf(r, j, row.layout, {
      trendKey,
      labelOf: finishLabelOf,
      rowOf: (id) => byId.get(id),
    }),
  );
}

// 基準の破線。refOf(点) が null の所で切る
function RefLine({ sel, x, y, refOf }) {
  const runs = [[]];
  sel.forEach((p, i) => {
    const v = refOf(p);
    if (v === null || v === undefined) runs.push([]);
    else runs[runs.length - 1].push(`${x(i, sel.length)},${y(v)}`);
  });
  return runs
    .filter((r) => r.length > 1)
    .map((pts) => (
      <polyline key={pts[0]} className="rmt-spark-ref" points={pts.join(" ")} />
    ));
}

function MeetSpark({ m, trendKey, scaleKey, label, refOf }) {
  const sel = selectedSeries(m, trendKey);
  if (!sel) return null;
  const refs = sel.map(refOf).filter((v) => typeof v === "number");
  return (
    <TrendChart
      seriesByBoat={new Map([[m.selectedBoat, sel]])}
      metric={trendKey}
      scale={trendScaleOf(scaleKey)}
      selected={m.selectedBoat}
      label={label}
      lineClass="rmt-spark-series"
      extraValues={refs}
      xTicks={dayTicksOf(m.trendDates)}
      renderOver={({ x, y, sel: s }) => (
        <RefLine sel={s} x={x} y={y} refOf={refOf} />
      )}
    />
  );
}

function StSpark({ m }) {
  const { t, st, lastSt } = m;
  return (
    <div className="rmt-spark">
      <StHead m={m} />
      <MeetSpark
        m={m}
        trendKey="st"
        scaleKey="meetDaySt"
        label={t("meetTab.sparkStTitle")}
        refOf={() => st.baseAvg}
      />
      <SparkFoot m={m} last={lastSt} />
    </div>
  );
}

function ExHead({ m }) {
  const { t, pre } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">{t("meetTab.sparkExTitle")}</span>
      {pre?.pretest_time !== null && pre?.pretest_time !== undefined && (
        <span className="rmt-spark-base">
          {pre.pretest_rank
            ? t("meetTab.sparkExMetaRank", {
                value: Number(pre.pretest_time).toFixed(2),
                rank: pre.pretest_rank,
              })
            : t("meetTab.sparkBaselinePretest", {
                value: Number(pre.pretest_time).toFixed(2),
              })}
        </span>
      )}
    </div>
  );
}

function ExSpark({ m }) {
  const { t, venueDailyExhibitionAvg, lastExhibition } = m;
  return (
    <div className="rmt-spark">
      <ExHead m={m} />
      {/* 基準は「その日の会場全体の展示平均」。水面は日ごとに 0.08秒動くため（若松2026-09-22〜27の実測で
          6.829〜6.907）、生タイムだけでは重い日の6.90と軽い日の6.90を同じに読む */}
      <MeetSpark
        m={m}
        trendKey="exhibition"
        scaleKey="meetDayExhibition"
        label={t("meetTab.sparkExTitle")}
        refOf={(p) => venueDailyExhibitionAvg[p.date] ?? null}
      />
      <SparkFoot
        m={m}
        last={lastExhibition === null ? null : { value: lastExhibition }}
      />
    </div>
  );
}

export default function RaceMeetTabSparks({ m }) {
  const { t } = m;
  return (
    <div className="rmt-sparks">
      <StSpark m={m} />
      <ExSpark m={m} />
      <p className="rmt-spark-note">{t("meetTab.sparkNote")}</p>
    </div>
  );
}
