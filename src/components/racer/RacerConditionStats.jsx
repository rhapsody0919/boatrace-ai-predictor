import { useMemo } from "react";
import { aggregateRacerConditionStats } from "../../utils/racerConditionStats";
import { formatPercent } from "../../utils/formatters";
import "./RacerConditionStats.css";

// 全体との差（pt、小数第1位）。全角のマイナス記号（−）を使う（レース詳細の前期欄と同じ）
function DiffLabel({ rate, base }) {
  if (rate === null || base === null) return null;
  const diff = Math.round((rate - base) * 1000) / 10;
  const abs = Math.abs(diff).toFixed(1);
  if (diff === 0) return <span className="racer-cond-diff">±{abs}</span>;
  return (
    <span className={`racer-cond-diff ${diff > 0 ? "is-better" : "is-worse"}`}>
      {diff > 0 ? `↑+${abs}` : `↓−${abs}`}
    </span>
  );
}

function RateCell({ rate, base, showDiff }) {
  return (
    <td>
      {rate !== null ? formatPercent(rate) : "-"}
      {showDiff && <DiffLabel rate={rate} base={base} />}
    </td>
  );
}

/**
 * 選手ページの「レース条件別の成績」（BOA-336）。天候・風速・波高ごとの成績を行に並べ、
 * 本人の全体との差を緑／赤＋↑↓で出す。会場・枠番などのフィルタには連動しない。
 *
 * @param {{history: Array|null}} props getRacerRaceHistory() の戻り値。読み込み中・失敗は null
 */
export default function RacerConditionStats({ history }) {
  const stats = useMemo(
    () => (history ? aggregateRacerConditionStats(history) : null),
    [history],
  );
  if (!stats || stats.rows.length === 0) return null;
  const { overall, rows } = stats;

  // 小見出し（天候・風速・波高）の行を、その条件の最初の行の前に挟む
  const body = [];
  let lastGroup = null;
  for (const row of rows) {
    if (row.group !== lastGroup) {
      body.push(
        <tr key={`group-${row.group}`} className="racer-cond-group">
          <td colSpan={5}>{row.group}</td>
        </tr>,
      );
      lastGroup = row.group;
    }
    body.push(
      <tr key={row.key}>
        <td>{row.label}</td>
        <td>{row.n}</td>
        <RateCell rate={row.winRate} base={overall.winRate} showDiff />
        <RateCell rate={row.top2Rate} base={overall.top2Rate} showDiff />
        <RateCell rate={row.top3Rate} base={overall.top3Rate} showDiff />
      </tr>,
    );
  }

  return (
    <div className="racer-technique-profile racer-cond-stats">
      <h3>レース条件別の成績</h3>
      <p className="racer-vc-note">
        2025年12月以降・{overall.n}
        走。天候・風速・波高はレース直前の発表値。矢印は全体との差（pt）。5走未満の条件は出していません。波高は江戸川を除きます（5cm刻みで記録されるため）
      </p>
      <div className="table-wrapper">
        <table className="racer-return-rate-table racer-cond-table">
          <thead>
            <tr>
              <th>条件</th>
              <th>出走数</th>
              <th>勝率</th>
              <th>2連率</th>
              <th>3連率</th>
            </tr>
          </thead>
          <tbody>
            <tr className="racer-cond-overall">
              <td>全体</td>
              <td>{overall.n}</td>
              <RateCell rate={overall.winRate} />
              <RateCell rate={overall.top2Rate} />
              <RateCell rate={overall.top3Rate} />
            </tr>
            {body}
          </tbody>
        </table>
      </div>
    </div>
  );
}
