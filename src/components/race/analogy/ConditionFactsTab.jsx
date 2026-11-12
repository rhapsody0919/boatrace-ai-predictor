import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { parseBoatParam, RACE_BOAT_PARAM } from "../../../utils/raceUrlState";
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
  radarAxisItems,
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

/** 状態（艇・手で選んだ範囲・カード欄の ref）。呼ぶ順は元のまま */
function useFactsControls() {
  const [searchParams] = useSearchParams();
  const [boat, setBoat] = useState(
    () => parseBoatParam(searchParams.get(RACE_BOAT_PARAM)) ?? 1,
  );
  const cardsRef = useRef(null);
  // 手で選んだ範囲の種類（VC・NC・NCR・VA）。選んでいなければ既定（screens「細部の約束」）
  const [pickedKind, setPickedKind] = useState(null);
  return { boat, setBoat, cardsRef, pickedKind, setPickedKind };
}

/** 範囲の決定（七角形・項目の表の6艇も同じ関数で集めたレースを決める。2026-10-09） */
function deriveScope(data, boat, pickedKind) {
  const { today, facts } = data;
  const keys = today.scope_keys[String(boat)] ?? {};
  const kinds = FACT_SCOPES.filter((s) => keys[s] && facts[keys[s]]);
  const countOf = (key) => facts[key]?.n ?? null;
  // どこで見ても同じ艇・同じ項目は同じ数字
  const { key: scopeKey, def } = boatScopeKey(keys, countOf, pickedKind);
  return {
    keys,
    kinds,
    scopeKey,
    def,
    scopeFacts: facts[scopeKey],
    showFellBack: !pickedKind && def.fellBack,
  };
}

/** カード・七角形・注記に使う派生の値（純関数） */
function deriveFacts({ data, stage, target, boat, pickedKind, t }) {
  const { today, facts, exhibition } = data;
  const exhibitionStage = stage === "exhibition";
  const sc = deriveScope(data, boat, pickedKind);
  const { scopeKey, scopeFacts } = sc;
  const values = todayValues(today, exhibition);
  // 節の初日は今節の平均着順点を今日に当てはめられないので、七角形の軸もカードも出さず1行で断る（BOA-802）
  const note = seriesScoreNote(today);
  const firstDay = note === "first";
  const vs = (key) => values[key] ?? null;
  const rankOf = (key, b) => {
    const v = vs(key);
    return v
      ? (todayPosition(v, FACT_ITEMS.find((i) => i.key === key).hib, b)
          ?.bucket ?? null)
      : null;
  };
  // 七角形の軸（ボート2連率・展示前の展示タイム・優勝戦と初日の今節の着順点は入れない）
  const radarItems = radarAxisItems(today, exhibitionStage);
  const radar = radarBoats(
    today,
    facts,
    values,
    radarItems,
    target,
    pickedKind,
  );
  const rows = scopeFacts
    ? factRows(scopeFacts, boat, target, exhibitionStage).filter(
        (r) => !(firstDay && r.key === "series_score"),
      )
    : [];
  const kind = scopeKind(scopeKey);
  return {
    ...sc,
    exhibitionStage,
    values,
    // 優勝戦・準優勝戦の日は、今節の平均着順点の順位がほぼ枠の順になるので、六角形の軸とカードの今日の枠を
    // 出さない（率と注記は出す。2026-10-05 ユーザー決定 Q-F1、spec A-4 Q7 の延長）
    finalDay: hidesSeriesScoreLine(today),
    note,
    firstDay,
    vs,
    rankOf,
    scope: scopeName(scopeKey, t, { short: true }),
    venue: today.venue_code,
    radarItems,
    radar,
    usual: usualOf(scopeFacts, boat, target),
    rows,
    hideSeriesLine: hidesSeriesScoreLine(today),
    cls: uniformClass(today),
    rateName: t(`aiPredictionTab.analogy.rateName.${target}`),
    openKeys: openCardKeys(rows.filter((r) => r.key !== "boat_2")),
    kind,
    finalNcr: kind === "NCR" && parseScopeKey(scopeKey).round === "yusho",
  };
}

/** 艇の選択 */
function BoatControl({ boat, setBoat }) {
  const { t } = useTranslation();
  return (
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
  );
}

/** 範囲の選択 */
function ScopeControl({ keys, kinds, scopeKey, setPickedKind }) {
  const { t } = useTranslation();
  return (
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
  );
}

/** 七角形の横の「いつもの率」の大きい数字 */
function UsualBig({ d, boat }) {
  const { t } = useTranslation();
  const { usual, scope, rateName, scopeFacts } = d;
  return (
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
  );
}

/** 棒の見方はカードごとに繰り返さず、ここに凡例で1回だけ出す（承認モック sonar-tab v3） */
function CardLegend({ d, boat }) {
  const { t } = useTranslation();
  const { usual, scope, rateName } = d;
  return (
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
          {t(`${k}.legendUsual`, {
            scope,
            usual: fmtPct(rateOf(usual), 1),
          })}
        </span>
      )}
    </div>
  );
}

/** 差のカード1枚 */
function factCard(d, { boat, target, stage }, t, row) {
  const { vs, scopeKey, finalDay, rankOf } = d;
  return (
    <FactCard
      // 艇・着順・範囲・時点が変わったら作り直す（開閉の初期値「差が大きいの上位2枚」を判定に合わせ直す。時点で展示タイムのカードが増減する）
      key={`${row.key}:${boat}:${target}:${scopeKey}:${stage}`}
      venueName={venueLabel(d.venue, t)}
      row={row}
      boat={boat}
      scopeFacts={d.scopeFacts}
      values={vs(row.key)}
      target={target}
      todayPos={
        row.key === "series_score" && finalDay ? null : rankOf(row.key, boat)
      }
      hideLine={row.key === "series_score" && d.hideSeriesLine}
      note={row.key === "series_score" ? d.note : null}
      initiallyOpen={d.openKeys.has(row.key)}
    />
  );
}

/** カードの並び（「ボート」は折りたたみの中） */
function FactCards({ d, ctx, cardsRef }) {
  const { t } = useTranslation();
  const { rows } = d;
  const card = (row) => factCard(d, ctx, t, row);
  return (
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
  );
}

/** 割合の出し方・注意は一番下の折りたたみ1つにまとめる（承認モック sonar-tab v3。中身は1文ずつの箇条書きのまま） */
function MethodNotes({ d, boat }) {
  const { t } = useTranslation();
  const { kind, venue, finalNcr, exhibitionStage } = d;
  return (
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
  );
}

/** 七角形（中に大きい数字・凡例・カードを入れる） */
function FactsRadar({ d, ctx, cardsRef, openCard }) {
  const { t } = useTranslation();
  const { boat, target, stage } = ctx;
  const { usual, scope, kind, rows } = d;
  return (
    <FactRadar
      // 主役・着順・時点・範囲が変わったら、重ねる艇・太くする艇・開いた表を選び直す。key で作り直すと
      // 右の列に入れた差のカード（children）まで作り直され、開いた「ボート」の折りたたみが閉じるので resetKey で（BOA-813）
      resetKey={`${boat}:${target}:${stage}:${ctx.pickedKind ?? ""}`}
      boats={d.radar}
      items={d.radarItems}
      main={boat}
      target={target}
      cardKeys={new Set(rows.map((r) => r.key))}
      collect={
        ["VA", "VG", "NA"].includes(kind)
          ? t(`${k}.radar.collectAll`, { scope })
          : t(`${k}.radar.collect`, { scope })
      }
      onCard={openCard}
    >
      {usual && <UsualBig d={d} boat={boat} />}
      <h4 className="af-h4">{t(`${k}.orderHeading`)}</h4>
      <CardLegend d={d} boat={boat} />
      {d.firstDay && (
        <p className="af-foot" data-testid="analogy-first-day">
          {t(`${k}.firstDayNote`)}
        </p>
      )}
      <FactCards d={d} ctx={ctx} cardsRef={cardsRef} />
    </FactRadar>
  );
}

/**
 * 差がつく材料（タブ1、spec FR-A・FR-E、screens S-1a）
 * @param {{data: object, stage: "racecard"|"exhibition", target: 1|2|3}} props data は facts の応答
 */
export default function ConditionFactsTab({ data, stage, target, feedback }) {
  const { t } = useTranslation();
  const { boat, setBoat, cardsRef, pickedKind, setPickedKind } =
    useFactsControls();
  const d = deriveFacts({ data, stage, target, boat, pickedKind, t });
  const { keys, kinds, scopeKey, def, showFellBack, venue } = d;
  const openCard = (key) => {
    const el = cardsRef.current?.querySelector(`[data-key="${key}"]`);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const ctx = { boat, target, stage, pickedKind };

  return (
    <div className="af-tab-facts">
      <h3 className="af-h3">
        {t(`${k}.heading`, {
          boat,
          finish: t(`aiPredictionTab.analogy.finishWord.${target}`),
        })}
      </h3>
      <BoatControl boat={boat} setBoat={setBoat} />
      <ScopeControl
        keys={keys}
        kinds={kinds}
        scopeKey={scopeKey}
        setPickedKind={setPickedKind}
      />
      <ScopeCombo scopeKey={scopeKey} />
      {showFellBack && (
        <p className="af-sub">
          {t(`${k}.fellBack`, {
            venue: venueLabel(venue, t),
            n: fmtCount(def.vcCount),
          })}
        </p>
      )}
      <FactsRadar d={d} ctx={ctx} cardsRef={cardsRef} openCard={openCard} />
      {d.cls && (
        <p className="af-foot">{t(`${k}.classLine`, { cls: d.cls })}</p>
      )}
      <WindWaveFacts
        exhibition={data.exhibition}
        vaFacts={keys.VA ? data.facts[keys.VA] : null}
        venue={venue}
        target={target}
        exhibitionStage={d.exhibitionStage}
      />
      {feedback}
      <MethodNotes d={d} boat={boat} />
      <AiOutlook boat={boat} target={target} stage={stage} />
    </div>
  );
}
