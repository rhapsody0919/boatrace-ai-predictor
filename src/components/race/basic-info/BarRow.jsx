import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";
import FlyingBadge from "../FlyingBadge";
import { formatRate, formatWinRate } from "./format";

function formatBarValue(metric, value, valueDigits, needsOwnAggregation) {
  if (metric === "avgSt") {
    return value !== null && value !== undefined
      ? value.toFixed(valueDigits)
      : "—";
  }
  return metric === "winRate"
    ? formatWinRate(value, needsOwnAggregation)
    : formatRate(value);
}

function ValueCell({
  value,
  n,
  isSmallSample,
  loading,
  isBest,
  metric,
  valueDigits,
  needsOwnAggregation,
}) {
  const { t } = useTranslation();
  return (
    <span className="rbit-value">
      {loading ? (
        <span className="rbit-skeleton" aria-hidden="true" />
      ) : (
        <span className={`rbit-value-num${isBest ? " ind-best" : ""}`}>
          {formatBarValue(metric, value, valueDigits, needsOwnAggregation)}
        </span>
      )}
      {n !== null && n !== undefined && (
        <span className={`rbit-n${isSmallSample ? " is-small-sample" : ""}`}>
          {t(n === 0 ? "basicInfo.noData" : "basicInfo.sampleCount", { n })}
        </span>
      )}
    </span>
  );
}

function AccidentBadge({ accident }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rbit-accident-badge${accident.status === "over" ? " is-over" : ""}`}
    >
      {accident.status === "over"
        ? t("basicInfo.accidentBadgeOver", {
            rate: accident.rate.toFixed(2),
          })
        : t("basicInfo.accidentBadgeNear", {
            need: accident.need,
          })}
    </span>
  );
}

// 6艇の横棒グラフの1行（押すと展開する）
export default function BarRow({
  boat,
  value,
  n,
  isSmallSample,
  loading,
  player,
  expanded,
  onToggle,
  barWidth,
  isBest,
  metric,
  valueDigits,
  needsOwnAggregation,
  officialRow,
  currentMeet,
  accident,
}) {
  const color = BOAT_COLORS[boat] || {};
  return (
    <button
      type="button"
      className="rbit-bar-row"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span
        className="rbit-boat-chip"
        style={{ background: color.bg, color: color.text }}
      >
        {boat}
      </span>
      {/* 名前とFバッジでgridの1列。バッジを直の子にすると
          grid-template-columns（5列）がずれ、バーの上に重なる */}
      <span className="rbit-name-cell">
        <span className="rbit-name" translate="no">
          {/* 出走表の名前は姓と名の間を全角スペースで詰め物して
              字数を揃えてある。今節タブ・モータ情報タブ・オッズ一覧は
              詰めて出しており、ここだけ空きが残ると同じ画面で
              表記が揺れる */}
          {player?.name?.replace(/\s+/g, "")}
        </span>
        {/* 出走表の今期F数（T5-3）。ST考察カードのバッジと同じ出所
            （race_entries.f_count）にしてある。この行は <button> なので
            TermHintButton（入れ子の <button> になる）は置けず、
            説明は title 属性で出す */}
        <FlyingBadge
          count={officialRow?.f_count}
          currentMeet={currentMeet}
          lateCount={officialRow?.l_count}
        />
      </span>
      <span className="rbit-bar-track">
        {!loading && (
          <span
            className={`rbit-bar-fill${isSmallSample ? " is-small-sample" : ""}${boat === 1 ? " is-white" : ""}`}
            style={{
              width: `${barWidth}%`,
              background: color.bg,
            }}
          />
        )}
      </span>
      <ValueCell
        value={value}
        n={n}
        isSmallSample={isSmallSample}
        loading={loading}
        isBest={isBest}
        metric={metric}
        valueDigits={valueDigits}
        needsOwnAggregation={needsOwnAggregation}
      />
      <span className="rbit-expand-arrow">{expanded ? "▼" : "▶"}</span>
      {/* 今期の事故率（BOA-327）。B2ラインを超えた選手と、あとF1本（20点）以内で
          超える選手にだけ出す（出走30走以上。accidentRate.js）。名前の列に入れると列が広がり、
          その行だけ棒の枠が短くなって6艇の長さを比べられなくなるので、2段目に置く */}
      {accident?.showBadge && <AccidentBadge accident={accident} />}
    </button>
  );
}
