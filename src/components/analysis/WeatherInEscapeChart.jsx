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
import { useLocation, useNavigate } from "react-router-dom";
import InlineFetchError from "../InlineFetchError";
import "./WeatherInEscapeChart.css";
import {
  WIND_BIN_KEYS,
  RANKING_KEYS,
  REFERENCE_MIN_N,
  formatDiff,
  diffTone,
} from "./weatherInEscapeScale.js";
import {
  DiffBar,
  PooledCard,
  TechniqueCard,
  HiddenVenueRow,
} from "./WeatherInEscapeCards.jsx";

const DATA_URL = "/data/weather-in-escape.json";

const SHOW_MIN_N = 1000;

function VenueRows({ venueData, binLabel, binSub }) {
  return (
    <div className="wie-rows" data-testid="wie-venue-rows">
      {WIND_BIN_KEYS.map((key) => {
        const b = venueData.bins[key];
        if (!b || b.n < REFERENCE_MIN_N) {
          return (
            <HiddenVenueRow
              key={key}
              b={b}
              label={binLabel(key)}
              sub={binSub(key)}
            />
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
  );
}

function VenueCard({
  data,
  selectedVenue,
  venueData,
  selectVenue,
  binLabel,
  binSub,
  venueName,
}) {
  const { t } = useTranslation();
  return (
    <section className="wie-card">
      <h3>
        <label htmlFor="wie-venue">{t("weatherInEscape.venueTitle")}</label>
      </h3>
      <select
        id="wie-venue"
        className="venue-select"
        value={selectedVenue}
        onChange={(e) => selectVenue(e.target.value)}
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
          <VenueRows
            venueData={venueData}
            binLabel={binLabel}
            binSub={binSub}
          />
        </>
      )}
    </section>
  );
}

function RankingCard({
  data,
  rankingKey,
  setRankingKey,
  binLabel,
  venueName,
}) {
  const { t } = useTranslation();
  const ranking = Object.entries(data.venues)
    .map(([code, v]) => ({ code, ...(v.bins[rankingKey] ?? { n: 0 }) }))
    .filter((v) => v.n >= SHOW_MIN_N)
    .sort((a, b) => a.diff - b.diff);
  const excluded = Object.entries(data.venues)
    .filter(([, v]) => (v.bins[rankingKey]?.n ?? 0) < SHOW_MIN_N)
    .map(([code]) => venueName(code));

  return (
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
  );
}

function Footnotes({ data }) {
  const { t } = useTranslation();
  const period = {
    from: data.period.from.slice(0, 7).replace("-", "/"),
    to: data.period.to.slice(0, 7).replace("-", "/"),
  };
  return (
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
  );
}

export default function WeatherInEscapeChart({ initialVenueCode = null }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [venue, setVenue] = useState(
    initialVenueCode != null ? String(Number(initialVenueCode)) : "1",
  );
  const [rankingKey, setRankingKey] = useState("tail_strong");

  // 共有・再読み込みでも選んだ会場を開く。会場の変更では履歴を積まない。
  const selectVenue = (code) => {
    setVenue(code);
    const next = new URLSearchParams(location.search);
    next.set("venue_code", code);
    navigate({ search: `?${next.toString()}` }, { replace: true });
  };

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

  return (
    <div className="wie" data-testid="weather-in-escape">
      <p className="wie-lead">{t("weatherInEscape.lead")}</p>
      <div className="wie-grid">
        <PooledCard
          data={data}
          base={base}
          binLabel={binLabel}
          binSub={binSub}
        />
        <TechniqueCard data={data} binLabel={binLabel} />
        <VenueCard
          data={data}
          selectedVenue={selectedVenue}
          venueData={venueData}
          selectVenue={selectVenue}
          binLabel={binLabel}
          binSub={binSub}
          venueName={venueName}
        />
        <RankingCard
          data={data}
          rankingKey={rankingKey}
          setRankingKey={setRankingKey}
          binLabel={binLabel}
          venueName={venueName}
        />
      </div>

      <Footnotes data={data} />
    </div>
  );
}
