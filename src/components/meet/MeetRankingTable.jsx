import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FINISH_ABSENT,
  SCORE_POINTS,
  pointsNeededForBorder,
} from "../race/seriesPoints";
import { borderTieOf } from "../../utils/meetPageModel";
import "./MeetRankingTable.css";

// 着順の欄に出る公式の記号（今節タブと同じく公式の表記のまま出す）。記号は訳さず、
// 意味だけを各言語で出す（en・ko の文言に漢字を入れない決まり、BOA-633）
const FINISH_MARKS = [
  ["転", "capsized"],
  ["落", "fell"],
  ["沈", "sank"],
  ["欠", "absent"],
  ["F", "flying"],
  ["L", "late"],
  ["失", "disqualified"],
  ["妨", "obstruction"],
  ["エ", "stall"],
  ["不", "dnf"],
];

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
 * @param {number|null} [props.officialAsOfDay] 予選中に公式の前夜時点の表を出しているとき、その日目
 * @param {string|null} [props.officialLink] 公式の得点率一覧（当日のリアルタイム）の URL
 * @param {Object<number, number>} [props.penaltyByRacer] 公式の減点（賞典除外の印の99は除く）
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
  officialAsOfDay = null,
  officialLink = null,
  penaltyByRacer = {},
}) {
  const { t } = useTranslation();
  const [onlyShobugake, setOnlyShobugake] = useState(false);
  const bestRate = rows.length > 0 ? rows[0].rate : null;
  const tie = borderTieOf(rows, slots);
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

  // 着順の数字だけを並べると、選手の番号やモーター番号に見える（ファン評価1周目）。
  // 今節タブと同じ「着順」の見出しを付ける。予選後は予選の走だけなので「予選の着順」
  const renderFinishes = (finishes) => (
    <span className="meet-ranking__finishes">
      <span className="meet-ranking__finishes-label">
        {t(confirmed ? "meetTab.finishLabelPrelim" : "meetTab.finishLabel")}
      </span>
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
            : officialAsOfDay != null
              ? "meetPage.rankingSubOfficialAsOf"
              : "meetPage.rankingSubPrelim",
          {
            count: rows.length + excluded.length,
            day: officialAsOfDay,
          },
        )}
      </p>
      {/* 取り込みは 22:00 JST。それまで公式は当日の結果をリアルタイムで出しているので、
          そちらへの道を置く（ファン評価2周目） */}
      {officialAsOfDay != null && officialLink && (
        <p className="meet-ranking__sub">
          <a href={officialLink} target="_blank" rel="noopener noreferrer">
            {t("meetPage.officialLiveLink")}
          </a>
        </p>
      )}
      <p className="meet-ranking__sub">{t("meetPage.legendBest")}</p>
      {/* 着順の欄の記号（転・落・欠・F 等）は公式の表記のまま出す。英語版などで
          意味が分からないので凡例を付ける（ファン評価1・2周目で再発。原因は記号が
          今節タブと共通の表示で、節ページ側で説明していなかったこと） */}
      {[...rows, ...excluded].some((r) =>
        (r.finishes ?? []).some((f) => typeof f === "string"),
      ) && (
        <p className="meet-ranking__sub">
          {t("meetPage.marksLegendTitle")}{" "}
          {FINISH_MARKS.map(([mark, key], i) => (
            <span key={key}>
              {i > 0 && t("meetTab.listSeparator")}
              <span translate="no">{mark}</span>
              {t("meetPage.marksEquals")}
              {t(`meetPage.markName.${key}`)}
            </span>
          ))}
        </p>
      )}
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
            // 枠の位置が同率で割れているとき（18位が5人等）、線の上の人数は枠より多い。
            // 「18人」とだけ書くと数が合わないので、同率の人数と入れる人数を書く（2周目）
            const lineKey = tie
              ? "meetPage.borderLineTie"
                : confirmed
                  ? "meetPage.borderLineFinal"
                  : "meetPage.borderLinePrelim";
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
                    {/* 得点の合計と減点。特別配点（ドリーム戦等）や減点があると、着順から
                        暗算した得点率と合わない（ファン評価2周目） */}
                    <span className="meet-ranking__points">
                      {penaltyByRacer?.[r.racerId] > 0
                        ? t("meetPage.pointsWithPenalty", {
                            points: r.points + penaltyByRacer[r.racerId],
                            penalty: penaltyByRacer[r.racerId],
                          })
                        : t("meetPage.points", { points: r.points })}
                    </span>
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
                      {t(lineKey, { slots, ...tie })}
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
                  {/* 理由は名前の下の段に出す。得点率の列は狭く、「賞典除外」や英語の
                      "Prize excluded" が切れていた（ファン評価1周目） */}
                  <span className="meet-ranking__line2">
                    <span className="meet-ranking__reason">
                      {t(`meetPage.reason.${r.reason}`)}
                    </span>
                    {renderFinishes(r.finishes)}
                  </span>
                </td>
                <td className="meet-ranking__c-class">
                  {classByRacer?.[r.racerId] ?? ""}
                </td>
                <td className="meet-ranking__c-rate">－</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

export default MeetRankingTable;
