import { useEffect, useState } from "react";
import "./RacerSummaryBlock.css";
import { getRacerLatestEntry } from "../../services/racerQueries6.js";
import { latestEntryLine } from "../../pure/racerLatestEntry.js";
import { getTodayJST } from "../../utils/dateUtils";

/**
 * 選手ページの名前の直下の要約（BOA-1688 R1）。級・最新の期の勝率・2連対率（期の名前と走数つき）・F 数・
 * 優出と優勝の和・前付けの割合を1ブロックで出す。値は公式の期別成績（buildRacerSummary）から。
 * 期の名前はデータから組む。枠番別の回収率は出さない。
 * summary が undefined の間は取得中（高さを確保し、届いた後に下の要素をずらさない）
 */
// dim: 上に最新の出走表の1行があるとき、公式の期別（集計が終わった期）の値を小さくする（大きな値を今の値と読まないように。ファン評価 1周 P1）
const DIM_VALUE = { fontSize: "var(--font-size-base)", fontWeight: 600 };
// F は舟券の判断で最初に見る所なので、公式の期別の F は更に淡くし、上の出走表の F を目立たせる（ファン評価 2周 P2）
const DIM_F = { ...DIM_VALUE, fontWeight: 400, color: "var(--text-secondary)" };

function Stat({ label, period, value, testId, dim = false, dimStyle = DIM_VALUE }) {
  return (
    <div className="racer-summary__stat">
      <dt>
        {label}
        {period && <span className="racer-summary__period">{period}</span>}
      </dt>
      <dd data-testid={testId} style={dim ? dimStyle : undefined}>{value}</dd>
    </div>
  );
}

// 最新の出走表の行（#3258 の #2）。失敗はページを失敗にせず、この1行だけ出さない（今日の出走 BOA-1691 と同じ扱い）
function useLatestEntry(racerId) {
  const [load, setLoad] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getRacerLatestEntry(racerId)
      .then((row) => {
        if (!cancelled) setLoad({ racerId, line: latestEntryLine(row, getTodayJST()) });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("最新の出走表の取得エラー:", err?.message);
        setLoad({ racerId, line: null });
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);
  return load?.racerId === racerId ? load.line : null;
}

// 1行目: 最新の出走表の値（直近6か月の窓なので「今期」とは書かず、出走表の日付を付ける）
function LatestEntryLine({ line }) {
  if (!line) return null;
  return (
    // 1PR 5ファイルの線に収めるため CSS ファイルを足さず、2行目との区切りを design-tokens の変数で書く
    <p
      className="racer-summary__line"
      data-testid="racer-summary-latest"
      style={{
        margin: "0 0 var(--spacing-2)",
        paddingBottom: "var(--spacing-2)",
        borderBottom: "1px solid var(--border-hairline)",
        fontSize: "var(--font-size-base)",
      }}
    >
      <span className="racer-summary__period">{line.dateLabel} の出走表</span>{" "}
      勝率 <strong style={{ fontSize: "var(--font-size-3xl)" }}>{line.winRate.toFixed(2)}</strong>
      {line.top2Rate != null && `・2連率 ${line.top2Rate.toFixed(1)}%`}
      {line.fCount != null && (
        <>
          ・<strong>F{line.fCount}</strong>
        </>
      )}
    </p>
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

export default function RacerSummaryBlock({ racerId, grade, summary, front }) {
  const latest = useLatestEntry(racerId);
  if (summary === undefined) {
    return <div className="racer-summary racer-summary--loading" aria-hidden="true" />;
  }
  return (
    <section className="racer-summary" data-testid="racer-summary" aria-label="成績の要約">
      <LatestEntryLine line={latest} />
      <dl className="racer-summary__stats">
        {grade && <Stat label="級" value={grade} testId="racer-summary-grade" />}
        {summary?.winRate != null && (
          <Stat
            label="勝率"
            period={`公式 ${summary.label}`}
            dim={latest != null}
            value={summary.winRate.toFixed(2)}
            testId="racer-summary-win-rate"
          />
        )}
        {summary?.top2Rate != null && (
          <Stat
            label="2連対率"
            period={`公式 ${summary.label}`}
            dim={latest != null}
            value={`${summary.top2Rate.toFixed(1)}%`}
            testId="racer-summary-top2-rate"
          />
        )}
        {summary?.fCount != null && (
          <Stat label="F" period={`公式 ${summary.label}`} value={summary.fCount} testId="racer-summary-f" dim={latest != null} dimStyle={DIM_F} />
        )}
      </dl>
      {summary && (
        <>
          <p className="racer-summary__note">
            公式の期別成績（{summary.label}・{summary.dateModified ? `〜${summary.dateModified.replaceAll("-", "/")} 集計・` : ""}{summary.starts}走）
            {/* 1行目（出走表）が出ないとき「上の」が何も指さないので、そのときは書かない */}
            {latest && "。上の出走表の値とは集計の期間が違います"}
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
