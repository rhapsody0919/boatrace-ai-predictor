import { useEffect, useRef, useState } from "react";
import MonthCalendar from "./MonthCalendar.jsx";
import {
  calendarMonth,
  calendarRowDay,
} from "../../../utils/snsMonthCalendar.js";
import {
  attentionRows,
  rowsOfDay,
  todayDay,
} from "../../../utils/snsAutoSendStatus.js";
import {
  getDeadlineQueue,
  stopXSend,
} from "../../../services/snsHubService.js";

// 自動送信ページ（/admin/sns-hub/auto）の中身。いまの状態・要対応・今日・全月カレンダー。
// 以前は全期間の全行を期限順に並べ、観測履歴まで1行につないでいたため長かった（2026-10-18 オーナー指摘）。
// 観測履歴は数字のページ（PostObservationList）で見る
const labels = {
  queued: "投稿予定",
  sending: "送信中",
  reconcile: "要照合（再送禁止）",
  held: "保留",
  posted: "公開済み",
  failed: "失敗",
  cancelled: "承認失効",
  pending_review: "承認待ち",
  approved: "承認済み・未登録",
};
const tones = {
  posted: "ok",
  queued: "plan",
  approved: "plan",
  failed: "bad",
  reconcile: "bad",
  held: "hold",
  sending: "hold",
  pending_review: "hold",
  cancelled: "muted",
};
const channelLabels = { x: "X", youtube: "YouTube" };
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

const isExpired = (row, now) =>
  ["queued", "held", "pending_review", "approved"].includes(row.state) &&
  Date.parse(row.expires_at) <= now;

export function DeadlineQueueList({
  rows,
  now,
  title = "投稿待ち行列（JST）",
  emptyText = "対象の投稿はありません。",
}) {
  return (
    <section className="sns-queue" aria-label={title}>
      <h2 className="sns-queue-title">
        {title} <span className="sns-queue-count">{rows.length}件</span>
      </h2>
      {!rows.length && <p className="sns-queue-empty">{emptyText}</p>}
      <ul className="sns-queue-list">
        {rows.map((row) => {
          const expired = isExpired(row, now);
          return (
            <li key={row.id} className="sns-queue-row">
              <div className="sns-queue-row-main">
                <span className="sns-queue-time">
                  {format(
                    row.state === "posted"
                      ? row.posted_at
                      : row.scheduled_at || row.deadline_at || row.expires_at,
                  )}
                </span>
                <span
                  className={`sns-queue-channel sns-queue-channel-${row.channel}`}
                >
                  {channelLabels[row.channel] || row.channel}
                </span>
                <span className="sns-queue-name">
                  {row.title || row.draft_id}
                </span>
                <span
                  className={`sns-queue-state sns-queue-state-${expired ? "bad" : tones[row.state] || "muted"}`}
                >
                  {expired
                    ? "失効（送信不可）"
                    : labels[row.state] || row.state}
                </span>
              </div>
              <details className="sns-queue-detail">
                <summary>詳しく</summary>
                <p>
                  投稿予定: {format(row.scheduled_at)} / 送信期限:{" "}
                  {format(row.expires_at)} / 公式締切: {format(row.deadline_at)}
                </p>
                {row.channel === "youtube" && (
                  <p>
                    {row.youtube_mode === "scheduled" ? "予約公開" : "即時公開"}
                  </p>
                )}
                {row.state === "posted" && (
                  <p>実公開: {format(row.posted_at)}</p>
                )}
                {row.channel === "youtube" && row.external_post_id && (
                  <p>
                    動画ID: {row.external_post_id} /{" "}
                    {row.youtube_stage === "private_retained"
                      ? "非公開のまま残置（削除はオーナー操作）"
                      : "公開状態は照合で確認"}
                  </p>
                )}
                {row.error_code && <p>保留・失敗理由: {row.error_code}</p>}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const modeLabel = (channel) =>
  !channel
    ? "不明"
    : channel.mode === "auto"
      ? channel.dry_run
        ? "自動・試運転（送らない）"
        : "自動・本番"
      : "個別承認";

export function SendControlBand({ control, busy, onStop }) {
  const [confirming, setConfirming] = useState(false);
  const channel = (name) => control?.channels?.find((c) => c.channel === name);
  return (
    <section className="sns-send-control" aria-label="いまの状態">
      <h2 className="sns-queue-title">いまの状態</h2>
      {!control ? (
        <p role="alert">
          送信の状態を取得できません。止めるときは本番 SQL で
          sns_x_send_control.paused=true にしてください。
        </p>
      ) : (
        <>
          <dl className="sns-send-control-grid">
            {["x", "youtube"].map((name) => (
              <div key={name}>
                <dt>{channelLabels[name]}</dt>
                <dd>{modeLabel(channel(name))}</dd>
              </div>
            ))}
            <div>
              <dt>送信の停止</dt>
              <dd
                className={
                  control.paused ? "sns-send-control-paused" : undefined
                }
              >
                {control.paused ? "止まっている" : "動いている"}
              </dd>
            </div>
          </dl>
          <div className="sns-send-control-actions">
            {confirming ? (
              <>
                <button
                  type="button"
                  className="draft-action-btn revise"
                  disabled={busy}
                  onClick={async () => {
                    await onStop();
                    setConfirming(false);
                  }}
                >
                  止める（X・YouTube すべて）
                </button>
                <button
                  type="button"
                  className="draft-action-btn"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  やめる
                </button>
              </>
            ) : (
              <button
                type="button"
                className="draft-action-btn revise"
                disabled={busy || control.paused}
                onClick={() => setConfirming(true)}
              >
                全部止める
              </button>
            )}
            <p className="sns-queue-empty">
              モードの切り替えと再開は、今までどおり本番 SQL で行います。
            </p>
          </div>
        </>
      )}
    </section>
  );
}

// onAttentionCount: 要対応の件数を親（ページのナビ）へ知らせる。10秒ごとの読み直しに追従させる
export default function DeadlineQueuePanel({ onAttentionCount }) {
  const [rows, setRows] = useState([]);
  const [control, setControl] = useState(null);
  const [error, setError] = useState("");
  const [stopError, setStopError] = useState("");
  const [busy, setBusy] = useState(false);
  const dayRef = useRef(null);
  const [selection, setSelection] = useState({
    month: "",
    day: "",
    format: "",
    venue: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshRef = useRef(async () => {});
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) setNow(Date.now());
      try {
        const data = await getDeadlineQueue();
        if (active) {
          setRows(data.rows);
          setControl(data.control);
          setError("");
          setLoaded(true);
        }
      } catch {
        if (active)
          setError("待ち行列を取得できません。送信状態を確認してください。");
      }
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (selection.day) {
      dayRef.current?.focus();
      dayRef.current?.scrollIntoView({ block: "start" });
    }
  }, [selection.day]);
  async function stop() {
    setBusy(true);
    setStopError("");
    try {
      await stopXSend();
    } catch {
      setStopError(
        "止める操作の結果を確認できません。状態を読み直してから判断してください。",
      );
    } finally {
      await refreshRef.current();
      setBusy(false);
    }
  }
  const attention = attentionRows(rows, now);
  const attentionCount = loaded ? attention.length : null;
  useEffect(() => {
    if (attentionCount !== null) onAttentionCount?.(attentionCount);
  }, [attentionCount, onAttentionCount]);
  const today = todayDay(now);
  const dayRows = selection.day
    ? calendarMonth(rows, selection.month, selection).filter(
        (row) => calendarRowDay(row) === selection.day,
      )
    : [];
  return (
    <div className="sns-auto-send">
      {error && <p role="alert">{error}</p>}
      {!loaded && !error && <p role="status">読み込み中…</p>}
      {loaded && (
        <>
          <SendControlBand control={control} busy={busy} onStop={stop} />
          {stopError && <p role="alert">{stopError}</p>}
          <DeadlineQueueList
            title="要対応"
            rows={attention}
            now={now}
            emptyText="要対応の投稿はありません（失敗・保留・失効は直近3日、要照合は日付に関係なく出します）。"
          />
          <DeadlineQueueList
            title={`今日 ${today.slice(5).replace("-", "/")}（JST）`}
            rows={rowsOfDay(rows, today)}
            now={now}
            emptyText="今日の投稿はありません。"
          />
          <details className="sns-auto-calendar">
            <summary>全月カレンダー（JST）を開く</summary>
            <MonthCalendar
              rows={rows}
              now={now}
              selection={selection}
              onSelection={setSelection}
            />
            {selection.day && (
              <div ref={dayRef} tabIndex={-1}>
                <DeadlineQueueList
                  title={`${selection.day} の一覧`}
                  rows={dayRows}
                  now={now}
                />
              </div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
