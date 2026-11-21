import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RankingBody } from "./MeetRankingBody";
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

function borderTextOf(t, border, confirmed, slots) {
  return border == null
    ? null
    : t(confirmed ? "meetPage.borderFinal" : "meetPage.borderPrelim", {
        slots,
        rate: border.toFixed(2),
      });
}

function subKeyOf(confirmed, officialAsOfDay, officialAsOfIsToday) {
  return confirmed
    ? "meetPage.rankingSubOfficial"
    : officialAsOfDay != null
      ? officialAsOfIsToday
        ? "meetPage.rankingSubOfficialAsOfToday"
        : "meetPage.rankingSubOfficialAsOf"
      : "meetPage.rankingSubPrelim";
}

function RankingHead({ borderText }) {
  const { t } = useTranslation();
  return (
    <div className="meet-ranking__head">
      <h2 id="meet-ranking-title">{t("meetPage.rankingTitle")}</h2>
      {borderText && <span className="meet-ranking__border">{borderText}</span>}
    </div>
  );
}

function RankingSubs({
  confirmed,
  officialAsOfDay,
  officialAsOfIsToday,
  officialLink,
  count,
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="meet-ranking__sub">
        {t(subKeyOf(confirmed, officialAsOfDay, officialAsOfIsToday), {
          count,
          day: officialAsOfDay,
        })}
      </p>
      {/* 取り込みは 22:00 JST。それまで公式は当日の結果をリアルタイムで出しているので、
          そちらへの道を置く（ファン評価2周目） */}
      {officialAsOfDay != null && !officialAsOfIsToday && officialLink && (
        <p className="meet-ranking__sub">
          <a href={officialLink} target="_blank" rel="noopener noreferrer">
            {t("meetPage.officialLiveLink")}
          </a>
        </p>
      )}
      <p className="meet-ranking__sub">{t("meetPage.legendBest")}</p>
    </>
  );
}

function MarksLegend({ rows, excluded }) {
  const { t } = useTranslation();
  // 着順の欄の記号（転・落・欠・F 等）は公式の表記のまま出す。英語版などで
  // 意味が分からないので凡例を付ける（ファン評価1・2周目で再発。原因は記号が
  // 今節タブと共通の表示で、節ページ側で説明していなかったこと）
  const hasMarks = [...rows, ...excluded].some((r) =>
    (r.finishes ?? []).some((f) => typeof f === "string"),
  );
  if (!hasMarks) return null;
  return (
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
  );
}

function ShobugakeFilter({ onlyShobugake, setOnlyShobugake }) {
  const { t } = useTranslation();
  return (
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
  );
}

function RankingTableHead() {
  const { t } = useTranslation();
  return (
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
  );
}

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
 * @param {boolean} [props.officialAsOfIsToday] 公式の表が今日の終了時点（夜の取得後）か
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
  officialAsOfIsToday = false,
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
  const borderText = borderTextOf(t, border, confirmed, slots);

  return (
    <section className="meet-ranking" aria-labelledby="meet-ranking-title">
      <RankingHead borderText={borderText} />
      <RankingSubs
        confirmed={confirmed}
        officialAsOfDay={officialAsOfDay}
        officialAsOfIsToday={officialAsOfIsToday}
        officialLink={officialLink}
        count={rows.length + excluded.length}
      />
      <MarksLegend rows={rows} excluded={excluded} />
      {showRemaining && (
        <ShobugakeFilter
          onlyShobugake={onlyShobugake}
          setOnlyShobugake={setOnlyShobugake}
        />
      )}
      <table className="meet-ranking__table">
        <RankingTableHead />
        <RankingBody
          visible={visible}
          excluded={excluded}
          hideExcluded={showRemaining && onlyShobugake}
          slots={slots}
          border={border}
          confirmed={confirmed}
          showRemaining={showRemaining}
          remainingRuns={remainingRuns}
          remainingMax={remainingMax}
          classByRacer={classByRacer}
          penaltyByRacer={penaltyByRacer}
          bestRate={bestRate}
          tie={tie}
        />
      </table>
    </section>
  );
}

export default MeetRankingTable;
