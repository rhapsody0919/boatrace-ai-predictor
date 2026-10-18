// 公開済みの投稿ごとの観測履歴（数字のページ）。以前は待ち行列の各行に連結して出していた（2026-10-18 に移した）
import { useEffect, useState } from "react";
import { getDeadlineQueue } from "../../../services/snsHubService.js";
import { calendarObservations } from "../../../utils/snsMonthCalendar.js";

const RECENT_DAYS = 14;
const format = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "未設定";

export default function PostObservationList() {
  const [state, setState] = useState({
    loading: true,
    error: "",
    rows: [],
    now: 0,
  });
  useEffect(() => {
    let active = true;
    getDeadlineQueue()
      .then(({ rows }) => {
        if (active)
          setState({ loading: false, error: "", rows, now: Date.now() });
      })
      .catch(() => {
        if (active)
          setState({
            loading: false,
            error:
              "投稿の一覧を取得できませんでした。画面を再読み込みしてください。",
            rows: [],
            now: 0,
          });
      });
    return () => {
      active = false;
    };
  }, []);
  const since = state.now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const posted = state.rows
    .filter(
      (row) => row.state === "posted" && Date.parse(row.posted_at) >= since,
    )
    .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  return (
    <section className="sns-post-observations" aria-label="投稿ごとの観測">
      <h2>投稿ごとの観測（直近{RECENT_DAYS}日の公開済み）</h2>
      {state.loading && <p role="status">読み込み中…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && !posted.length && (
        <p>直近{RECENT_DAYS}日に公開した投稿はありません。</p>
      )}
      <ul className="sns-queue-list">
        {posted.map((row) => {
          const observations = calendarObservations(row, state.now);
          return (
            <li key={row.id} className="sns-queue-row">
              <div className="sns-queue-row-main">
                <span className="sns-queue-time">{format(row.posted_at)}</span>
                <span
                  className={`sns-queue-channel sns-queue-channel-${row.channel}`}
                >
                  {row.channel === "youtube" ? "YouTube" : "X"}
                </span>
                <span className="sns-queue-name">
                  {row.title || row.draft_id}
                </span>
                <span className="sns-queue-state sns-queue-state-muted">
                  {observations.length
                    ? `観測 ${observations.length}件`
                    : "未収集"}
                </span>
              </div>
              <details className="sns-queue-detail">
                <summary>観測履歴</summary>
                {observations.length ? (
                  <ul>
                    {observations.map((o) => (
                      <li key={o.id}>
                        {o.window} {o.metric_name}:{" "}
                        {o.metric_value == null
                          ? o.missing_reason || "欠測"
                          : o.metric_value}{" "}
                        / {o.source} / {o.definition} / 取得{" "}
                        {format(o.observed_at)} / 対象期間末{" "}
                        {format(o.period_end)} / データ反映{" "}
                        {format(o.data_through)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>未収集（0ではありません）</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
