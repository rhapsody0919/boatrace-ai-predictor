import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FINISH_ABSENT,
  SCORE_POINTS,
  pointsNeededForBorder,
} from "../race/seriesPoints";
import "./MeetRankingTable.css";

/**
 * 節の全選手の得点率ランキング（BOA-682、screens.md §1）。
 *
 * 行は `buildMeetRanking` の値（今節タブと同じ計算）。順位の対象外の選手は同じ表の
 * 末尾に「－」と理由を出す（spec FR-1.2）。準優の枠の位置に線を引く（FR-1.3）。
 * 予選最終日だけ、今日の残り走数・必要得点と「勝負駆けだけ」を出す（FR-1.4）。
 *
 * 1行2段（上段: 順位・氏名・級別・得点率／下段: 着順の並び・残り走数）。375px で
 * 横スクロールを出さないため、列を増やさず段で持つ。
 *
 * @param {Object} props
 * @param {Array} props.rows 順位の付いた選手（`buildMeetRanking` のうち withdrawn でないもの）
 * @param {Array<{racerId: number, playerName: string, finishes: Array, reason: string}>} props.excluded 順位の対象外
 * @param {number} props.slots 準優の枠数
 * @param {number|null} props.border ボーダーの得点率
 * @param {boolean} props.confirmed 予選終了後（公式の値で確定）か
 * @param {boolean} props.showRemaining 予選最終日（残り走数・必要得点・勝負駆けを出す）か
 * @param {Object<number, number>} props.remainingRuns 今日の残り予選走数
 * @param {Object<number, number>} props.remainingMax 今日の残りの最大点
 * @param {Set<number>} props.shobugake 勝負駆けの選手
 * @param {Object<number, string>} props.classByRacer 級別
 */
function MeetRankingTable({
  rows,
  excluded,
  slots,
  border,
  confirmed,
  showRemaining,
  remainingRuns,
  remainingMax,
  shobugake,
  classByRacer,
}) {
  const { t } = useTranslation();
  const [onlyShobugake, setOnlyShobugake] = useState(false);
  const bestRate = rows.length > 0 ? rows[0].rate : null;
  const visible =
    showRemaining && onlyShobugake
      ? rows.filter((r) => shobugake.has(r.racerId))
      : rows;
  const borderText =
    border == null
      ? null
      : t(confirmed ? "meetPage.borderFinal" : "meetPage.borderPrelim", {
          slots,
          rate: border.toFixed(2),
        });

  const renderFinishes = (finishes) => (
    <span className="meet-ranking__finishes">
      {(finishes ?? []).map((f, i) => (
        <span key={i} className={f === 1 ? "is-win" : undefined}>
          {f === FINISH_ABSENT
            ? t("meetTab.finishAbsent")
            : (f ?? t("meetTab.finishDq"))}
        </span>
      ))}
    </span>
  );

  // 必要得点を着順の目安で言い換える（残り1走のときだけ。2走以上は組み合わせが多く、
  // 1つの着順に言い換えられない）
  const renderNeeded = (r) => {
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
  };

  return (
    <section className="meet-ranking" aria-labelledby="meet-ranking-title">
      <div className="meet-ranking__head">
        <h2 id="meet-ranking-title">{t("meetPage.rankingTitle")}</h2>
        {borderText && (
          <span className="meet-ranking__border">{borderText}</span>
        )}
      </div>
      <p className="meet-ranking__sub">
        {t(
          confirmed
            ? "meetPage.rankingSubOfficial"
            : "meetPage.rankingSubPrelim",
          {
            count: rows.length + excluded.length,
          },
        )}
      </p>
      {showRemaining && (
        <>
          <div
            className="meet-ranking__filter"
            role="group"
            aria-label={t("meetPage.filterLabel")}
          >
            <button
              type="button"
              aria-pressed={!onlyShobugake}
              onClick={() => setOnlyShobugake(false)}
            >
              {t("meetPage.filterAll")}
            </button>
            <button
              type="button"
              aria-pressed={onlyShobugake}
              onClick={() => setOnlyShobugake(true)}
            >
              {t("meetPage.filterShobugake")}
            </button>
          </div>
          <p className="meet-ranking__sub">{t("meetPage.shobugakeNote")}</p>
        </>
      )}
      <table className="meet-ranking__table">
        <thead>
          <tr>
            <th scope="col" className="meet-ranking__c-rank">
              {t("meetPage.colRank")}
            </th>
            <th scope="col">{t("meetPage.colRacer")}</th>
            <th scope="col" className="meet-ranking__c-class">
              {t("meetPage.colClass")}
            </th>
            <th scope="col" className="meet-ranking__c-rate">
              {t("meetPage.colRate")}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => {
            const next = visible[i + 1];
            const inside = r.rank <= slots;
            const lineAfter =
              border != null && inside && (!next || next.rank > slots);
            const needed = showRemaining ? renderNeeded(r) : null;
            return [
              <tr
                key={r.racerId}
                className={
                  inside ? "meet-ranking__row is-inside" : "meet-ranking__row"
                }
              >
                <td className="meet-ranking__c-rank">{r.rank}</td>
                <td className="meet-ranking__c-racer">
                  <span className="meet-ranking__name" translate="no">
                    {r.playerName}
                  </span>
                  <span className="meet-ranking__line2">
                    {renderFinishes(r.finishes)}
                    {needed && (
                      <span className="meet-ranking__needed">{needed}</span>
                    )}
                  </span>
                </td>
                <td className="meet-ranking__c-class">
                  {classByRacer?.[r.racerId] ?? ""}
                </td>
                <td className="meet-ranking__c-rate">
                  <span
                    className={
                      r.rate === bestRate ? "meet-ranking__best" : undefined
                    }
                  >
                    {r.rate.toFixed(2)}
                  </span>
                </td>
              </tr>,
              lineAfter && (
                <tr
                  key={`line-${r.racerId}`}
                  className="meet-ranking__line"
                  aria-hidden="true"
                >
                  <td colSpan={4}>
                    <span>
                      {t(
                        confirmed
                          ? "meetPage.borderLineFinal"
                          : "meetPage.borderLinePrelim",
                        {
                          slots,
                        },
                      )}
                    </span>
                  </td>
                </tr>
              ),
            ];
          })}
          {!(showRemaining && onlyShobugake) &&
            excluded.map((r) => (
              <tr
                key={`ex-${r.racerId}`}
                className="meet-ranking__row is-excluded"
              >
                <td className="meet-ranking__c-rank">－</td>
                <td className="meet-ranking__c-racer">
                  <span className="meet-ranking__name" translate="no">
                    {r.playerName}
                  </span>
                  <span className="meet-ranking__line2">
                    {renderFinishes(r.finishes)}
                  </span>
                </td>
                <td className="meet-ranking__c-class">
                  {classByRacer?.[r.racerId] ?? ""}
                </td>
                <td className="meet-ranking__c-rate">
                  <span className="meet-ranking__reason">
                    {t(`meetPage.reason.${r.reason}`)}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

export default MeetRankingTable;
