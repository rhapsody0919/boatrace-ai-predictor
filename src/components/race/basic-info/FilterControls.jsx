import { useTranslation } from "react-i18next";
import { slashDate } from "../../../utils/formatters";
import TermHintButton from "../TermHintButton";
import InlineFetchError from "../../InlineFetchError";
import { ownMetricLabel } from "./format";

const METRICS = ["winRate", "top2Rate", "top3Rate", "avgSt"];
const GRADES = ["all", "ippan", "sgg1"];
// 期間フィルタ（PERIODS）に「初日」「最終日」は**足さない**。2026-09-15時点では
// 判定に使うrace_conditions.series_day/is_final_dayが全件nullだったため削除した
// 経緯があるが、この2列は現在99.9%埋まっている（2026-09-28実測、2026-02-01以降
// 36,607/36,629行＝99.94%。残る22行は当日＝スクレイプ前の分）。それでも
// 足さない理由は2つで、いずれもデータの有無とは関係ない。
//   1. **条件別タブで既に出している**（CONDITION_ROWSのfirstDay/finalDay、PR #831
//      で出荷済み。basicInfoStats.js参照）。足すと同じ数字が同じタブの2箇所に出る
//   2. **軸の意味が混ざる**。PERIODSは「今期／過去3ヶ月／直近1ヶ月」という
//      *時間の幅* の軸で、初日・最終日は幅ではなく *条件*（当地・一般戦・波5cm以上
//      と同じ仲間）。条件は条件別タブ側が持つ、という切り分けを崩さない
// なお母数は足りている（初日の走数は中央24走、SMALL_SAMPLE_THRESHOLDを割るのは
// 0.6%。2026-09-28実測）ので、将来「初日×当地×SG・G1」のような掛け合わせが
// 欲しくなったら条件別タブ側を多軸化するのが筋。1の重複が言えるのは既定状態
// （全国・全レース）についてで、当地やSG・G1を選ぶと条件別タブ側は絞らない
// 集計のままなので数字は一致しない
const PERIODS = ["official", "term", "last3m", "last1m"];
const PRESETS = [
  { scope: "local", grade: "ippan" },
  { scope: "local", grade: "sgg1" },
  { scope: "national", grade: "sgg1" },
];

// 指標・範囲・グレード・プリセット・期間の絞り込み操作
export default function FilterControls({
  metric,
  setMetric,
  scope,
  setScope,
  grade,
  setGrade,
  period,
  setPeriod,
  needsOwnAggregation,
  officialAvgSt,
  onRetryOfficialAvgSt,
  currentTermFrom,
}) {
  const { t } = useTranslation();
  const isPresetActive = (preset) =>
    preset.scope === scope && preset.grade === grade;

  return (
    <>
      <p className="rbit-note">{t("basicInfo.note")}</p>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.metricLabel")}
      >
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            className={`rbit-chip${metric === m ? " is-active" : ""}`}
            onClick={() => setMetric(m)}
          >
            {needsOwnAggregation
              ? ownMetricLabel(t, m)
              : t(`basicInfo.metrics.${m}`)}
          </button>
        ))}
      </div>

      {metric === "winRate" && needsOwnAggregation && (
        <p className="rbit-metric-caveat">
          {t("basicInfo.winRateSwitchCaveat")}
        </p>
      )}

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.scopeLabel")}
      >
        {["national", "local"].map((s) => (
          <button
            key={s}
            type="button"
            className={`rbit-chip${scope === s ? " is-active" : ""}`}
            onClick={() => setScope(s)}
          >
            {t(`basicInfo.scopes.${s}`)}
          </button>
        ))}
      </div>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.gradeLabel")}
      >
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            className={`rbit-chip${grade === g ? " is-active" : ""}`}
            onClick={() => setGrade(g)}
          >
            {t(`basicInfo.grades.${g}`)}
          </button>
        ))}
      </div>

      <div className="rbit-preset-row">
        {PRESETS.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            className={`rbit-preset${isPresetActive(preset) ? " is-active" : ""}`}
            onClick={() => {
              setScope(preset.scope);
              setGrade(preset.grade);
            }}
          >
            {/* 日本語は「当地一般戦」と続けて書くが、英語・韓国語は語間に
                スペースが要るため区切りをロケール側に持たせる */}
            {t("basicInfo.presetLabel", {
              scope: t(`basicInfo.scopes.${preset.scope}`),
              grade: t(`basicInfo.grades.${preset.grade}`),
            })}
          </button>
        ))}
      </div>

      <details className="rbit-period-details">
        <summary>{t("basicInfo.periodSummary")}</summary>
        <div className="rbit-chip-row">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`rbit-chip${period === p ? " is-active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {t(`basicInfo.periods.${p}`)}
            </button>
          ))}
          {/* 「公式」の期間は「?」に出す（公式の出走表と同じ期。BOA-775） */}
          {officialAvgSt?.period && (
            <TermHintButton
              termKey="basicInfoOfficial"
              values={{
                from: slashDate(officialAvgSt.period.calcFrom),
                to: slashDate(officialAvgSt.period.calcTo),
              }}
            />
          )}
        </div>
        {period === "official" && metric === "avgSt" && scope === "local" && (
          <p className="rbit-period-caveat">
            {t("basicInfo.periodOfficialNoLocalSt")}
          </p>
        )}
        {period === "term" && currentTermFrom && (
          <p className="rbit-period-caveat">
            {t("basicInfo.periodCurrentNote", {
              from: slashDate(currentTermFrom),
            })}
          </p>
        )}
        {officialAvgSt === null && period === "official" && metric === "avgSt" && (
          <InlineFetchError onRetry={onRetryOfficialAvgSt} />
        )}
      </details>
    </>
  );
}
