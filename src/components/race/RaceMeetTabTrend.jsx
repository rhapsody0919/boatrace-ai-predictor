/**
 * RaceMeetTab の「6艇の推移」（レース単位）。同じ節・同じ水面を走った6艇を、共通の推移の図
 * （basic-info/TrendChart）1枚に重ねる（オーナー 2026-11-26「重ねて日付で」）。選んだ艇を太く、ほかは薄く、
 * 点の中に着順、点を押すと吹き出しとレースへの飛び先。横軸は日付（BOA-538。走数の違う艇の同じ横位置が
 * 別の日にならないよう、節の日を等間隔に並べて各走をその日の位置に置く）。下の6行は艇を選ぶ行で、前走と
 * 今節平均 ST・6艇中の順位を出す。値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import { BOAT_COLORS, getBoatChipBackground } from "../../utils/colors";
import { lastStartTiming } from "../../pure/basicInfoStats.js";
import { trendScaleOf } from "../../pure/trendMetricScale.js";
import { dayCenter, dayTickLabels } from "../../utils/trendDateLayout";
import TrendChart from "./basic-info/TrendChart";
import "./basic-info/TrendChart.css";

// 図の点。横の位置（xr）と走らない日をまたぐ印は日付の配置（layoutTrendByDate）から。
// 吹き出しの中身は、選んだ艇なら下の「日別の走り」表と同じ行（艇番・進入・ST を持つ）から
function pointOf(r, j, layout, trendKey, rowOf) {
  // 値の無い走（ST の F・L、欠場・転覆等）は上の帯に公式の記号を出す（線が切れた理由を見せる）
  const flagged = r[trendKey] == null && typeof r.finish === "string";
  return {
    raceId: r.raceId,
    date: r.date,
    value: r[trendKey],
    mark: r.finish,
    flag: flagged ? r.finish : null,
    // 同じ日の2走の間を日の間隔の0.4から0.48へ広げる（点の中に着順を描く丸 r=9 が 375px で重ならない幅）
    xr: Math.min(
      1,
      Math.max(0, layout.centers[j] + (layout.xs[j] - layout.centers[j]) * 1.2),
    ),
    breakBefore: layout.breakBefore[j],
    gapDays: null,
    run: rowOf(r.raceId) ?? {
      raceId: r.raceId,
      date: r.date,
      venueCode: r.raceId.slice(11, 13),
      raceNo: Number(r.raceId.slice(14, 16)),
      boatNumber: null,
      entryCourse: null,
      finishRank: typeof r.finish === "number" ? r.finish : null,
      finishMark: typeof r.finish === "number" ? null : r.finish,
    },
  };
}

function TrendDayChart({ m }) {
  const { t, trendKey, trendRows, trendDates, selectedBoat, meetRows } = m;
  const selRows = new Map((meetRows ?? []).map((r) => [r.raceId, r]));
  const seriesByBoat = new Map(
    trendRows.map(({ player, runs, layout }) => [
      player.number,
      runs.map((r, j) =>
        pointOf(r, j, layout, trendKey, (id) =>
          player.number === selectedBoat ? selRows.get(id) : null,
        ),
      ),
    ]),
  );
  const labels = dayTickLabels(trendDates);
  const xTicks = trendDates.map((d, i) => ({
    xr: dayCenter(i, trendDates.length),
    label: labels[i],
  }));
  return (
    <TrendChart
      seriesByBoat={seriesByBoat}
      metric={trendKey}
      scale={trendScaleOf(
        trendKey === "st" ? "meetDaySt" : "meetDayExhibition",
      )}
      selected={selectedBoat}
      label={t("meetTab.compareTrendTitle")}
      lineClass="rmt-trend-series"
      xTicks={xTicks}
    />
  );
}

function TrendMetricChips({ m }) {
  const { t, trendMetric, setTrendMetric } = m;
  return (
    <div className="rmt-metric-chips" role="group">
      {[
        { key: "st", label: t("meetTab.compareTrendSt") },
        { key: "exhibition", label: t("meetTab.compareTrendEx") },
      ].map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`rmt-metric-chip${trendMetric === chip.key ? " is-active" : ""}`}
          onClick={() => setTrendMetric(chip.key)}
          aria-pressed={trendMetric === chip.key}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

function TrendStAvg({ m, p }) {
  const { t, meetStRanks } = m;
  const stAvg = meetStRanks.find((row) => row.boat === p.number);
  return (
    <span className="rmt-trend-st-avg">
      {stAvg.avg === null
        ? t("meetTab.trendStAvgTooFew", { n: stAvg.n })
        : t("meetTab.trendStAvg", {
            avg: stAvg.avg.toFixed(2),
            rank: stAvg.rank,
            n: stAvg.n,
          })}
    </span>
  );
}

function TrendRow({ m, row }) {
  const { player: p, runs } = row;
  const { trendKey, selectedBoat, onFocusBoat } = m;
  const color = BOAT_COLORS[p.number] || {};
  // 右端の「前走」。STは直前がFならFと出す（BOA-597）。展示はFでも
  // 走っている（展示タイムはある）ので、数値のある最後の走のまま
  const lastRun = lastStartTiming(runs, {
    valueOf: (r) => r[trendKey],
    markOf: (r) =>
      trendKey === "st" && (r.finish === "F" || r.finish === "L")
        ? r.finish
        : null,
  });
  return (
    <li>
      {/* 行全体を1つのボタンにする（BOA-550）。押すと図の太線と下の詳細の艇が替わる */}
      <button
        type="button"
        className="rmt-trend-row"
        onClick={() => onFocusBoat(p.number)}
        aria-pressed={p.number === selectedBoat}
      >
        <span className="rmt-trend-label">
          <span
            className="rmt-boat-chip"
            style={{
              background: getBoatChipBackground(p.number),
              color: color.text,
            }}
          >
            {p.number}
          </span>
          <span className="rmt-name" translate="no">
            {p.name?.replace(/\s+/g, "")}
          </span>
        </span>
        <span className="rmt-trend-last">
          {lastRun === null ? "—" : (lastRun.mark ?? lastRun.value.toFixed(2))}
        </span>
        {trendKey === "st" && <TrendStAvg m={m} p={p} />}
      </button>
    </li>
  );
}

// 横軸の期間と、行を押すと下が変わること。どちらも
// 「点を押したら情報が出る」より先に要る、というファン評価の結論
// （2026-09-29、BOA-495）
function TrendRange({ m }) {
  const { t, sp, trendRange, trendNoRaceDays, mdList } = m;
  if (!trendRange) return null;
  return (
    <p className="rmt-trend-range">
      {/* 1日だけの節で「9/20〜9/20」と書かない（BOA-538 ファン評価） */}
      {trendRange.from === trendRange.to
        ? t("meetTab.trendChartRangeOneDay", { day: trendRange.from })
        : t("meetTab.trendChartRange", trendRange)}
      {/* 目盛りから抜けている日の理由（BOA-636）。横軸の範囲の中だけ。
          段落の他の文（2xs）に埋もれないよう、この1文だけ一段大きくする
          （ファン評価3周目、予選確定の一文と同じ大きさ） */}
      {trendNoRaceDays.length > 0 && (
        <>
          {sp}
          <span className="rmt-trend-noday">
            {t("meetTab.compareTrendNoRaceDays", {
              days: mdList(trendNoRaceDays),
            })}
          </span>
        </>
      )}
    </p>
  );
}

export default function RaceMeetTabTrend({ m }) {
  const { t, trendDomain, trendKey, trendRows } = m;
  if (!trendDomain) return null;
  return (
    <div
      className={`rmt-card${trendKey === "st" ? " rmt-trend-with-avg" : ""}`}
    >
      <div className="rmt-card-head">
        <h3 className="rmt-card-title">{t("meetTab.compareTrendTitle")}</h3>
        <TrendMetricChips m={m} />
      </div>
      <div className="rmt-trend-chart">
        <TrendDayChart m={m} />
      </div>
      <ul className="rmt-trend-rows">
        {trendRows.map((row) => (
          <TrendRow key={row.player.number} m={m} row={row} />
        ))}
      </ul>
      <TrendRange m={m} />
      {trendKey === "st" && (
        <p className="rmt-trend-st-avg-note">{t("meetTab.trendStAvgNote")}</p>
      )}
      <p className="rmt-hint">{t("meetTab.compareTrendHint")}</p>
      <p className="rmt-spark-note">{t("meetTab.trendChartNote")}</p>
    </div>
  );
}
