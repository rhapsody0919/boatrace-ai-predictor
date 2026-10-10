import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { fmtCount, fmtDate, venueLabel } from "../../../utils/analogyFormat";
import {
  RACE_LIST_FIRST,
  RACE_LIST_MORE,
  raceListRows,
} from "../../../utils/analogyAggregate";
import { similarRaceLink } from "../../../utils/analogySimilarDisplay";

const k = "aiPredictionTab.analogy.scenario.races";

/**
 * STEP4 の件数を押したときに、その図の下に開く元のレースの一覧（BOA-823、承認モック mock-scenario-race-links-v2）。
 * 見出し（押した物・件数・✕）→ 選んでいる進入・形 → 1件2段の行（行全体がそのレースの結果へのリンク）→ もっと見る。
 * 一覧は範囲ごとに直近3,000件まで（scope_races）なので、件数はその中で数え、超える範囲は1行で断る
 * @param {{res: {status: string, data: object|null, retry: () => void}, pick: object, filter: object,
 *   title: string, cond: string, otherScope?: boolean, onClose: () => void}} props
 *   res は useAnalogyScenarioRaces の戻り値、filter は raceListRows の絞り（entry・form・first・not1）
 */
export default function ScenarioRacePanel({
  res,
  pick,
  filter,
  title,
  cond,
  otherScope = false,
  onClose,
}) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const races = res.status === "ready" ? (res.data?.races ?? null) : null;
  const rows = races ? raceListRows(races, { ...filter, pick }) : [];
  const shown = rows.slice(0, more ? RACE_LIST_MORE : RACE_LIST_FIRST);
  let body;
  if (res.status === "error")
    body = (
      <p className="af-foot">
        {t(`${k}.error`)}{" "}
        <button type="button" className="af-link" onClick={res.retry}>
          {t(`${k}.retry`)}
        </button>
      </p>
    );
  else if (res.status !== "ready")
    body = <p className="af-foot">{t(`${k}.loading`)}</p>;
  // 朝のバッチがこの一覧を作る前の版（BOA-823 より前）
  else if (!races) body = <p className="af-foot">{t(`${k}.notReady`)}</p>;
  else if (!rows.length)
    body = (
      <p className="af-foot">
        {t(`${k}.none`, { kept: fmtCount(races.kept) })}
      </p>
    );
  else
    body = (
      <>
        <ul className="af-rl">
          {shown.map((r) => {
            const link = similarRaceLink(r.race_id);
            const [, , , venue, rn] = r.race_id.split("-");
            const inner = (
              <>
                <span className="af-rl-main">
                  <span className="af-rl-l1">
                    <b className="af-num">{fmtDate(r.race_id.slice(0, 10))}</b>
                    {venueLabel(Number(venue), t)}
                    {t(`${k}.raceNo`, { n: Number(rn) })}
                    <span className="af-bnrow">
                      {r.finish.map((b, i) => (
                        <BoatBadge key={i} n={b} size="xs" />
                      ))}
                    </span>
                  </span>
                  <span className="af-rl-l2">
                    {t(`${k}.techPay`, {
                      tech: r.tech
                        ? t(
                            `aiPredictionTab.analogy.techniques.${r.tech}`,
                            r.tech,
                          )
                        : "—",
                      yen:
                        r.payout === null
                          ? "—"
                          : r.payout.toLocaleString("ja-JP"),
                    })}
                  </span>
                </span>
                <span className="af-rl-go" aria-hidden="true">
                  ›
                </span>
              </>
            );
            return (
              <li key={r.race_id}>
                {link ? (
                  <a
                    className="af-rl-row"
                    href={link.href}
                    data-af-control="scenario_race_open"
                    {...(link.internal
                      ? {}
                      : { target: "_blank", rel: "noopener noreferrer" })}
                  >
                    {inner}
                  </a>
                ) : (
                  <span className="af-rl-row">{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
        {rows.length > RACE_LIST_FIRST && !more && (
          <button
            type="button"
            className="af-rl-more"
            onClick={() => setMore(true)}
          >
            {t(`${k}.more`, { n: Math.min(rows.length, RACE_LIST_MORE) })}
          </button>
        )}
      </>
    );
  return (
    <div className="af-rl-panel" data-testid="analogy-race-panel">
      <div className="af-rl-h">
        <b>{title}</b>
        <button
          type="button"
          className="af-rl-x"
          aria-label={t(`${k}.close`)}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {races && rows.length > 0 && (
        <p className="af-foot">
          {t(`${k}.count`, {
            m: fmtCount(rows.length),
            k: Math.min(shown.length, rows.length),
          })}
          {t("aiPredictionTab.analogy.listComma")}
          {cond}
        </p>
      )}
      {races && races.kept < races.n && (
        <p className="af-foot">
          {t(`${k}.capped`, {
            n: fmtCount(races.n),
            kept: fmtCount(races.kept),
          })}
        </p>
      )}
      {otherScope && <p className="af-foot">{t(`${k}.otherScope`)}</p>}
      {body}
    </div>
  );
}
