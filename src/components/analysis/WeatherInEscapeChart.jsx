/**
 * WeatherInEscapeChart - 風とイン逃げ率（BOA-211）
 *
 * 風の向き（水面基準: 追い風・向かい風・横風）と強さで、1コースの1着率（イン逃げ率）が
 * 同じ会場の平均とどれだけ違うかを出す。集計は事前登録した分析
 * （docs/design/weather-in-escape/preregistration.md・results.md）と同じスクリプトが書き出した
 * 静的な JSON（public/data/weather-in-escape.json）を読むだけで、DB は読まない。
 * 作り直しは四半期ごとに手で行う（docs/operation/weather-in-escape-refresh.md）。
 *
 * 画面に出す値は、判定した推定量（会場内の差 D と97.5%区間）と同じにする（事前登録 §7）。
 * 会場のセルは1,000件以上で値、300〜999件は「参考値」、300件未満は件数だけを出す。
 * 決まり手の構成は判定していない副指標なので、その旨を注記する（2026-10-02 ユーザー承認）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateTechnique } from "../race/raceIndicators";
import InlineFetchError from "../InlineFetchError";
import "./WeatherInEscapeChart.css";

const DATA_URL = "/data/weather-in-escape.json";

const WIND_BIN_KEYS = [
  "head_strong",
  "head",
  "calm_cross",
  "tail",
  "tail_strong",
];
const RANKING_KEYS = ["tail_strong", "head_strong"];
const TECHNIQUES = [
  ["逃げ", "nige"],
  ["差し", "sashi"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
  ["抜き", "nuki"],
  ["恵まれ", "megumare"],
];

const SHOW_MIN_N = 1000;
const REFERENCE_MIN_N = 300;

// バーの目盛り（1コース1着率 %）。全会場・会場別とも同じ尺度で描く
const SCALE_MIN = 30;
const SCALE_MAX = 75;
const toPos = (rate) =>
  Math.max(
    0,
    Math.min(100, ((rate - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100),
  );

const formatDiff = (d) =>
  d > 0 ? `+${d.toFixed(1)}` : d < 0 ? `−${Math.abs(d).toFixed(1)}` : "±0.0";
const diffTone = (d) => (d <= -0.5 ? "is-down" : d >= 0.5 ? "is-up" : "");

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

export default function WeatherInEscapeChart({ initialVenueCode = null }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [venue, setVenue] = useState(
    initialVenueCode != null ? String(Number(initialVenueCode)) : "1",
  );
  const [rankingKey, setRankingKey] = useState("tail_strong");

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        console.error("風とイン逃げ率の集計の取得に失敗:", err?.message ?? err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (failed) {
    return (
      <InlineFetchError
        message={t("weatherInEscape.fetchError")}
        onRetry={() => {
          setFailed(false);
          setReloadKey((n) => n + 1);
        }}
      />
    );
  }
  if (!data) {
    return <div className="empty-state">{t("weatherInEscape.loading")}</div>;
  }

  const base = data.overallInWinRate;
  const binLabel = (key) => t(`weatherInEscape.bins.${key}`);
  const binSub = (key) => t(`weatherInEscape.binSubs.${key}`);
  const venueName = (code) => t(`venues.${code}`, code);
  // URL の venue_code が集計に無い値なら、最初の会場にする
  const selectedVenue = data.venues[venue]
    ? venue
    : Object.keys(data.venues)[0];
  const venueData = data.venues[selectedVenue];
  const [ciLowTail, ciHighTail] = data.pooled.tail_strong.ci;
  const [ciLowHead, ciHighHead] = data.pooled.head_strong.ci;
  const period = {
    from: data.period.from.slice(0, 7).replace("-", "/"),
    to: data.period.to.slice(0, 7).replace("-", "/"),
  };

  const ranking = Object.entries(data.venues)
    .map(([code, v]) => ({ code, ...(v.bins[rankingKey] ?? { n: 0 }) }))
    .filter((v) => v.n >= SHOW_MIN_N)
    .sort((a, b) => a.diff - b.diff);
  const excluded = Object.entries(data.venues)
    .filter(([, v]) => (v.bins[rankingKey]?.n ?? 0) < SHOW_MIN_N)
    .map(([code]) => venueName(code));

  return (
    <div className="wie" data-testid="weather-in-escape">
      <p className="wie-lead">{t("weatherInEscape.lead")}</p>
      <div className="wie-grid">
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
            {WIND_BIN_KEYS.map((key) => {
              const counts = data.techniques[key];
              const total = TECHNIQUES.reduce(
                (s, [name]) => s + (counts[name] ?? 0),
                0,
              );
              const share = (name) => ((counts[name] ?? 0) / total) * 100;
              const aria = TECHNIQUES.map(
                ([name]) =>
                  `${translateTechnique(t, name)} ${share(name).toFixed(1)}%`,
              ).join(t("listSeparator"));
              return (
                <div
                  className="wie-tech-row"
                  key={key}
                  data-testid={`wie-technique-${key}`}
                >
                  <span className="wie-tech-row__label">{binLabel(key)}</span>
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
                        ([name, v]) =>
                          `${translateTechnique(t, name)} ${v.toFixed(1)}%`,
                      )
                      .join(t("listSeparator"))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="wie-note">{t("weatherInEscape.techniqueNote")}</p>
        </section>

        <section className="wie-card">
          <h3>
            <label htmlFor="wie-venue">{t("weatherInEscape.venueTitle")}</label>
          </h3>
          <select
            id="wie-venue"
            className="venue-select"
            value={selectedVenue}
            onChange={(e) => setVenue(e.target.value)}
          >
            {Object.keys(data.venues).map((code) => (
              <option key={code} value={code}>
                {venueName(code)}
              </option>
            ))}
          </select>
          {venueData && (
            <>
              <p className="wie-note">
                {t("weatherInEscape.venueAverage", {
                  venue: venueName(selectedVenue),
                  rate: venueData.rate.toFixed(1),
                  count: venueData.n,
                  countText: venueData.n.toLocaleString(),
                })}
              </p>
              <div className="wie-rows" data-testid="wie-venue-rows">
                {WIND_BIN_KEYS.map((key) => {
                  const b = venueData.bins[key];
                  if (!b || b.n < REFERENCE_MIN_N) {
                    return (
                      <div className="wie-row is-hidden-value" key={key}>
                        <div className="wie-row__label">
                          {binLabel(key)}
                          <small>{binSub(key)}</small>
                        </div>
                        <div className="wie-row__few">
                          {t("weatherInEscape.tooFew")}
                        </div>
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
                  return (
                    <DiffBar
                      key={key}
                      label={binLabel(key)}
                      sub={binSub(key)}
                      rate={b.rate}
                      base={venueData.rate}
                      diff={b.diff}
                      n={b.n}
                      tier={b.n < SHOW_MIN_N ? "reference" : null}
                    />
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="wie-card">
          <h3>{t("weatherInEscape.rankingTitle")}</h3>
          <p className="wie-note">{t("weatherInEscape.rankingLead")}</p>
          <div
            className="wie-seg"
            role="group"
            aria-label={t("weatherInEscape.rankingTitle")}
          >
            {RANKING_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={rankingKey === key}
                onClick={() => setRankingKey(key)}
              >
                {binLabel(key)}
              </button>
            ))}
          </div>
          <div className="wie-table-wrap">
            <table className="wie-table" data-testid="wie-ranking">
              <thead>
                <tr>
                  <th scope="col">{t("analysis.rankHeader")}</th>
                  <th scope="col">{t("analysis.venueHeader")}</th>
                  <th scope="col">{t("weatherInEscape.diffHeader")}</th>
                  <th scope="col">{t("weatherInEscape.rateHeader")}</th>
                  <th scope="col">{t("weatherInEscape.countHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((v, i) => (
                  <tr key={v.code}>
                    <td>{i + 1}</td>
                    <td>{venueName(v.code)}</td>
                    <td className={diffTone(v.diff)}>
                      {t("weatherInEscape.diffPt", {
                        diff: formatDiff(v.diff),
                      })}
                    </td>
                    <td>{v.rate.toFixed(1)}%</td>
                    <td>{v.n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {excluded.length > 0 && (
            <p className="wie-note">
              {t("weatherInEscape.rankingExcluded", {
                venues: excluded.join(t("listSeparator")),
              })}
            </p>
          )}
        </section>
      </div>

      <ul className="wie-footnotes">
        <li>
          {t("weatherInEscape.footSource", {
            from: period.from,
            to: period.to,
            count: data.rows,
            countText: data.rows.toLocaleString(),
          })}
        </li>
        <li>{t("weatherInEscape.footTiming")}</li>
        <li>
          {t("weatherInEscape.footAdjusted", {
            head: formatDiff(data.pooled.head_strong.adjustedDiff),
            tail: formatDiff(data.pooled.tail_strong.adjustedDiff),
          })}
        </li>
        <li>
          {t("weatherInEscape.footWave", {
            diff: formatDiff(data.wave.w6_9.diff),
            count: data.wave.w6_9.n,
            countText: data.wave.w6_9.n.toLocaleString(),
          })}
        </li>
      </ul>
    </div>
  );
}
