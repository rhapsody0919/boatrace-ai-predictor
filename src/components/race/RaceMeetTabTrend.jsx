/**
 * RaceMeetTab の「6艇の推移」（レース単位）。表の数字だけでは「誰が仕上がってきたか」
 * が読めない。同じ節・同じ水面を走った6艇なので、縦の物差しを
 * 共通にして並べる（1艇ずつ切り替えて見比べる手間を無くす）。
 * 値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import {
  BOAT_COLORS,
  BOAT_LINE_COLORS,
  getBoatChipBackground,
} from "../../utils/colors";
import { lastStartTiming } from "./basicInfoStats";
import MeetSparkline from "./MeetSparkline";
import {
  dayCenter,
  dayTickLabels,
  sparkLeftPercent,
} from "../../utils/trendDateLayout";

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

// 右端の数値が何か分からない、という指摘（2026-09-27）。列見出しを出す
function TrendColumnHead({ m }) {
  const { t, trendDates } = m;
  return (
    <div className="rmt-trend-head">
      {/* 点の下の数字が着順だと行の中で分かるように（BOA-537）。真ん中の列は
          日付の目盛りに使うので、名前の列の上に置く */}
      <span className="rmt-trend-head-sub">{t("meetTab.trendFinishHeader")}</span>
      {/* 日付の目盛り（点と同じ横位置）。縦のガイド線は引かない */}
      <span className="rmt-trend-days" aria-hidden="true">
        {dayTickLabels(trendDates).map((label, i) => (
          <span
            key={trendDates[i]}
            className="rmt-trend-day"
            style={{
              left: `${sparkLeftPercent(dayCenter(i, trendDates.length)).toFixed(2)}%`,
            }}
          >
            {label}
          </span>
        ))}
      </span>
      <span className="rmt-trend-last">{t("meetTab.trendLastHeader")}</span>
    </div>
  );
}

function TrendRowSparkline({ m, p, runs, layout, lastRun }) {
  const { trendKey, trendDomain, trendMean, finishLabelOf } = m;
  return (
    <MeetSparkline
      points={runs.map((r) => ({ value: r[trendKey] }))}
      domain={trendDomain}
      baseline={trendMean}
      // 線は公式の艇色そのままだと1号艇（白）が背景に溶ける
      color={BOAT_LINE_COLORS[p.number] || "var(--brand-accent-primary)"}
      height={34}
      // 1走の選手も前走の点を出す（空白だと取れていないと読まれる）
      allowSinglePoint
      // 前走が F・L なら、1つ前の走に「前走」の大きい点を付けない。
      // 右端は「F」なのに大きい点が0.09の走に付き、前走が好スタートに
      // 見えていた（BOA-597 ファン評価1周目）
      markLast={!lastRun?.mark}
      xPositions={layout.xs}
      xCenters={layout.centers}
      breakBefore={layout.breakBefore}
      // 各走の着順を点の下に出す（BOA-537。ファン4人のパネル）
      pointLabels={runs.map((r) =>
        r.finish === null || r.finish === undefined
          ? null
          : {
              // 公式の記号（エ・転 等）はデータ出走表と同じ表記にする（BOA-654）
              text: finishLabelOf(r.finish),
              win: r.finish === 1,
              mark: typeof r.finish === "string",
            },
      )}
    />
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
  const { player: p, runs, layout } = row;
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
      {/* 行全体を1つのボタンにする。以前は艇番・選手名だけが押せて、
          いちばん大きい的の折れ線と右端の値を押しても何も起きなかった。
          すぐ上の表は「行をタップ」で切り替わるので、そろえる（BOA-550） */}
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
        <TrendRowSparkline
          m={m}
          p={p}
          runs={runs}
          layout={layout}
          lastRun={lastRun}
        />
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
        ? t("meetTab.compareTrendRangeOneDay", { day: trendRange.from })
        : t("meetTab.compareTrendRange", trendRange)}
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
    <div className={`rmt-card${trendKey === "st" ? " rmt-trend-with-avg" : ""}`}>
      <div className="rmt-card-head">
        <h3 className="rmt-card-title">{t("meetTab.compareTrendTitle")}</h3>
        <TrendMetricChips m={m} />
      </div>
      <TrendColumnHead m={m} />
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
      <p className="rmt-spark-note">{t("meetTab.compareTrendFinishNote")}</p>
      <p className="rmt-spark-note">{t("meetTab.compareTrendNote")}</p>
    </div>
  );
}
