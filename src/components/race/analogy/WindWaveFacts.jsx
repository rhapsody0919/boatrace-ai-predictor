import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import BoatBadge from "../BoatBadge";
import RateBar from "./RateBar";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct, venueLabel } from "../../../utils/analogyFormat";
import { TARGET_KEY, rateOf, windWaveView } from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts.wind";

/**
 * 今日の風・波（spec A-9、Q-F3）。展示後だけ。会場の全レース（VA）で、今日と同じ風速区分（波高が風速と別の
 * 情報を持つ会場では波高区分も）のレースの各艇番の率。数え方は windWaveView が決める
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
  const view = windWaveView(vaFacts, exhibition);
  if (!view) return null;
  const tk = TARGET_KEY[target];
  const venueName = venueLabel(venue, t);
  const wind = exhibition.wind_speed ?? "—";
  const wave = exhibition.wave_height ?? "—";
  const isWave = view.mode === "wave";
  const band = isWave
    ? t(`${k}.bandsWave`, {
        wind: t(`${k}.bands.${view.wind}`),
        wave: t(`${k}.waveBands.${view.wave}`),
      })
    : t(`${k}.bands.${view.wind}`);
  return (
    <div className="af-wind">
      <h3 className="af-h3">
        {isWave
          ? t(`${k}.heading`, { wind, wave })
          : t(`${k}.headingWind`, { wind, wave })}
      </h3>
      <p className="af-sub">{t(`${k}.sub`, { venue: venueName })}</p>
      {view.sameAsWind && <p className="af-sub">{t(`${k}.windOnly`)}</p>}
      {view.mode === "waveFew" && (
        <p className="af-sub">
          {t(`${k}.waveFew`, { n: fmtCount(view.waveN) })}
        </p>
      )}
      <div className="af-bars">
        {[1, 2, 3, 4, 5, 6].map((b) => {
          const [hits, n] = view.rows[String(b)][tk];
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
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.counting`)}
        texts={[
          t(isWave ? `${k}.footWave` : `${k}.foot`, {
            venue: venueName,
            band,
            finish: t(`aiPredictionTab.analogy.finishWord.${target}`),
            n: fmtCount(view.n),
          }),
        ]}
      />
    </div>
  );
}
