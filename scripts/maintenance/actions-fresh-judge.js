/**
 * Actions の「最後の起動が古い」の判定（純関数）。hq の dashboard-collect.py の stale_workflows・
 * dashboard_alerts_ops.py の actions_stale の移し（2026-11-26 窓口の依頼。ID04: 見張り・突き合わせ自身が止まったことは内側から知れない）。
 * workflow ごと・起動の種類ごとに、最後の起動が線の時間より古ければ high。線は LINES（目安・根拠なし）。
 * 起動の種類: any（どの起動も）・schedule・workflow_dispatch 等の event 名・
 * success（event を問わず結論が success の run だけ。起動を絞った後の skip の run で緑のままにならないため、BOA-45）。
 *
 * 検証: scripts/maintenance/verify-actions-fresh-judge.js（時計を固定）
 */
export const REPO = "rhapsody0919/boatrace-ai-predictor";
export const LINES = [
  // DB Apply は Vercel Cron の db-apply-dispatch が毎時17分（3回抜けで3時間）。schedule の予備も含めて8時間
  {
    workflow: "DB Apply (production)",
    file: "db-apply.yml",
    event: "workflow_dispatch",
    hours: 3,
  },
  {
    workflow: "DB Apply (production)",
    file: "db-apply.yml",
    event: "any",
    hours: 8,
  },
  // Job Watch は skip の run の結論が skipped なので success で見る。予備の schedule は実測（11/16〜18）で5.5〜10時間おき
  { workflow: "Job Watch", file: "job-watch.yml", event: "success", hours: 3 },
  {
    workflow: "Job Watch",
    file: "job-watch.yml",
    event: "schedule",
    hours: 12,
  },
];

/** 線1本の問い合わせ URL（最新の1件だけ） */
export function runsUrl(line) {
  const q = new URLSearchParams({ per_page: "1" });
  if (line.event === "success") q.set("status", "success");
  else if (line.event !== "any") q.set("event", line.event);
  return `https://api.github.com/repos/${REPO}/actions/workflows/${line.file}/runs?${q}`;
}

const HOUR = 3600 * 1000;

/** 線より古い（または1回も無い）ものを警報にする（純関数）。lasts は lines と同じ並び */
export function staleAlerts(lines, lasts, now) {
  return lines.flatMap((line, i) => {
    const last = lasts[i];
    if (last && now.getTime() - Date.parse(last) <= line.hours * HOUR)
      return [];
    const kind = line.event === "any" ? "どの起動も" : `${line.event} の起動が`;
    return [
      {
        key: `actions_stale:${line.workflow.replace(/[^A-Za-z0-9]/g, "")}:${line.event}`,
        level: "high",
        text: `龍神の ${line.workflow} の${kind} ${line.hours}時間以上無い（最後 ${last ?? "見つからず"}）。見張り・突き合わせ自身が止まった恐れ。`,
      },
    ];
  });
}
