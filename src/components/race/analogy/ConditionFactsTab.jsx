import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import FactHexagon from "./FactHexagon";
import FactCard from "./FactCard";
import WindWaveFacts from "./WindWaveFacts";
import AiOutlook from "./AiOutlook";
import { SCOPE_DASH, SCOPE_LINE } from "./analogyColors";
import {
  FACT_ITEMS,
  defaultScope,
  factRows,
  hidesSeriesScoreLine,
  parseScopeKey,
  rateOf,
  scopeKind,
  seriesScoreNote,
  todayPosition,
  todayValues,
  typicalRanks,
  uniformClass,
  usualOf,
} from "../../../utils/analogyFacts";
import {
  fmtCount,
  fmtDate,
  fmtPct,
  scopeName,
  venueLabel,
} from "../../../utils/analogyFormat";

const k = "aiPredictionTab.analogy.facts";
const FACT_SCOPES = ["VC", "NC", "NCR", "VA"];

/**
 * 来る艇の条件（タブ1、spec FR-A・FR-E、screens S-1a）
 * @param {{data: object, stage: "racecard"|"exhibition", target: 1|2|3}} props data は facts の応答
 */
export default function ConditionFactsTab({ data, stage, target }) {
  const { t } = useTranslation();
  const [boat, setBoat] = useState(1);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBoat, setCompareBoat] = useState(2);
  // 手で選んだ範囲の種類（VC・NC・NCR・VA）。選んでいなければ既定（screens「細部の約束」）
  const [pickedKind, setPickedKind] = useState(null);

  const { today, facts, exhibition } = data;
  const exhibitionStage = stage === "exhibition";
  const keys = today.scope_keys[String(boat)] ?? {};
  const kinds = FACT_SCOPES.filter((s) => keys[s] && facts[keys[s]]);
  const countOf = (key) => facts[key]?.n ?? null;
  const def = defaultScope(keys, countOf);
  const scopeKey = pickedKind && keys[pickedKind] ? keys[pickedKind] : def.key;
  const scopeFacts = facts[scopeKey];
  const showFellBack = !pickedKind && def.fellBack;
  const values = todayValues(today, exhibition);
  // 優勝戦・準優勝戦の日は、今節の平均着順点の順位がほぼ枠の順になるので、六角形の軸とカードの今日の枠を
  // 出さない（率と注記は出す。2026-10-05 ユーザー決定 Q-F1、spec A-4 Q7 の延長）
  const finalDay = hidesSeriesScoreLine(today);
  const items = FACT_ITEMS.filter(
    (it) =>
      (exhibitionStage || it.key !== "exh_time") &&
      !(finalDay && it.key === "series_score"),
  );
  const vs = (key) => values[key] ?? null;
  const cmp = compareOpen && compareBoat !== boat ? compareBoat : null;
  const scope = scopeName(scopeKey, t);
  const venue = today.venue_code;

  const selectBoat = (b) => {
    setBoat(b);
    if (compareBoat === b) setCompareBoat(b === 6 ? 5 : b + 1);
  };
  const rankOf = (key, b) => {
    const v = vs(key);
    return v
      ? (todayPosition(v, FACT_ITEMS.find((i) => i.key === key).hib, b)
          ?.bucket ?? null)
      : null;
  };
  const axes = items.map((it) => {
    const r = rankOf(it.key, boat);
    return {
      label: t(`${k}.items.${it.key}.short`),
      sub: r ? t(`${k}.hexRank`, { rank: r }) : t(`${k}.hexNone`),
    };
  });
  const hexAria = t(`${k}.hexLabel`, {
    boat,
    list: items
      .map((it) => {
        const r = rankOf(it.key, boat);
        return `${t(`${k}.items.${it.key}.label`)} ${r ? t(`${k}.hexRank`, { rank: r }) : t(`${k}.hexNone`)}`;
      })
      .join(t("aiPredictionTab.analogy.listSeparator")),
  });

  const usual = usualOf(scopeFacts, boat, target);
  const rows = scopeFacts
    ? factRows(scopeFacts, boat, target, exhibitionStage)
    : [];
  const note = seriesScoreNote(today);
  const hideSeriesLine = hidesSeriesScoreLine(today);
  const cls = uniformClass(today);
  const rateName = t(`aiPredictionTab.analogy.rateName.${target}`);
  const card = (row) => (
    <FactCard
      key={row.key}
      venueName={venueLabel(venue, t)}
      row={row}
      boat={boat}
      compareBoat={cmp}
      scopeFacts={scopeFacts}
      values={vs(row.key)}
      target={target}
      todayPos={
        row.key === "series_score" && finalDay ? null : rankOf(row.key, boat)
      }
      hideLine={row.key === "series_score" && hideSeriesLine}
      note={row.key === "series_score" ? note : null}
    />
  );
  const kind = scopeKind(scopeKey);
  const parsed = parseScopeKey(scopeKey);
  const finalNcr = kind === "NCR" && parsed.round === "yusho";

  return (
    <div className="af-tab-facts">
      <h3 className="af-h3">
        {t(`${k}.heading`, {
          boat,
          finish: t(`aiPredictionTab.analogy.finishWord.${target}`),
        })}
      </h3>
      <div className="af-ctl-row">
        <span className="af-lbl" id="af-boat-label">
          {t(`${k}.boatLabel`)}
        </span>
        <div className="af-seg" role="group" aria-labelledby="af-boat-label">
          {[1, 2, 3, 4, 5, 6].map((b) => (
            <button
              key={b}
              type="button"
              className="af-boat-btn"
              aria-pressed={boat === b}
              onClick={() => selectBoat(b)}
            >
              <BoatBadge n={b} />
            </button>
          ))}
        </div>
      </div>
      <details
        className="af-details"
        open={compareOpen}
        onToggle={(e) => setCompareOpen(e.currentTarget.open)}
      >
        <summary>{t(`${k}.compare`)}</summary>
        <label className="af-ctl-row af-lbl">
          {t(`${k}.compareSelect`)}
          <select
            value={compareBoat}
            onChange={(e) => setCompareBoat(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6]
              .filter((b) => b !== boat)
              .map((b) => (
                <option key={b} value={b}>
                  {t("aiPredictionTab.analogy.boat", { n: b })}
                </option>
              ))}
          </select>
        </label>
      </details>
      <div className="af-ctl-row">
        <span className="af-lbl" id="af-fscope-label">
          {t(`${k}.scopeLabel`)}
        </span>
        <div className="af-seg" role="group" aria-labelledby="af-fscope-label">
          {kinds.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={keys[s] === scopeKey}
              onClick={() => setPickedKind(s)}
            >
              {scopeName(keys[s], t)}
            </button>
          ))}
        </div>
      </div>
      {showFellBack && (
        <p className="af-sub">
          {t(`${k}.fellBack`, {
            venue: venueLabel(venue, t),
            n: fmtCount(def.vcCount),
          })}
        </p>
      )}
      <div className="af-dark">
        <FactHexagon
          axes={axes}
          ariaLabel={hexAria}
          series={[
            {
              values: typicalRanks(scopeFacts, boat, target, items),
              boat,
              dash: true,
            },
            { values: items.map((it) => rankOf(it.key, boat)), boat },
            ...(cmp
              ? [{ values: items.map((it) => rankOf(it.key, cmp)), boat: cmp }]
              : []),
          ]}
        />
      </div>
      <div className="af-legend">
        <span style={{ "--af-line": SCOPE_LINE[boat] }}>
          <i />
          {t(`${k}.hexToday`, { boat })}
        </span>
        {cmp && (
          <span style={{ "--af-line": SCOPE_LINE[cmp] }}>
            <i />
            {t(`${k}.hexTodayB`, { boat: cmp })}
          </span>
        )}
        <span style={{ "--af-line": SCOPE_DASH }}>
          <i className="is-dash" />
          {t(`${k}.hexTypical`, {
            scope,
            boat,
            finish: t(`aiPredictionTab.analogy.finishWord.${target}`),
          })}
        </span>
      </div>
      <p className="af-foot">{t(`${k}.hexFoot`)}</p>
      {usual && (
        <div className="af-big">
          <span>{t(`${k}.bigLabel`, { scope, boat, rate: rateName })}</span>
          <b>{fmtPct(rateOf(usual), 1)}</b>
          <small>
            {t(`${k}.bigCount`, {
              hits: fmtCount(usual[0]),
              n: fmtCount(usual[1]),
              period: t("aiPredictionTab.analogy.period", {
                from: fmtDate(scopeFacts.period?.[0]),
                to: fmtDate(scopeFacts.period?.[1]),
              }),
            })}
          </small>
        </div>
      )}
      <p className="af-sub">{t(`${k}.lede`, { rate: rateName })}</p>
      <div className="af-cards">
        {rows.filter((r) => r.key !== "boat_2").map(card)}
        {rows
          .filter((r) => r.key === "boat_2")
          .map((r) => (
            <details key="boat" className="af-details">
              <summary>{t(`${k}.boatFold`)}</summary>
              <p className="af-sub">{t(`${k}.boatFoldNote`)}</p>
              {card(r)}
            </details>
          ))}
      </div>
      {cls && <p className="af-foot">{t(`${k}.classLine`, { cls })}</p>}
      {/* 注意を1段落に詰めず、1つずつ行に分ける（375px で読まれないため。BOA-778） */}
      <ul className="af-foot af-foot-list">
        <li>
          {t(`${k}.foot.scope`, {
            desc: t(`${k}.scopeDesc.${kind}`, {
              venue: venueLabel(venue, t),
              boat,
            }),
          })}
        </li>
        {finalNcr && <li>{t(`${k}.foot.finalNcr`)}</li>}
        <li>{t(`${k}.foot.series`)}</li>
        <li>{t(`${k}.foot.common`)}</li>
        <li>
          {exhibitionStage ? t(`${k}.foot.exhPost`) : t(`${k}.foot.exhPre`)}
        </li>
      </ul>
      <WindWaveFacts
        exhibition={exhibition}
        vaFacts={keys.VA ? facts[keys.VA] : null}
        venue={venue}
        target={target}
        exhibitionStage={exhibitionStage}
      />
      <AiOutlook boat={boat} target={target} stage={stage} />
    </div>
  );
}
