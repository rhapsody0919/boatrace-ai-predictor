import { useTranslation } from "react-i18next";
import {
  FINISH_ABSENT,
  SCORE_POINTS,
  pointsNeededForBorder,
} from "../../pure/seriesPoints.js";
import RacerLink from "../race/assist/RacerLink";

// 着順の数字だけを並べると、選手の番号やモーター番号に見える（ファン評価1周目）。
// 今節タブと同じ「着順」の見出しを付ける。予選後は予選の走だけなので「予選の着順」
function RankingFinishes({ finishes, confirmed }) {
  const { t } = useTranslation();
  return (
    <span className="meet-ranking__finishes">
      <span className="meet-ranking__finishes-label">
        {t(confirmed ? "meetTab.finishLabelPrelim" : "meetTab.finishLabel")}
      </span>
      {/* 着順の並びは1つのかたまりで折り返す（英語の長い見出しで最後の1〜2走だけが
          次の行に落ち、走数を数え違えた。ファン評価3周目） */}
      <span className="meet-ranking__finishes-list">
        {(finishes ?? []).map((f, i) => (
          <span key={i} className={f === 1 ? "is-win" : undefined}>
            {f === FINISH_ABSENT
              ? t("meetTab.finishAbsent")
              : (f ?? t("meetTab.finishDq"))}
          </span>
        ))}
      </span>
    </span>
  );
}

// 必要得点を着順の目安で言い換える（残り1走のときだけ。2走以上は組み合わせが多く、
// 1つの着順に言い換えられない）
function neededText(t, r, border, remainingRuns, remainingMax) {
  const remaining = remainingRuns?.[r.racerId] ?? 0;
  if (remaining <= 0) return null;
  const need = pointsNeededForBorder(
    r,
    border,
    remaining,
    remainingMax?.[r.racerId] ?? null,
  );
  if (!need) return t("meetPage.remainingOnly", { runs: remaining });
  if (need.needed === 0)
    return t("meetPage.remainingSafe", { runs: remaining });
  if (!need.reachable)
    return t("meetPage.remainingUnreachable", {
      runs: remaining,
      points: need.needed,
      max: need.max,
    });
  const place =
    remaining === 1
      ? [6, 5, 4, 3, 2, 1].find((p) => SCORE_POINTS[p] >= need.needed)
      : null;
  return place
    ? t("meetPage.remainingNeededPlace", {
        runs: remaining,
        points: need.needed,
        place,
      })
    : t("meetPage.remainingNeeded", { runs: remaining, points: need.needed });
}

function pointsText(t, r, penaltyByRacer) {
  return penaltyByRacer?.[r.racerId] > 0
    ? t("meetPage.pointsWithPenalty", {
        points: r.points + penaltyByRacer[r.racerId],
        penalty: penaltyByRacer[r.racerId],
      })
    : t("meetPage.points", { points: r.points });
}

function RankingRow({
  r,
  inside,
  bestRate,
  confirmed,
  needed,
  classByRacer,
  penaltyByRacer,
}) {
  const { t } = useTranslation();
  return (
    <tr
      className={inside ? "meet-ranking__row is-inside" : "meet-ranking__row"}
    >
      <td className="meet-ranking__c-rank">{r.rank}</td>
      <td className="meet-ranking__c-racer">
        <RacerLink racerId={r.racerId} className="meet-ranking__name">
          {r.playerName}
        </RacerLink>
        <span className="meet-ranking__line2">
          <RankingFinishes finishes={r.finishes} confirmed={confirmed} />
          {/* 得点の合計と減点。特別配点（ドリーム戦等）や減点があると、着順から
              暗算した得点率と合わない（ファン評価2周目） */}
          <span className="meet-ranking__points">
            {pointsText(t, r, penaltyByRacer)}
          </span>
          {needed && <span className="meet-ranking__needed">{needed}</span>}
        </span>
      </td>
      <td className="meet-ranking__c-class">
        {classByRacer?.[r.racerId] ?? ""}
      </td>
      <td className="meet-ranking__c-rate">
        <span
          className={r.rate === bestRate ? "meet-ranking__best" : undefined}
        >
          {r.rate.toFixed(2)}
        </span>
      </td>
    </tr>
  );
}

function BorderLineRow({ lineKey, slots, tie }) {
  const { t } = useTranslation();
  return (
    <tr className="meet-ranking__line" aria-hidden="true">
      <td colSpan={4}>
        <span>{t(lineKey, { slots, ...tie })}</span>
      </td>
    </tr>
  );
}

function ExcludedRow({ r, confirmed, classByRacer }) {
  const { t } = useTranslation();
  return (
    <tr className="meet-ranking__row is-excluded">
      <td className="meet-ranking__c-rank">－</td>
      <td className="meet-ranking__c-racer">
        <RacerLink racerId={r.racerId} className="meet-ranking__name">
          {r.playerName}
        </RacerLink>
        {/* 理由は名前の下の段に出す。得点率の列は狭く、「賞典除外」や英語の
            "Prize excluded" が切れていた（ファン評価1周目） */}
        <span className="meet-ranking__line2">
          <span className="meet-ranking__reason">
            {t(`meetPage.reason.${r.reason}`)}
          </span>
          <RankingFinishes finishes={r.finishes} confirmed={confirmed} />
        </span>
      </td>
      <td className="meet-ranking__c-class">
        {classByRacer?.[r.racerId] ?? ""}
      </td>
      <td className="meet-ranking__c-rate">－</td>
    </tr>
  );
}

// 枠の位置が同率で割れているとき（18位が5人等）、線の上の人数は枠より多い。
// 「18人」とだけ書くと数が合わないので、同率の人数と入れる人数を書く（2周目）
function lineKeyOf(tie, confirmed) {
  return tie
    ? "meetPage.borderLineTie"
    : confirmed
      ? "meetPage.borderLineFinal"
      : "meetPage.borderLinePrelim";
}

function RankingBody({
  visible,
  excluded,
  hideExcluded,
  slots,
  border,
  confirmed,
  showRemaining,
  remainingRuns,
  remainingMax,
  classByRacer,
  penaltyByRacer,
  bestRate,
  tie,
}) {
  const { t } = useTranslation();
  return (
    <tbody>
      {visible.map((r, i) => {
        const next = visible[i + 1];
        const inside = r.rank <= slots;
        const lineAfter =
          border != null && inside && (!next || next.rank > slots);
        const needed = showRemaining
          ? neededText(t, r, border, remainingRuns, remainingMax)
          : null;
        return [
          <RankingRow
            key={r.racerId}
            r={r}
            inside={inside}
            bestRate={bestRate}
            confirmed={confirmed}
            needed={needed}
            classByRacer={classByRacer}
            penaltyByRacer={penaltyByRacer}
          />,
          lineAfter && (
            <BorderLineRow
              key={`line-${r.racerId}`}
              lineKey={lineKeyOf(tie, confirmed)}
              slots={slots}
              tie={tie}
            />
          ),
        ];
      })}
      {!hideExcluded &&
        excluded.map((r) => (
          <ExcludedRow
            key={`ex-${r.racerId}`}
            r={r}
            confirmed={confirmed}
            classByRacer={classByRacer}
          />
        ))}
    </tbody>
  );
}

export { RankingBody };
