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
