import "./RacerSummaryBlock.css";

/**
 * 選手ページの名前の直下の要約（BOA-1688 R1）。級・最新の期の勝率・2連率（期の名前と走数つき）・F 数・
 * 優出と優勝の和・前付けの割合を1ブロックで出す。値は公式の期別成績（buildRacerSummary）から。
 * 期の名前はデータから組む。枠番別の回収率は出さない。
 * summary が undefined の間は取得中（高さを確保し、届いた後に下の要素をずらさない）
 */
function Stat({ label, period, value, testId }) {
  return (
    <div className="racer-summary__stat">
      <dt>
        {label}
        {period && <span className="racer-summary__period">{period}</span>}
      </dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

function FrontLine({ front }) {
  // 前付けの走が0の選手では出さない（DOM に置かない）
  if (!front || !(front.taken > 0) || front.rate == null) return null;
  return (
    <p className="racer-summary__line" data-testid="racer-summary-front">
      前付け {front.rate.toFixed(0)}%（{front.runs}走中{front.taken}走）
    </p>
  );
}

export default function RacerSummaryBlock({ grade, summary, front }) {
  if (summary === undefined) {
    return <div className="racer-summary racer-summary--loading" aria-hidden="true" />;
  }
  return (
    <section className="racer-summary" data-testid="racer-summary" aria-label="成績の要約">
      <dl className="racer-summary__stats">
        {grade && <Stat label="級" value={grade} testId="racer-summary-grade" />}
        {summary?.winRate != null && (
          <Stat
            label="勝率"
            period={summary.label}
            value={summary.winRate.toFixed(2)}
            testId="racer-summary-win-rate"
          />
        )}
        {summary?.top2Rate != null && (
          <Stat
            label="2連率"
            period={summary.label}
            value={`${summary.top2Rate.toFixed(1)}%`}
            testId="racer-summary-top2-rate"
          />
        )}
        {summary?.fCount != null && (
          <Stat label="F" period={summary.label} value={summary.fCount} testId="racer-summary-f" />
        )}
      </dl>
      {summary && (
        <>
          <p className="racer-summary__note">
            {summary.label}の公式の期別成績（{summary.starts}走）
          </p>
          <p className="racer-summary__line" data-testid="racer-summary-finals">
            優出 {summary.finals}・優勝 {summary.wins}（{summary.sinceLabel}からの和）
          </p>
        </>
      )}
      <FrontLine front={front} />
    </section>
  );
}
