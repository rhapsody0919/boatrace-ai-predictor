import { useTranslation } from "react-i18next";
import { WAVE_EXCLUDED_VENUE_CODES } from "../basicInfoStats";

// 注記を4本並べるとグレーの壁になって誰も読まないので、
// 毎回は要らない2本（最終日の構造差・母数が違う行）は
// 折りたたむ。常時出すのはコース混在の1本とFのSTだけ
export default function ConditionsHowToRead({ condRows }) {
  const { t } = useTranslation();
  const wave = condRows.find((r) => r.key === "wave5");
  return (
    <details className="rbit-conditions-how">
      <summary>{t("basicInfo.conditionsHowToRead")}</summary>
      {/* B: 最終日は優勝戦を含み、勝ち上がった選手が1号艇に入る。
          全36,221レースの実測で1号艇1着率は初日52.1%・中日54.0%・
          最終日60.1%と構造的に差がある（選手の力ではなく枠の差） */}
      {condRows.some((r) => r.key === "finalDay") && (
        <p className="rbit-conditions-caveat">
          {t("basicInfo.conditionsFinalDayCaveat")}
        </p>
      )}
      {/* 「波5cm以上」から江戸川の走を外したことを書く（BOA-584） */}
      {wave?.excludedN > 0 ? (
        <p className="rbit-conditions-caveat">
          {t("basicInfo.conditionsWaveExcludedNote", {
            venue: [...WAVE_EXCLUDED_VENUE_CODES]
              .map((code) => t(`venues.${code}`))
              .join(t("basicInfo.conditionsBaseNoteSeparator")),
            n: wave.excludedN,
          })}
        </p>
      ) : null}
      {/* 母数が他行と違う行（初日・最終日・波・F持ち時・F無し時）は、
          条件を判定できた走数を添えて「他行と比べない」と読ませる */}
      {condRows.some((r) => r.baseN !== null) && (
        <p className="rbit-conditions-caveat">
          {t("basicInfo.conditionsBaseNote", {
            rows: condRows
              .filter((r) => r.baseN !== null)
              .map((r) =>
                t("basicInfo.conditionsBaseNoteRow", {
                  label: t(`basicInfo.conditions.${r.key}`),
                  n: r.baseN,
                }),
              )
              .join(t("basicInfo.conditionsBaseNoteSeparator")),
          })}
        </p>
      )}
    </details>
  );
}
