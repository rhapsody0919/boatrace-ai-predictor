import { useTranslation } from "react-i18next";
import { SMALL_SAMPLE_THRESHOLD } from "../basicInfoStats";
import { formatMetricValue } from "./format";

export default function ConditionsTable({ condRows, metric }) {
  const { t } = useTranslation();
  return (
    <table className="rbit-conditions-table">
      <tbody>
        {condRows.map((row) => {
          const small = row.n > 0 && row.n < SMALL_SAMPLE_THRESHOLD;
          return (
            <tr key={row.key}>
              <th scope="row">{t(`basicInfo.conditions.${row.key}`)}</th>
              <td
                className={`rbit-conditions-value${small ? " is-small-sample" : ""}`}
              >
                {row.value === null ? "—" : formatMetricValue(metric, row.value)}
              </td>
              <td
                className={`rbit-conditions-n${small ? " is-small-sample" : ""}`}
              >
                {small && (
                  <span
                    className="rbit-conditions-warn"
                    title={t("basicInfo.smallSampleTitle")}
                  >
                    ⚠
                  </span>
                )}
                {t("basicInfo.sampleCount", { n: row.n })}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
