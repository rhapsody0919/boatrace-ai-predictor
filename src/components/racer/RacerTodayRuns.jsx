import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRacerTodayRuns } from "../../services/racerQueries6.js";
import { todayRunsMeetLabel } from "../../pure/racerTodayRuns.js";
import { BOAT_COLORS } from "../../utils/colors";
import { getTodayJST } from "../../utils/dateUtils";

// 1PR 5ファイルの線に収めるため CSS ファイルを足さず、色・大きさは design-tokens の変数で書く
const S = {
  section: { margin: "var(--spacing-3) 0 0", padding: "var(--spacing-2) var(--spacing-3)",
    background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-lg)" },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 var(--spacing-2)" },
  title: { margin: 0, fontSize: "var(--font-size-sm)", fontWeight: 700, color: "var(--text-primary)" },
  meet: { fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" },
  list: { listStyle: "none", margin: "var(--spacing-1) 0 0", padding: 0 },
  link: { display: "flex", alignItems: "center", gap: "var(--spacing-2)", minHeight: "2.25rem",
    color: "var(--text-primary)", textDecoration: "none", fontSize: "var(--font-size-sm)" },
  boat: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.5rem", height: "1.5rem",
    flex: "0 0 auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)", fontWeight: 700 },
  race: { flex: "1 1 auto", minWidth: 0, fontWeight: 700 },
  status: { flex: "0 0 auto", fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" },
};

function useTodayRuns(racerId) {
  const [load, setLoad] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getRacerTodayRuns(racerId, getTodayJST())
      .then((runs) => {
        if (!cancelled) setLoad({ racerId, runs });
      })
      .catch((err) => {
        // 票（BOA-1691）の決め: 失敗はページを失敗にせず、この節だけ出さない
        if (cancelled) return;
        console.error("今日の出走の取得エラー:", err?.message);
        setLoad({ racerId, runs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);
  return load?.racerId === racerId ? load.runs : [];
}

function RunRow({ run }) {
  const color = BOAT_COLORS[run.boatNumber];
  const status = run.finish ?? (run.deadline ? `${run.deadline}締切` : null);
  return (
    <li>
      <Link to={`/race/${run.raceId}`} style={S.link} data-testid="racer-today-run">
        <span
          style={{ ...S.boat, background: color?.bg, color: color?.text }}
          aria-label={`${run.boatNumber}号艇`}
        >
          {run.boatNumber}
        </span>
        <span style={S.race}>
          {run.venueName} {run.raceNo}R
        </span>
        {status && <span style={S.status}>{status}</span>}
      </Link>
    </li>
  );
}

/**
 * 選手ページの名前の直下の「今日の出走」（BOA-1691 R2）。JST の今日の全走を race_id の昇順で出し、各行は出走表へ。
 * 走が0・取得中・失敗のときは DOM に置かない（出た時の CLS は節の高さ分を許す）
 */
export default function RacerTodayRuns({ racerId }) {
  const runs = useTodayRuns(racerId);
  if (runs.length === 0) return null;
  const meet = todayRunsMeetLabel(runs);
  return (
    <section style={S.section} data-testid="racer-today-runs" aria-label="今日の出走">
      <div style={S.head}>
        <h2 style={S.title}>今日の出走（{runs.length}走）</h2>
        {meet && <span style={S.meet}>{meet}</span>}
      </div>
      <ul style={S.list}>
        {runs.map((run) => (
          <RunRow key={run.raceId} run={run} />
        ))}
      </ul>
    </section>
  );
}
