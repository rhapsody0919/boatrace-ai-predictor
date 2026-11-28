import { useTranslation } from "react-i18next";

// Fバッジ・Lバッジ・事故率の目印の凡例
export default function BasicInfoLegends({ officialRates, accidentByRacer }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Fバッジ・Lバッジの凡例。選手名の行は <button> で「?」を置けず、説明は
          title（ホバー）だけになるため、スマホでは意味を知る手段が無かった
          （BOA-440 ファン評価1周目）。バッジが1つも無いレースでは出さない */}
      {(officialRates ?? []).some(
        (r) => (r.f_count ?? 0) > 0 || (r.l_count ?? 0) > 0,
      ) && <p className="rbit-note">{t("flyingBadge.legend")}</p>}
      {/* 事故率の目印の凡例（BOA-327）。目印が1つでも出ているときだけ。「あと◯点」を予選の得点と
          取り違えないよう、何の点数かを書く（ファン評価1周目） */}
      {[...accidentByRacer.values()].some((a) => a.showBadge) && (
        <p className="rbit-note">{t("basicInfo.accidentLegend")}</p>
      )}
    </>
  );
}

// 棒の長さの決め方の注記（6艇の中の最小〜最大か、今日出走する選手の最小〜最大か）
export function BarScaleNotes({ scale }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 勝率（公式の点数）・平均STの棒は、6艇の中の最小〜最大で長さを決める。
          平均STは差が0.03秒でも棒の長さが10%と100%に開くので、長さだけで差の大きさを
          読ませないよう書き添える（#1064 ファン評価2周目） */}
      {scale.isRelativeScaleMetric && (
        <p className="rbit-metric-caveat rbit-relative-note">
          {t("basicInfo.relativeBarNote")}
        </p>
      )}
      {/* 勝率（公式・全国）は今日出走する選手の最小〜最大と真ん中の線（意味づけ 2026-11-28） */}
      {scale.day && (
        <p className="rbit-metric-caveat" data-testid="rbit-day-median-note">
          {t("basicInfo.dayMedianNote", {
            n: scale.day.n,
            median: scale.day.median.toFixed(2),
          })}
        </p>
      )}
    </>
  );
}
