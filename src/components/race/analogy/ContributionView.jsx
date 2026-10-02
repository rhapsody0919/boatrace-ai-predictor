/**
 * 寄与度（BOA-271 FR-1）: 主モデルの SHAP をテーマ別に合算した相対シェアを、レーダーとテーマ別の棒で見せる。
 * テーマは analogy_models.themes の配列から描く（数を固定しない）。総合点にはまとめない。
 * 既定の条件はこのレースの会場・グレード・ラウンド。レース数が30未満なら API が一段ずつ広げ、
 * 広げたことをここで書く。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useAnalogyContribution from "../../../hooks/useAnalogyContribution";
import {
  FINISH_TARGETS,
  GRADES,
  ROUNDS,
  themeEntries,
} from "../../../utils/analogyContribution";
import ContributionRadar from "./ContributionRadar";
import ContributionBreakdown from "./ContributionBreakdown";
import BoatCompareTable from "./BoatCompareTable";
import InlineFetchError from "../../InlineFetchError";

const BOATS = [1, 2, 3, 4, 5, 6];
const ym = (date) => (date ? String(date).slice(0, 7) : "");

export default function ContributionView({
  venueCode,
  venueName,
  defaultGrade,
  defaultRound,
  onStatus,
}) {
  const { t, i18n } = useTranslation();
  const [target, setTarget] = useState(1);
  const [grade, setGrade] = useState(defaultGrade || "all");
  const [round, setRound] = useState(defaultRound || "all");
  const [compare, setCompare] = useState(false);
  const [boatA, setBoatA] = useState(1);
  const [boatB, setBoatB] = useState(6);
  const [openTheme, setOpenTheme] = useState(null);
  const { status, data, retry } = useAnalogyContribution({
    venue: venueCode || 0,
    grade,
    round,
    target,
  });

  // 節の出し方（学習前は出さない・最初の結果が出るまで枠を描かない）は節が決める
  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);
  if (status === "unavailable") return null;

  const tr = (key, opts) => t(`aiPredictionTab.analogy.${key}`, opts);
  const gradeLabel = (g) => (g === "all" ? tr("all") : tr(`grades.${g}`));
  const roundLabel = (r) => (r === "all" ? tr("all") : tr(`rounds.${r}`));
  const themeName = (theme) =>
    t(`aiPredictionTab.analogy.themes.${theme.key}.name`, {
      defaultValue: theme.name,
    });
  const themeShort = (theme) =>
    t(`aiPredictionTab.analogy.themes.${theme.key}.short`, {
      defaultValue: theme.name,
    });

  const all = data?.boats?.[0];
  const entries = data
    ? themeEntries(data.themes, all.shares, all.share_sd)
    : [];
  const shareOf = (boat) => data?.boats?.[boat]?.shares;
  const radarSeries = compare
    ? [
        {
          key: "a",
          values: data
            ? data.themes.map((th) => shareOf(boatA)?.[th.key] ?? 0)
            : [],
        },
        {
          key: "b",
          values: data
            ? data.themes.map((th) => shareOf(boatB)?.[th.key] ?? 0)
            : [],
        },
      ]
    : [{ key: "all", values: entries.map((e) => e.share) }];
  const maxShare = Math.max(0.0001, ...entries.map((e) => e.share));
  const resolved = data?.resolved;

  return (
    <div className="af-contribution" aria-busy={status === "loading"}>
      <p className="af-lede">{tr("contribution.lede")}</p>

      <div className="af-controls">
        <div
          className="af-segment"
          role="tablist"
          aria-label={tr("targetsLabel")}
        >
          {FINISH_TARGETS.map((ft) => (
            <button
              key={ft}
              type="button"
              role="tab"
              aria-selected={target === ft}
              className={target === ft ? "is-active" : ""}
              onClick={() => setTarget(ft)}
            >
              {tr(`targets.${ft}`)}
            </button>
          ))}
        </div>

        <details className="af-conditions">
          <summary>{tr("conditions")}</summary>
          <div className="af-conditions-body">
            <label className="af-field">
              <span>{tr("grade")}</span>
              <select
                aria-label={tr("grade")}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              >
                {["all", ...GRADES].map((g) => (
                  <option key={g} value={g}>
                    {gradeLabel(g)}
                  </option>
                ))}
              </select>
            </label>
            <label className="af-field">
              <span>{tr("round")}</span>
              <select
                aria-label={tr("round")}
                value={round}
                onChange={(e) => setRound(e.target.value)}
              >
                {["all", ...ROUNDS].map((r) => (
                  <option key={r} value={r}>
                    {roundLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <div className="af-compare-controls">
          <label className="af-check">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            {tr("compare")}
          </label>
          {compare &&
            [
              ["boatA", boatA, setBoatA],
              ["boatB", boatB, setBoatB],
            ].map(([key, value, set]) => (
              <label className="af-field" key={key}>
                <span>{tr(key)}</span>
                <select
                  aria-label={tr(key)}
                  value={value}
                  onChange={(e) => set(Number(e.target.value))}
                >
                  {BOATS.map((b) => (
                    <option key={b} value={b}>
                      {tr("boatLabel", { n: b })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      </div>

      {status === "loading" && !data && (
        <p className="af-note" role="status">
          {tr("loading")}
        </p>
      )}
      {status === "error" && (
        <InlineFetchError message={tr("error")} onRetry={retry} />
      )}

      {data && (
        <>
          <p className="af-scope">
            {tr("scope", {
              venue: resolved.venue === 0 ? tr("venueAll") : venueName,
              grade: gradeLabel(resolved.grade),
              round: roundLabel(resolved.round),
            })}
          </p>
          {data.widened.length > 0 && (
            <p className="af-note af-widened">
              {tr("widened", {
                steps: data.widened
                  .map((s) => tr(`widenedSteps.${s}`))
                  .join(tr("listSeparator")),
              })}
            </p>
          )}

          <div className="af-body">
            <div className="af-figure">
              <div className="af-radar-wrap">
                <ContributionRadar
                  axes={data.themes.map((th) => ({
                    key: th.key,
                    label: themeShort(th),
                  }))}
                  series={radarSeries}
                  ariaLabel={tr("radarLabel")}
                />
                {compare && (
                  <p className="af-radar-legend">
                    <span className="af-legend-a">
                      {tr("boatLabel", { n: boatA })}
                    </span>
                    <span className="af-legend-b">
                      {tr("boatLabel", { n: boatB })}
                    </span>
                  </p>
                )}
              </div>

              <p className="af-meta">
                <span>
                  {tr("n", {
                    races: all.n_races.toLocaleString(i18n.language),
                    boats: all.n_boats.toLocaleString(i18n.language),
                  })}
                </span>
                <span>
                  {tr("period", {
                    from: ym(all.period_from),
                    to: ym(all.period_to),
                  })}
                </span>
                <span>{tr("model", { version: data.modelVersion })}</span>
                {data.smallSample && (
                  <span className="af-flag">{tr("smallSample")}</span>
                )}
              </p>
            </div>
            <div className="af-themes">
              {compare && (
                <BoatCompareTable
                  themes={data.themes}
                  boatA={boatA}
                  boatB={boatB}
                  sharesA={shareOf(boatA)}
                  sharesB={shareOf(boatB)}
                />
              )}

              <p className="af-list-label">
                {compare ? tr("listAllBoatsCompare") : tr("listAllBoats")}
              </p>
              <ul className="af-theme-list">
                {entries.map((e) => {
                  const open = openTheme === e.key;
                  const panelId = `af-breakdown-${e.key}`;
                  return (
                    <li key={e.key} className="af-theme">
                      <button
                        type="button"
                        className="af-theme-head"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => setOpenTheme(open ? null : e.key)}
                      >
                        <span className="af-chevron" aria-hidden="true">
                          ▶
                        </span>
                        <span className="af-theme-name">
                          {themeName(e)}
                          {e.rankDistinct && e.rank <= 3 && (
                            <span className="af-rank">
                              {tr("rank", { rank: e.rank })}
                            </span>
                          )}
                        </span>
                        <span className="af-theme-value">
                          {Math.round(e.share * 100)}%
                        </span>
                        <span className="af-bar-track" aria-hidden="true">
                          <span
                            className="af-bar-fill"
                            style={{ width: `${(e.share / maxShare) * 100}%` }}
                          />
                        </span>
                      </button>
                      {open && (
                        <ContributionBreakdown
                          id={panelId}
                          themeKey={e.key}
                          groups={e.groups || []}
                          items={all.breakdown?.[e.key]}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <p className="af-note">{tr("contribution.foot")}</p>
        </>
      )}
    </div>
  );
}
