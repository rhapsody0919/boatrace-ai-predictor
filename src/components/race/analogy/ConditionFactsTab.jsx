import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "./NoteList";
import ScopeCombo from "./ScopeCombo";
import BoatBadge from "../BoatBadge";
import FactRadar from "./FactRadar";
import FactCard from "./FactCard";
import WindWaveFacts from "./WindWaveFacts";
import AiOutlook from "./AiOutlook";
import { SCOPE_LINE } from "./analogyColors";
import {
  FACT_ITEMS,
  boatScopeKey,
  factRows,
  hidesSeriesScoreLine,
  openCardKeys,
  parseScopeKey,
  radarBoats,
  rateOf,
  scopeKind,
  seriesScoreNote,
  todayPosition,
  todayValues,
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
 * 差がつく材料（タブ1、spec FR-A・FR-E、screens S-1a）
 * @param {{data: object, stage: "racecard"|"exhibition", target: 1|2|3}} props data は facts の応答
 */
export default function ConditionFactsTab({ data, stage, target, feedback }) {
  const { t } = useTranslation();
  const [boat, setBoat] = useState(1);
  const cardsRef = useRef(null);
  // 手で選んだ範囲の種類（VC・NC・NCR・VA）。選んでいなければ既定（screens「細部の約束」）
  const [pickedKind, setPickedKind] = useState(null);

  const { today, facts, exhibition } = data;
  const exhibitionStage = stage === "exhibition";
  const keys = today.scope_keys[String(boat)] ?? {};
  const kinds = FACT_SCOPES.filter((s) => keys[s] && facts[keys[s]]);
  const countOf = (key) => facts[key]?.n ?? null;
  // 七角形・項目の表の6艇も同じ関数で集めたレースを決める（どこで見ても同じ艇・同じ項目は同じ数字。2026-10-09）
  const { key: scopeKey, def } = boatScopeKey(keys, countOf, pickedKind);
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
  const scope = scopeName(scopeKey, t, { short: true });
  const venue = today.venue_code;

  const rankOf = (key, b) => {
    const v = vs(key);
    return v
      ? (todayPosition(v, FACT_ITEMS.find((i) => i.key === key).hib, b)
          ?.bucket ?? null)
      : null;
  };
  // 七角形の軸（ボート2連率は着順との関係が小さい項目なので入れない。承認モック mock-compare-v3）
  const radarItems = items.filter((it) => it.key !== "boat_2");
  const radar = radarBoats(
    today,
    facts,
    values,
    radarItems,
    target,
    pickedKind,
  );
  const openCard = (key) => {
    const el = cardsRef.current?.querySelector(`[data-key="${key}"]`);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const usual = usualOf(scopeFacts, boat, target);
  const rows = scopeFacts
    ? factRows(scopeFacts, boat, target, exhibitionStage)
    : [];
  const note = seriesScoreNote(today);
  const hideSeriesLine = hidesSeriesScoreLine(today);
  const cls = uniformClass(today);
  const rateName = t(`aiPredictionTab.analogy.rateName.${target}`);
  const openKeys = openCardKeys(rows.filter((r) => r.key !== "boat_2"));
  const card = (row) => (
    <FactCard
      // 艇・着順・範囲・時点が変わったら作り直す（開閉の初期値「差が大きいの上位2枚」を判定に合わせ直す。時点で展示タイムのカードが増減する）
      key={`${row.key}:${boat}:${target}:${scopeKey}:${stage}`}
      venueName={venueLabel(venue, t)}
      row={row}
      boat={boat}
      scopeFacts={scopeFacts}
      values={vs(row.key)}
      target={target}
      todayPos={
        row.key === "series_score" && finalDay ? null : rankOf(row.key, boat)
      }
      hideLine={row.key === "series_score" && hideSeriesLine}
      note={row.key === "series_score" ? note : null}
      initiallyOpen={openKeys.has(row.key)}
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
        <div
          className="af-seg"
          role="group"
          aria-labelledby="af-boat-label"
          data-af-control="facts_boat"
        >
          {[1, 2, 3, 4, 5, 6].map((b) => (
            <button
              key={b}
              type="button"
              className="af-boat-btn"
              aria-pressed={boat === b}
              onClick={() => setBoat(b)}
            >
              <BoatBadge n={b} />
            </button>
          ))}
        </div>
      </div>
      <div className="af-ctl-row">
        <span className="af-lbl" id="af-fscope-label">
          {t(`${k}.scopeLabel`)}
        </span>
        <div
          className="af-seg"
          role="group"
          aria-labelledby="af-fscope-label"
          data-af-control="facts_scope"
        >
          {kinds.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={keys[s] === scopeKey}
              onClick={() => setPickedKind(s)}
            >
              {scopeName(keys[s], t, { short: true })}
            </button>
          ))}
        </div>
      </div>
      <ScopeCombo scopeKey={scopeKey} />
      {showFellBack && (
        <p className="af-sub">
          {t(`${k}.fellBack`, {
            venue: venueLabel(venue, t),
            n: fmtCount(def.vcCount),
          })}
        </p>
      )}
      <FactRadar
        // 主役・着順・時点・範囲が変わったら、重ねる艇・太くする艇・開いた表を選び直す
        key={`${boat}:${target}:${stage}:${pickedKind ?? ""}`}
        boats={radar}
        items={radarItems}
        main={boat}
        target={target}
        onCard={openCard}
      />
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
      <h4 className="af-h4">{t(`${k}.orderHeading`)}</h4>
      {/* 棒の見方はカードごとに繰り返さず、ここに凡例で1回だけ出す（承認モック sonar-tab v3） */}
      <div className="af-legend af-card-legend">
        <span>
          <i className="af-sw-bar" style={{ background: SCOPE_LINE[boat] }} />
          {t(`${k}.legendBar`, { rate: rateName })}
        </span>
        <span>
          <i className="af-sw-today" />
          {t(`${k}.legendToday`)}
        </span>
        {usual && (
          <span>
            <i className="af-sw-usual" />
            {t(`${k}.legendUsual`, { scope, usual: fmtPct(rateOf(usual), 1) })}
          </span>
        )}
      </div>
      <div className="af-cards" ref={cardsRef}>
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
      <WindWaveFacts
        exhibition={exhibition}
        vaFacts={keys.VA ? facts[keys.VA] : null}
        venue={venue}
        target={target}
        exhibitionStage={exhibitionStage}
      />
      {feedback}
      {/* 割合の出し方・注意は一番下の折りたたみ1つにまとめる（承認モック sonar-tab v3。中身は1文ずつの箇条書きのまま） */}
      <NotesFold title={t("aiPredictionTab.analogy.notes.methodCaution")}>
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.counting`)}
          texts={[
            t(`${k}.foot.scope`, {
              desc: t(`${k}.scopeDesc.${kind}`, {
                venue: venueLabel(venue, t),
                boat,
              }),
            }),
            finalNcr && t(`${k}.foot.finalNcr`),
            t(`${k}.foot.series`),
          ]}
        />
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.caution`)}
          texts={[
            t(`${k}.foot.common`),
            t(`${k}.foot.overlap`),
            exhibitionStage ? t(`${k}.foot.exhPost`) : t(`${k}.foot.exhPre`),
          ]}
        />
      </NotesFold>
      <AiOutlook boat={boat} target={target} stage={stage} />
    </div>
  );
}
