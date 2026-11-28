/**
 * RaceMeetTab 詳細の、今節の走順に並べた小さな線（ST・展示）。数字の羅列だと8走ぶんの上下を
 * 頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
 * 判定文は出さず、形と基準線と差の数字を見せて読み手に委ねる。
 * 線は共通の推移の図（basic-info/TrendChart）の1艇版で、横軸は上の6艇の推移（R-43）と同じ日付
 * （オーナー 2026-11-26「既に線がある部品を共通の図へ」）。基準（ST の通常の平均・展示のその日の会場平均）は破線で重ねる。
 */
import { meetStVerdictTone } from "../../pure/basicInfoStats.js";
import { trendScaleOf } from "../../pure/trendMetricScale.js";
import { dayTicksOf, pointOf } from "./meetTrendPoints";
import TrendChart from "./basic-info/TrendChart";
import TrendGainFill from "./basic-info/TrendGainFill";
import TermHintButton from "./TermHintButton";
import "./basic-info/TrendChart.css";

// 通常より早い＝緑、遅い＝赤（R2）。差の数字に −/+ が付く。
// 小さな差・走数の少ないときは色を付けない（meetStVerdictTone）。「踏んでいる」等の文字は出さない（plan.md §14、オーナー 2026-11-28）
const signedDiff = (d) => {
  const r = Math.round(d * 100) / 100;
  return r < 0
    ? `\u2212${Math.abs(r).toFixed(2)}`
    : `${r > 0 ? "+" : ""}${r.toFixed(2)}`;
};
// 「差」の札を付ける（札が無いと直前の「通常 0.14」の幅や式に読める）。札ごと改行で割らない（visual-designer 11/28）
function StVerdict({ m }) {
  const { t, st } = m;
  return (
    <span
      style={{ whiteSpace: "nowrap" }}
      className={`rmt-verdict${
        {
          good: " ind-good",
          bad: " ind-bad",
        }[meetStVerdictTone(st.diff, st.meetN)] ?? ""
      }`}
    >
      {t("meetTab.sparkStDiff", { diff: signedDiff(st.diff) })}
    </span>
  );
}

function StHead({ m }) {
  const { t, st } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">
        {t("meetTab.sparkStTitle")}
        {/* 読み方（破線・横軸・色の条件・点を押すと）は「?」の中（plan.md §14） */}
        <TermHintButton termKey="meetSparks" />
      </span>
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

// 基準の破線。refOf(点) が null の所で切る。何の線かの札は右端の札の列に置き（注記を読まずに分かるように）、
// 前走の札と近いときは上下にずらす
function RefLine({ sel, x, y, W, pad, refOf, refLabel }) {
  const runs = [[]];
  sel.forEach((p, i) => {
    const v = refOf(p);
    if (v === null || v === undefined) runs.push([]);
    else runs[runs.length - 1].push([x(i, sel.length), y(v)]);
  });
  const lines = runs.filter((r) => r.length > 1);
  if (lines.length === 0) return null;
  const tail = lines[lines.length - 1];
  const ry = tail[tail.length - 1][1];
  const last = sel.findLast((p) => p.value !== null && p.value !== undefined);
  const ey = last ? y(last.value) : -Infinity;
  const near = Math.abs(ry - ey) < 14;
  return (
    <g className="rmt-spark-refs">
      <TrendGainFill
        sel={sel}
        x={x}
        y={y}
        refOf={refOf}
        className="rmt-spark-gain"
      />
      {lines.map((pts) => (
        <polyline
          key={pts[0].join()}
          className="rmt-spark-ref"
          points={pts.map((q) => q.join(",")).join(" ")}
        />
      ))}
      <text
        className="rmt-spark-ref-label"
        x={W - pad.r + 8}
        y={near ? ey + (ry >= ey ? 18 : -10) : ry + 3}
      >
        {refLabel}
      </text>
    </g>
  );
}

function MeetSpark({ m, trendKey, scaleKey, label, refOf, refLabel }) {
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
      renderOver={({ x, y, W, pad, sel: s }) => (
        <RefLine
          sel={s}
          x={x}
          y={y}
          W={W}
          pad={pad}
          refOf={refOf}
          refLabel={refLabel}
        />
      )}
    />
  );
}

function StSpark({ m }) {
  const { t, st } = m;
  return (
    <div className="rmt-spark">
      <StHead m={m} />
      <MeetSpark
        m={m}
        trendKey="st"
        scaleKey="meetSparkSt"
        label={t("meetTab.sparkStTitle")}
        refOf={() => st.baseAvg}
        refLabel={
          st.baseAvg === null
            ? null
            : t("meetTab.sparkRefSt", { value: st.baseAvg.toFixed(2) })
        }
      />
    </div>
  );
}

function ExHead({ m }) {
  const { t, pre } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">
        {t("meetTab.sparkExTitle")}
        {/* 説明は ST と共通。375px で縦に積むと ST の「?」に気づかないので展示の見出しにも置く */}
        <TermHintButton termKey="meetSparks" />
      </span>
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
  const { t, venueDailyExhibitionAvg } = m;
  return (
    <div className="rmt-spark">
      <ExHead m={m} />
      {/* 基準は「その日の会場全体の展示平均」。水面は日ごとに 0.08秒動くため（若松2026-09-22〜27の実測で
          6.829〜6.907）、生タイムだけでは重い日の6.90と軽い日の6.90を同じに読む */}
      <MeetSpark
        m={m}
        trendKey="exhibition"
        scaleKey="meetSparkExhibition"
        label={t("meetTab.sparkExTitle")}
        refOf={(p) => venueDailyExhibitionAvg[p.date] ?? null}
        refLabel={t("meetTab.sparkRefEx")}
      />
    </div>
  );
}

export default function RaceMeetTabSparks({ m }) {
  return (
    <div className="rmt-sparks">
      <StSpark m={m} />
      <ExSpark m={m} />
    </div>
  );
}
