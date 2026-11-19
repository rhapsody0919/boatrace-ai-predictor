import { useTranslation } from "react-i18next";
import { translateTechnique } from "../race/raceIndicators";
import {
  WIND_BIN_KEYS,
  TECHNIQUES,
  toPos,
  formatDiff,
  diffTone,
} from "./weatherInEscapeScale.js";

function DiffBar({ label, sub, rate, base, diff, n, tier }) {
  const { t } = useTranslation();
  return (
    <div className="wie-row">
      <div className="wie-row__label">
        {label}
        {tier === "reference" && (
          <span className="wie-tier">{t("weatherInEscape.reference")}</span>
        )}
        <small>{sub}</small>
      </div>
      <div
        className="wie-track"
        role="img"
        aria-label={t("weatherInEscape.barAria", {
          label,
          rate: rate.toFixed(1),
          diff: formatDiff(diff),
        })}
      >
        <span className="wie-fill" style={{ width: `${toPos(rate)}%` }} />
        <span className="wie-base" style={{ left: `${toPos(base)}%` }} />
      </div>
      <div className="wie-row__value">
        <strong>{rate.toFixed(1)}%</strong>
        <small className={diffTone(diff)}>
          {t("weatherInEscape.diffPt", { diff: formatDiff(diff) })}
        </small>
        <small className="wie-count">
          {t("weatherInEscape.raceCount", {
            count: n,
            countText: n.toLocaleString(),
          })}
        </small>
      </div>
    </div>
  );
}

function WindDiagram() {
  const { t } = useTranslation();
  return (
    <div className="wie-diagram">
      <svg viewBox="0 0 160 64" width="160" height="64" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="158"
          height="44"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
        />
        <polygon points="22,30 28,16 34,30" fill="currentColor" />
        <polygon points="126,30 132,16 138,30" fill="currentColor" />
        <text x="12" y="41" fontSize="9" fill="currentColor">
          {t("weatherInEscape.diagram.mark2")}
        </text>
        <text x="116" y="41" fontSize="9" fill="currentColor">
          {t("weatherInEscape.diagram.mark1")}
        </text>
        <line
          x1="50"
          y1="23"
          x2="104"
          y2="23"
          stroke="currentColor"
          strokeWidth="2"
        />
        <polygon points="104,18 112,23 104,28" fill="currentColor" />
        <text x="62" y="16" fontSize="9" fill="currentColor">
          {t("weatherInEscape.bins.tail")}
        </text>
        <text x="62" y="60" fontSize="9" fill="currentColor">
          {t("weatherInEscape.diagram.stand")}
        </text>
      </svg>
      <span>{t("weatherInEscape.diagram.caption")}</span>
    </div>
  );
}

function PooledCard({ data, base, binLabel, binSub }) {
  const { t } = useTranslation();
  const [ciLowTail, ciHighTail] = data.pooled.tail_strong.ci;
  const [ciLowHead, ciHighHead] = data.pooled.head_strong.ci;
  return (
    <section className="wie-card">
      <h3>{t("weatherInEscape.pooledTitle")}</h3>
      <p className="wie-headline">
        {t("weatherInEscape.headline", {
          tail: formatDiff(data.pooled.tail_strong.diff),
          same: data.pooled.tail_strong.venueSign.sameSign,
          total: data.pooled.tail_strong.venueSign.eligible,
        })}
      </p>
      <WindDiagram />
      <div className="wie-rows">
        {WIND_BIN_KEYS.map((key) => {
          const p = data.pooled[key];
          return (
            <DiffBar
              key={key}
              label={binLabel(key)}
              sub={binSub(key)}
              rate={base + p.diff}
              base={base}
              diff={p.diff}
              n={p.n}
            />
          );
        })}
      </div>
      <p className="wie-note">
        {t("weatherInEscape.pooledNote", {
          base: base.toFixed(1),
          tailLow: formatDiff(ciLowTail),
          tailHigh: formatDiff(ciHighTail),
          headLow: formatDiff(ciLowHead),
          headHigh: formatDiff(ciHighHead),
        })}
      </p>
    </section>
  );
}

function TechniqueRow({ techKey, counts, binLabel }) {
  const { t } = useTranslation();
  const total = TECHNIQUES.reduce((s, [name]) => s + (counts[name] ?? 0), 0);
  const share = (name) => ((counts[name] ?? 0) / total) * 100;
  const aria = TECHNIQUES.map(
    ([name]) => `${translateTechnique(t, name)} ${share(name).toFixed(1)}%`,
  ).join(t("listSeparator"));
  return (
    <div
      className="wie-tech-row"
      data-testid={`wie-technique-${techKey}`}
    >
      <span className="wie-tech-row__label">{binLabel(techKey)}</span>
      <span className="wie-stack" role="img" aria-label={aria}>
        {TECHNIQUES.map(([name, slug]) => (
          <span
            key={slug}
            className={`wie-swatch is-${slug}`}
            style={{ width: `${share(name)}%` }}
          />
        ))}
      </span>
      <span className="wie-tech-row__detail">
        {[
          ["まくり", share("まくり")],
          ["差し", share("差し")],
        ]
          .map(
            ([name, v]) => `${translateTechnique(t, name)} ${v.toFixed(1)}%`,
          )
          .join(t("listSeparator"))}
      </span>
    </div>
  );
}

function TechniqueCard({ data, binLabel }) {
  const { t } = useTranslation();
  return (
    <section className="wie-card">
      <h3>{t("weatherInEscape.techniqueTitle")}</h3>
      <p className="wie-note">{t("weatherInEscape.techniqueLead")}</p>
      <ul className="wie-legend" aria-hidden="true">
        {TECHNIQUES.map(([name, slug]) => (
          <li key={slug}>
            <i className={`wie-swatch is-${slug}`} />
            {translateTechnique(t, name)}
          </li>
        ))}
      </ul>
      <div className="wie-rows">
        {WIND_BIN_KEYS.map((key) => (
          <TechniqueRow
            key={key}
            techKey={key}
            counts={data.techniques[key]}
            binLabel={binLabel}
          />
        ))}
      </div>
      <p className="wie-note">{t("weatherInEscape.techniqueNote")}</p>
    </section>
  );
}

function HiddenVenueRow({ b, label, sub }) {
  const { t } = useTranslation();
  return (
    <div className="wie-row is-hidden-value">
      <div className="wie-row__label">
        {label}
        <small>{sub}</small>
      </div>
      <div className="wie-row__few">{t("weatherInEscape.tooFew")}</div>
      <div className="wie-row__value">
        <small className="wie-count">
          {t("weatherInEscape.raceCount", {
            count: b?.n ?? 0,
            countText: (b?.n ?? 0).toLocaleString(),
          })}
        </small>
      </div>
    </div>
  );
}

export { DiffBar, PooledCard, TechniqueCard, HiddenVenueRow };
