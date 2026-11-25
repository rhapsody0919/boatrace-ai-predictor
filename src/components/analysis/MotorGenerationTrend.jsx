/**
 * モータ情報タブの「今の値｜推移」の推移の中身（オーナー 2026-11-25 承認のモック改訂2、号機を足した形）。
 * このレースの6基を今の世代（そのレースの日以前で最新の入れ替えの後）の中だけで重ねる。
 * 率は公式の累積を節ごとの点（20走から）、展示タイムは直近30走の平均（24走から）。
 * 根拠は docs/design/indicator-parts/analysis/motor-trend-window.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../race/BoatBadge";
import InlineFetchError from "../InlineFetchError";
import MotorTrendChart from "./MotorTrendChart";
import { getMotorGenerationRuns } from "../../services/motorQueries8.js";
import {
  MOTOR_EXHIBITION_MIN_RUNS,
  MOTOR_RATE_MIN_RUNS,
  motorExhibitionTrend,
  motorRateTrend,
} from "../../pure/motorGenerationTrend.js";
import { formatGenerationDate } from "../../utils/motorGeneration";
import "../race/basic-info/TrendChart.css";
import "./MotorTrendChart.css";

// 展示タイムは検証した値（レース内の平均との差）と画面の値（秒の平均）が違うので、同じデータで評価し直すまで出さない
// （AGENTS「画面に出す推定量は評価した推定量と同じにする」）。部品と純関数は展示タイムにも対応している
const METRICS = ["top2Rate", "top3Rate"];
const minRunsOf = (metric) => (metric === "exhibition" ? MOTOR_EXHIBITION_MIN_RUNS : MOTOR_RATE_MIN_RUNS);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** 「今の値｜推移」の切り替え（選手の成績比較と同じ見た目） */
export function MotorViewHead({ view, setView, metric }) {
  const { t } = useTranslation();
  return (
    <div className="trc-head">
      <p className="trc-title">{t(view === "now" ? "analysis.motor.genTrend.nowTitle" : `analysis.motor.genTrend.title.${metric}`)}</p>
      <span className="trc-tabs" role="group" aria-label={t("analysis.motor.genTrend.viewLabel")}>
        {["now", "trend"].map((v) => (
          <button key={v} type="button" className="trc-tab mtc-tab" aria-pressed={view === v} onClick={() => setView(v)}>
            {t(`analysis.motor.genTrend.view.${v}`)}
          </button>
        ))}
      </span>
    </div>
  );
}

/** 指標の札（モックどおり「今の値｜推移」の行の上に置く。推移のときだけ） */
export function MotorMetricChips({ metric, setMetric }) {
  const { t } = useTranslation();
  return (
    <div className="mtc-chips" role="group" aria-label={t("analysis.motor.genTrend.metricLabel")}>
      {METRICS.map((k) => (
        <button key={k} type="button" className="mtc-chip" aria-pressed={metric === k} onClick={() => setMetric(k)}>
          {t(`analysis.motor.genTrend.metric.${k}`)}
        </button>
      ))}
    </div>
  );
}

// 取得の結果は、頼んだ鍵と一緒に持つ。鍵が今と違えば読み込み中（effect の中で同期に state を戻さない）
function useGenerationRuns(venueCode, motors, raceId) {
  const key = `${venueCode}-${motors.join("_")}-${raceId}`;
  const [got, setGot] = useState({ key: null, status: "loading", data: null });
  useEffect(() => {
    let cancelled = false;
    getMotorGenerationRuns(venueCode, key.split("-")[1].split("_").map(Number), raceId).then(
      (data) => !cancelled && setGot({ key, status: "ok", data }),
      (err) => {
        console.error("モーターの推移の取得エラー:", err);
        if (!cancelled) setGot({ key, status: "error", data: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [venueCode, key, raceId]);
  return got.key === key ? got : { status: "loading", data: null };
}

function seriesOf(rows, runsByMotor, metric, today) {
  const out = new Map();
  for (const r of rows) {
    const runs = runsByMotor[r.motor_number] ?? [];
    const s = metric === "exhibition" ? motorExhibitionTrend(runs) : motorRateTrend(runs, metric, { today });
    if (s.length > 0) out.set(r.boat_number, s);
  }
  return out;
}

function BoatMotorPicker({ rows, series, runsByMotor, selected, onSelect, showRuns }) {
  const { t } = useTranslation();
  return (
    <div className="trc-boats mtc-boats">
      {rows.map((r) => (
        <button key={r.boat_number} type="button" className="trc-boat mtc-boat" aria-pressed={r.boat_number === selected}
          disabled={showRuns || !series.has(r.boat_number)} onClick={() => onSelect(r.boat_number)}
          aria-label={t("basicInfo.trend.selectBoat", { boat: r.boat_number })}>
          <BoatBadge n={r.boat_number} />
          <span className="mtc-motor-no">
            {t("analysis.motor.genTrend.motorNo", { n: r.motor_number })}
          </span>
          {showRuns && (
            <span className="mtc-motor-no">{t("analysis.motor.genTrend.runs", { n: (runsByMotor[r.motor_number] ?? []).length })}</span>
          )}
        </button>
      ))}
      {!showRuns && <span className="trc-hint">{t("basicInfo.trend.tapHint")}</span>}
    </div>
  );
}

function TrendEmpty({ rows, data, metric, today, onShowNow }) {
  const { t } = useTranslation();
  if (data.generationStart === null) return <p className="trc-note">{t("analysis.motor.genTrend.noGeneration")}</p>;
  return (
    <>
      <BoatMotorPicker rows={rows} series={new Map()} runsByMotor={data.runsByMotor} showRuns />
      <div className="mtc-empty">
        <p>{t("analysis.motor.genTrend.empty", { date: formatGenerationDate(data.generationStart, { short: true }), days: dayDiff(data.generationStart, today) + 1, n: minRunsOf(metric) })}</p>
        <button type="button" className="mtc-to-now" onClick={onShowNow}>
          {t("analysis.motor.genTrend.toNow")}
        </button>
      </div>
    </>
  );
}

function TrendBody({ rows, data, series, metric, today, selected, onSelect }) {
  const { t } = useTranslation();
  const selRow = rows.find((r) => r.boat_number === selected);
  const runs = (data.runsByMotor[selRow?.motor_number] ?? []).length;
  return (
    <>
      <MotorTrendChart seriesByBoat={series} metric={metric} selected={selected} generationStart={data.generationStart} today={today} minRuns={minRunsOf(metric)} />
      <BoatMotorPicker rows={rows} series={series} runsByMotor={data.runsByMotor} selected={selected} onSelect={onSelect} />
      {selRow && (
        <p className="mtc-selected">
          {t("analysis.motor.genTrend.selected", { boat: selected, n: selRow.motor_number, date: formatGenerationDate(data.generationStart), runs })}
        </p>
      )}
      <p className="trc-note">{t(metric === "exhibition" ? "analysis.motor.genTrend.noteExhibition" : "analysis.motor.genTrend.noteRate", { n: MOTOR_RATE_MIN_RUNS, metric: t(`analysis.motor.genTrend.metric.${metric}`) })}</p>
    </>
  );
}

export default function MotorGenerationTrend({ venueCode, raceId, rows, metric, onShowNow, focusedBoat, onFocusBoat }) {
  const { t } = useTranslation();
  const [localBoat, setLocalBoat] = useState(null);
  const sorted = [...rows].filter((r) => Number.isInteger(r.motor_number)).sort((a, b) => a.boat_number - b.boat_number);
  const { status, data } = useGenerationRuns(venueCode, sorted.map((r) => r.motor_number), raceId);
  const today = raceId.slice(0, 10);
  const series = status === "ok" ? seriesOf(sorted, data.runsByMotor, metric, today) : new Map();
  const want = focusedBoat ?? localBoat ?? 1;
  const selected = series.has(want) ? want : [...series.keys()][0];
  const pick = (boat) => (onFocusBoat ? onFocusBoat(boat) : setLocalBoat(boat));
  return (
    <div className="trc-wrap mtc-wrap">
      {status === "loading" && <p className="trc-note">{t("analysis.loading")}</p>}
      {status === "error" && <InlineFetchError />}
      {status === "ok" && series.size === 0 && <TrendEmpty rows={sorted} data={data} metric={metric} today={today} onShowNow={onShowNow} />}
      {series.size > 0 && <TrendBody rows={sorted} data={data} series={series} metric={metric} today={today} selected={selected} onSelect={pick} />}
    </div>
  );
}
