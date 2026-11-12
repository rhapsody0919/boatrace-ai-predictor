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

/** 本文の種類。朝のバッチがこの一覧を作る前の版（BOA-823 より前）は races が無く notReady。一覧を消した2年より前の日は、節全体が「もう無い」の1行になる（BOA-807） */
function bodyKind(res, races, rows) {
  if (res.status === "error") return "error";
  if (res.status !== "ready") return "loading";
  if (!races) return "notReady";
  if (!rows.length) return "none";
  return "list";
}

/** 1レース分の行（行全体がそのレースの結果へのリンク） */
function RaceRow({ r }) {
  const { t } = useTranslation();
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
              ? t(`aiPredictionTab.analogy.techniques.${r.tech}`, r.tech)
              : "—",
            yen: r.payout === null ? "—" : r.payout.toLocaleString("ja-JP"),
          })}
        </span>
      </span>
      <span className="af-rl-go" aria-hidden="true">
        ›
      </span>
    </>
  );
  return (
    <li>
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
}

/** 行の一覧と「もっと見る」 */
function RaceList({ shown, rows, more, onMore }) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="af-rl">
        {shown.map((r) => (
          <RaceRow key={r.race_id} r={r} />
        ))}
      </ul>
      {rows.length > RACE_LIST_FIRST && !more && (
        <button type="button" className="af-rl-more" onClick={onMore}>
          {t(`${k}.more`, { n: Math.min(rows.length, RACE_LIST_MORE) })}
        </button>
      )}
    </>
  );
}

/** 状態ごとの本文（エラー・読み込み中・未作成・0件・一覧） */
function PanelBody({ res, races, rows, shown, more, onMore }) {
  const { t } = useTranslation();
  const kind = bodyKind(res, races, rows);
  if (kind === "error")
    return (
      <p className="af-foot">
        {t(`${k}.error`)}{" "}
        <button type="button" className="af-link" onClick={res.retry}>
          {t(`${k}.retry`)}
        </button>
      </p>
    );
  if (kind === "loading") return <p className="af-foot">{t(`${k}.loading`)}</p>;
  if (kind === "notReady")
    return <p className="af-foot">{t(`${k}.notReady`)}</p>;
  if (kind === "none")
    return (
      <p className="af-foot">
        {t(`${k}.none`, { kept: fmtCount(races.kept) })}
      </p>
    );
  return <RaceList shown={shown} rows={rows} more={more} onMore={onMore} />;
}

/** 件数・打ち切り・別の範囲の注記 */
function PanelNotes({ races, rows, shown, cond, otherScope }) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}

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
      <PanelNotes
        races={races}
        rows={rows}
        shown={shown}
        cond={cond}
        otherScope={otherScope}
      />
      <PanelBody
        res={res}
        races={races}
        rows={rows}
        shown={shown}
        more={more}
        onMore={() => setMore(true)}
      />
    </div>
  );
}
