import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import RateBar from "./RateBar";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct, venueLabel } from "../../../utils/analogyFormat";
import { TARGET_KEY, rateOf } from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts.wind";

/**
 * 今日の風・波（spec A-9）。展示後だけ。会場の全レース（VA）で、今日と同じ風速区分のレースの各艇番の率
 * @param {{exhibition: object|null, vaFacts: object|null, venue: number, target: 1|2|3, exhibitionStage: boolean}} props
 */
export default function WindWaveFacts({
  exhibition,
  vaFacts,
  venue,
  target,
  exhibitionStage,
}) {
  const { t } = useTranslation();
  if (!exhibitionStage) return <p className="af-foot">{t(`${k}.pre`)}</p>;
  const band = exhibition?.wind_band;
  const rows = band ? vaFacts?.wind?.[band] : null;
  if (!rows) return null;
  const tk = TARGET_KEY[target];
  const venueName = venueLabel(venue, t);
  return (
    <div className="af-wind">
      <h3 className="af-h3">
        {t(`${k}.heading`, {
          wind: exhibition.wind_speed ?? "—",
          wave: exhibition.wave_height ?? "—",
        })}
      </h3>
      <p className="af-sub">{t(`${k}.sub`, { venue: venueName })}</p>
      <div className="af-bars">
        {[1, 2, 3, 4, 5, 6].map((b) => {
          const [hits, n] = rows[String(b)][tk];
          const all = rateOf(vaFacts.usual?.[String(b)]?.[tk]);
          return (
            <RateBar
              key={b}
              label={
                <>
                  <BoatBadge n={b} size="sm" />{" "}
                  {t("aiPredictionTab.analogy.boat", { n: b })}
                </>
              }
              hits={hits}
              n={n}
              reference={all}
              color={SCOPE_LINE[b]}
              value={t(`${k}.row`, {
                rate: fmtPct(n ? hits / n : null),
                all: fmtPct(all),
              })}
            />
          );
        })}
      </div>
      <p className="af-foot">
        {t(`${k}.foot`, {
          venue: venueName,
          band: t(`${k}.bands.${band}`),
          finish: t(`aiPredictionTab.analogy.finishWord.${target}`),
          n: fmtCount(rows["1"][tk][1]),
        })}
      </p>
    </div>
  );
}
