import { useTranslation } from "react-i18next";
import { groupRunsByMeet } from "./basicInfoStats";
import { RunGroupHeadRow, RunRow } from "./RecentRunsTableRows";
import "./RecentRunsTable.css";

/**
 * 選手の走を、節ごとの見出し行つきの6列で並べる表（BOA-623）。
 * 基本情報タブの「直近10走」と、選手ページの「レース一覧」が使う。
 *
 * 列は「日付・R・枠番・進入・ST・着順」（＋PC だけ単勝配当）。並びは
 * 「どの枠から、何コースに入り、STが何番目で、何着か」の読む順にした。
 * 以前の11列（RaceHistoryTable）は 375px で幅 約770px あり、最初の画面に
 * 入るのは「日付・会場・R・着順」だけで、枠番・ST は横に送らないと見えなかった。
 *
 * - 会場・グレード・レース名は、節ごとの見出し行に1回だけ出す
 *   （同じ節は10行とも同じ値で、レース名だけで 252px を取っていた）
 * - 日付は月日（09-14）。年は見出し行の期間に出す（選手ページは2年分並ぶ）
 * - レース種別（予選・準優など）は R の下に小さく、決まり手は1着のときだけ
 *   着順の下に小さく出す
 * - ST にはそのレースの6艇の中での順位（F を除く）を「(4)」で添え、表の下に凡例を出す
 * - 単勝配当は PC だけ（選手の力を表す数字ではないため、375px では省く）
 *
 * 行のクリックは onClick で遷移する（iOS の WebKit は `<tr>` の
 * position: relative を効かせず、行全体リンクの ::after が横スワイプを止めた。
 * BOA-609）。日付の `<Link>` は残すので、中クリック・新しいタブはそのまま。
 *
 * 今節タブの日別の表は展示の列を持つなど用途が違うので、引き続き
 * RaceHistoryTable を使う。
 *
 * @param {Array} rows getRecentRaces / aggregateRacerVenueBoatStats の matchedRaces の行。
 *   新しい順で渡す（いちばん上が前走）。直近10走と選手ページで向きをそろえる
 * @param {(raceId: string) => string} [buildRaceHref]
 */
function RecentRunsTable({
  rows,
  buildRaceHref = (raceId) => `/race/${raceId}`,
}) {
  const { t } = useTranslation();
  const groups = groupRunsByMeet(rows);

  return (
    <div className="rrt-wrap">
      <table className="rrt-table">
        <thead>
          <tr>
            <th className="rrt-left">{t("raceHistoryTable.date")}</th>
            <th className="rrt-left">{t("raceHistoryTable.raceNo")}</th>
            <th>{t("raceHistoryTable.boatNumber")}</th>
            <th>{t("raceHistoryTable.entryCourse")}</th>
            <th>{t("raceHistoryTable.startTiming")}</th>
            <th>{t("raceHistoryTable.finish")}</th>
            <th className="rrt-pc">{t("raceHistoryTable.payout")}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={`${g.firstDate}-${g.venueCode}-${g.raceTitle}`}>
            <RunGroupHeadRow g={g} />
            {g.rows.map((race) => (
              <RunRow
                key={race.raceId}
                race={race}
                buildRaceHref={buildRaceHref}
              />
            ))}
          </tbody>
        ))}
      </table>
      <p className="rrt-legend">{t("raceHistoryTable.stRankLegend")}</p>
    </div>
  );
}

export default RecentRunsTable;
