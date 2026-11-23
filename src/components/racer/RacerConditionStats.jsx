import { useMemo } from "react";
import { aggregateRacerConditionStats } from "../../utils/racerConditionStats";
import { formatPercent } from "../../utils/formatters";
import {
  COND_RATE_MIN_RUNS,
  isConditionDiffSignificant,
} from "../../pure/racerConditionDiff.js";
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

// showDiff は呼び出し側が「条件の走対それ以外の走で |z|≥1.96」を通したときだけ true にする
function RateCell({ rate, base, showDiff }) {
  return (
    <td>
      {rate !== null ? formatPercent(rate) : "-"}
      {showDiff && <DiffLabel rate={rate} base={base} />}
    </td>
  );
}

// 30走未満は率を出さず、件数だけ（3列にまたがる）
function FewRunsCell({ row }) {
  return (
    <td colSpan={3} className="racer-cond-few">
      {row.n}走中1着{row.win}回
    </td>
  );
}

function ConditionRateCells({ row, overall }) {
  if (row.n < COND_RATE_MIN_RUNS) return <FewRunsCell row={row} />;
  const significant = (key) =>
    isConditionDiffSignificant(
      { n: row.n, hits: row[key] },
      { n: overall.n, hits: overall[key] },
    );
  return (
    <>
      <RateCell
        rate={row.winRate}
        base={overall.winRate}
        showDiff={significant("win")}
      />
      <RateCell
        rate={row.top2Rate}
        base={overall.top2Rate}
        showDiff={significant("top2")}
      />
      <RateCell
        rate={row.top3Rate}
        base={overall.top3Rate}
        showDiff={significant("top3")}
      />
    </>
  );
}

/**
 * 選手ページの「レース条件別の成績」（BOA-336）。天候・風速・波高ごとの成績を行に並べ、
 * 本人の全体との差を緑／赤＋↑↓で出す（30走以上で、その条件対それ以外の差が |z|≥1.96 の率だけ）。会場・枠番などのフィルタには連動しない。
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
        <ConditionRateCells row={row} overall={overall} />
      </tr>,
    );
  }

  return (
    <div className="racer-technique-profile racer-cond-stats">
      <h3>レース条件別の成績</h3>
      <p className="racer-vc-note">
        2025年12月以降・{overall.n}
        走。天候・風速・波高はレース直前の発表値。矢印は全体との差（pt）です。判定は「その条件の走」と「それ以外の走」の比べで、差が大きい目安（|z|≥1.96、多重比較の補正なし）を超えた率だけに付けます。30走未満は率を出さず件数だけ、5走未満の条件は出していません。波高は江戸川を除きます（5cm刻みで記録されるため）
      </p>
      <div className="table-wrapper">
        <table className="racer-return-rate-table racer-cond-table">
          <thead>
            <tr>
              <th>条件</th>
              <th>出走数</th>
              <th>1着率</th>
              <th>2連率</th>
              <th>3連率</th>
            </tr>
          </thead>
          <tbody>
            <tr className="racer-cond-overall">
              <td>全体</td>
              <td>{overall.n}</td>
              {overall.n < COND_RATE_MIN_RUNS ? (
                <FewRunsCell row={overall} />
              ) : (
                <>
                  <RateCell rate={overall.winRate} />
                  <RateCell rate={overall.top2Rate} />
                  <RateCell rate={overall.top3Rate} />
                </>
              )}
            </tr>
            {body}
          </tbody>
        </table>
      </div>
    </div>
  );
}
