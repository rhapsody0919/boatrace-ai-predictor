import { useTranslation } from "react-i18next";
import InlineFetchError from "../../InlineFetchError";
import { buildConditionRows } from "../basicInfoStats";
import { ownMetricLabel } from "./format";
import ConditionsTable from "./ConditionsTable";
import ConditionsHowToRead from "./ConditionsHowToRead";
import PeriodBox from "./PeriodBox";

// n=0 の行は畳む（BOA-432）。B級中心の選手では
// 「SG・G1 — (n=0)」が毎回並ぶだけで読む値が無い
// （ナイターの行を出さないのと同じ理屈）。
// ただし **F持ち/Fなしは対で意味を持つ**（同じ「F数が
// 取れている走」を分け合う設計）ので、片方だけ消さず
// 両方0のときだけ両方畳む
function visibleConditionRows(records, venueCode, metric) {
  return buildConditionRows(records, {
    venueCode,
    metric,
  })
    .filter((r) => !r.unavailable)
    .filter((r, _i, rows) => {
      if (r.key === "fHolding" || r.key === "fClean") {
        return rows.some(
          (x) => (x.key === "fHolding" || x.key === "fClean") && x.n > 0,
        );
      }
      return r.n > 0;
    });
}

// C: Fを持った選手の見どころはスタートの踏み方なので、
// 指標が勝率等でも平均STを併記する。勝率だけだと
// 「F持ち時27.3% vs F無し時11.1%」のように
// 「Fを持っている方が走る」と読めてしまう
function ConditionsFStNote({ condRows }) {
  const { t } = useTranslation();
  const holding = condRows.find((r) => r.key === "fHolding");
  const clean = condRows.find((r) => r.key === "fClean");
  if (!holding?.avgStN && !clean?.avgStN) return null;
  const fmt = (row) =>
    row?.avgSt === null || row?.avgSt === undefined
      ? "—"
      : row.avgSt.toFixed(2);
  return (
    <p className="rbit-conditions-caveat">
      {t("basicInfo.conditionsFStNote", {
        holding: fmt(holding),
        holdingN: holding?.avgStN ?? 0,
        clean: fmt(clean),
        cleanN: clean?.avgStN ?? 0,
      })}
    </p>
  );
}

// D: 外枠中心の選手は勝率だと全行0.0%に潰れて情報がゼロになる。
// 実例（同レース4号艇）: 勝率は全行0.0%だが、3連対率にすると
// 全国41.5%・最終日50.0%・波5cm以上50.0%と差が出る。
// ただし3連対率も全部0の選手（1着も3着も無い新人）はいるので、
// **切り替えて実際に差が出る場合だけ**誘導する
function ConditionsAllZeroHint({
  condRows,
  records,
  venueCode,
  metric,
  onSelectTop3,
}) {
  const { t } = useTranslation();
  if (!(
    metric !== "top3Rate" &&
    metric !== "avgSt" &&
    condRows.some((r) => r.n > 0) &&
    // 厳密に0で判定すると「全国0.5%・一般戦0.6%」のような
    // 実質潰れている選手を拾えない。1%未満＝100走に1回未満で
    // 行間の差が読めない状態とみなす
    condRows.every((r) => r.value === null || r.value < 1) &&
    buildConditionRows(records, {
      venueCode,
      metric: "top3Rate",
    }).some((r) => r.value !== null && r.value >= 1)
  )) {
    return null;
  }
  return (
    <p className="rbit-conditions-zero">
      {t("basicInfo.conditionsAllZeroHint")}
      <button
        type="button"
        className="rbit-conditions-zero-action"
        onClick={onSelectTop3}
      >
        {t("basicInfo.conditionsAllZeroAction")}
      </button>
    </p>
  );
}

export default function ConditionsView({
  records,
  raceId,
  venueCode,
  metric,
  boat,
  racerId,
  needsOwnAggregation,
  nowRow,
  periodStats,
  periodFailed,
  onRetryPeriod,
  onSelectTop3,
}) {
  const { t } = useTranslation();
  if (records === undefined || records === null) {
    return <p className="rbit-expanded-loading">{t("basicInfo.loading")}</p>;
  }
  if (records.length === 0) {
    return <p className="rbit-expanded-empty">{t("basicInfo.noHistory")}</p>;
  }
  const condRows = visibleConditionRows(records, venueCode, metric);

  return (
    <div className="rbit-conditions">
      {/* 値は全行とも自社集計。既定状態（勝率・全レース・今期）では
          上のバーが公式値を出すため、同じ「全国」でも数字が違う */}
      <p className="rbit-conditions-note">
        {/* 絞り込み中は上のバーも自社集計なので、「公式値とは一致しない」とは
            書かない。違いは期間・条件の範囲（#1069 ファン評価2周目） */}
        {t(
          needsOwnAggregation
            ? "basicInfo.conditionsNoteFiltered"
            : "basicInfo.conditionsNote",
          { metric: ownMetricLabel(t, metric) },
        )}
      </p>
      <ConditionsTable condRows={condRows} metric={metric} />
      {/* A: この表は全コース込み。今日の枠と母集団が違う。
          実例（2026-09-25 桐生1R）: 4号艇の選手は過去2年183走中
          5・6枠が178走で全国1着率0.5%、6号艇の選手は枠がほぼ均等で
          13.9%。素直に読むと今日の枠と逆方向に評価してしまう */}
      <p className="rbit-conditions-caveat">
        {t("basicInfo.conditionsCourseCaveat", {
          boat,
          n: records.filter((r) => r.boatNumber === boat).length,
        })}
      </p>
      {metric !== "avgSt" && <ConditionsFStNote condRows={condRows} />}
      <ConditionsAllZeroHint
        condRows={condRows}
        records={records}
        venueCode={venueCode}
        metric={metric}
        onSelectTop3={onSelectTop3}
      />
      <ConditionsHowToRead condRows={condRows} />
      {/* 取得失敗を「前期のデータが無い」に化けさせない。
          095未適用（forbidden）のときは枠ごと出さないのが
          正しいので、ここでは出さない */}
      {periodFailed && (
        <InlineFetchError
          message={t("basicInfo.periodFetchError")}
          onRetry={onRetryPeriod}
        />
      )}
      <PeriodBox
        periodStats={periodStats}
        racerId={racerId}
        raceId={raceId}
        nowRow={nowRow}
      />
    </div>
  );
}
