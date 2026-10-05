import { useTranslation } from "react-i18next";
import useAnalogyContribution from "../../../hooks/useAnalogyContribution";
import { SCOPE_LINE } from "./analogyColors";
import { fmtDate } from "../../../utils/analogyFormat";
import { directionText, to100 } from "../../../utils/analogyOutlook";

const k = "aiPredictionTab.analogy.outlook";

/**
 * AIの見立て（補助、spec FR-E）。全国の値（数えるレースに連動しない。Q3）。艇番×着順×時点
 * @param {{boat: number, target: 1|2|3, stage: "racecard"|"exhibition"}} props
 */
export default function AiOutlook({ boat, target, stage }) {
  const { t } = useTranslation();
  const { status, data, retry } = useAnalogyContribution({
    venue: 0,
    grade: "all",
    round: "all",
    target,
    stage,
  });
  const summary = <summary>{t(`${k}.summary`)}</summary>;
  if (status === "unavailable") return null;
  // 展示前で集計が無いときは準備中の1文だけ（見出し・説明文も隠す。spec FR-E）
  if (status === "preparing")
    return <p className="af-warn">{t(`${k}.preparing`)}</p>;
  if (status === "error")
    return (
      <details className="af-details af-ai">
        {summary}
        <p className="af-warn">{t("aiPredictionTab.analogy.states.error")}</p>
        <button type="button" className="af-btn" onClick={retry}>
          {t("aiPredictionTab.analogy.states.retry")}
        </button>
      </details>
    );
  const row = data?.boats?.[String(boat)];
  if (!row)
    return (
      <details className="af-details af-ai">
        {summary}
        <p className="af-sub">{t("aiPredictionTab.analogy.states.loading")}</p>
      </details>
    );
  const themes = data.themes ?? [];
  const shares = themes.map((th) => row.shares?.[th.key] ?? 0);
  const pct = to100(shares);
  const max = Math.max(...shares, 0.0001);
  const period = data.testPeriod
    ? t("aiPredictionTab.analogy.period", {
        from: fmtDate(data.testPeriod[0]),
        to: fmtDate(data.testPeriod[1]),
      })
    : "—";
  return (
    <details className="af-details af-ai">
      {summary}
      <div className="af-ai-body">
        <h4 className="af-h3">
          {t(`${k}.heading`, {
            boat,
            finish: t(`${k}.finish.${target}`),
          })}
        </h4>
        <p className="af-sub">{t(`${k}.lede`)}</p>
        <div className="af-ai-themes">
          {themes.map((th, i) => (
            <details key={th.key} className="af-ai-theme">
              <summary>
                <span aria-hidden="true">▸</span>
                <span>{t(`${k}.themes.${th.key}`, th.name)}</span>
                <span className="af-trk" style={{ height: 9 }}>
                  <span
                    className="af-trk-f"
                    style={{
                      width: `${(shares[i] / max) * 100}%`,
                      background: SCOPE_LINE[boat],
                    }}
                  />
                </span>
                <span className="af-num">{pct[i]}%</span>
              </summary>
              <div className="af-ai-items">
                {(row.breakdown?.[th.key] ?? []).map((g) => {
                  const dir = directionText(g.key, g.direction, t);
                  const name =
                    g.key === "national" && boat === 1
                      ? t(`${k}.groups.nationalBoat1`)
                      : t(`${k}.groups.${g.key}`, g.key);
                  return (
                    <div key={g.key} className="af-ai-item">
                      <span>{name}</span>
                      <span className="af-num">
                        {Math.round(g.share * 100)}%
                      </span>
                      {dir && (
                        <span className="af-ai-dir">
                          {dir}
                          {g.key === "wind" && t(`${k}.windNote`)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
        <p className="af-foot">
          {t(`${k}.foot`, {
            period,
            races: (row.n_races ?? 0).toLocaleString("ja-JP"),
          })}
          {boat === 1 &&
            row.frame_ratio !== null &&
            row.frame_ratio !== undefined &&
            t(`${k}.boat1Note`, { pct: Math.round(row.frame_ratio * 100) })}
        </p>
        <p className="af-foot">{t(`${k}.foot2`)}</p>
      </div>
    </details>
  );
}
