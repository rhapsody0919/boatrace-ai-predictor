import { useEffect, useState } from "react";
import {
  getMobileApprovalGroups,
  getMobileApprovalRace,
  approveMobileChannel,
  decideMobileFinding,
  redoDraft,
} from "../../../services/snsHubService.js";
import "./MobileApprovalPanel.css";
import EditAssistFindings from "./EditAssistFindings.jsx";
const time = (value) =>
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

export function MobileRaceReview({
  rows,
  approvers,
  onApprove,
  onRevision,
  onDecision,
  busy,
}) {
  const [approverId, setApproverId] = useState(""),
    [reasons, setReasons] = useState({}),
    [mediaStates, setMediaStates] = useState({});
  return (
    <div className="sns-mobile-race">
      <label>
        承認者
        <select
          value={approverId}
          onChange={(e) => setApproverId(e.target.value)}
        >
          <option value="">選択してください</option>
          {approvers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </select>
      </label>
      {rows.map((row) => {
        const d = row.draft,
          s = d.source_data || {},
          claims = s.bundle?.claims || [],
          manifest = s.source_manifest || [];
        // X snapshotと同じ優先順（動画があればcover画像は送信対象外）。
        const needsVideo =
          d.platform === "youtube" || Boolean(d.video_storage_path);
        const needsImage =
          d.platform === "x" &&
          !d.video_storage_path &&
          Boolean(d.cover_image_path);
        const mediaUrl = needsVideo
          ? row.videoUrl
          : needsImage
            ? row.imageUrl
            : null;
        const mediaKey = `${d.id}:${row.versionHash}:${mediaUrl}`;
        const mediaReady =
          !(needsVideo || needsImage) ||
          (mediaUrl && mediaStates[mediaKey] === "ready");
        const loaded = () =>
          setMediaStates((v) => ({ ...v, [mediaKey]: "ready" }));
        const failed = () =>
          setMediaStates((v) => ({ ...v, [mediaKey]: "failed" }));
        // 修正理由はチャネル（下書き）ごとに分離する。1レースにX・YouTube Shortsの
        // 2チャネルが並ぶため、共有stateだと片方への入力が他方に混入する。
        const reason = reasons[d.id] || "";
        const setReason = (value) =>
          setReasons((v) => ({ ...v, [d.id]: value }));
        return (
          <article key={d.id} className="sns-mobile-channel">
            <h3>
              {d.platform === "youtube" ? "YouTube Shorts" : "X"}：{d.title}
            </h3>
            <p>
              {s.race_id || "レース不明"} / stage:{" "}
              {s.stage || s.bundle?.stage || "未確認"}
            </p>
            <p>
              状態：{row.job?.state || d.status} / 公開時刻：
              {time(row.job?.posted_at)}
            </p>
            {row.job?.external_post_url && (
              <a
                href={row.job.external_post_url}
                target="_blank"
                rel="noreferrer"
              >
                公開結果を確認
              </a>
            )}
            {needsVideo &&
              (mediaUrl ? (
                <video
                  key={mediaKey}
                  aria-label={d.platform === "x" ? "X添付動画" : "Shorts動画"}
                  controls
                  preload="auto"
                  src={mediaUrl}
                  onLoadedData={loaded}
                  onError={failed}
                />
              ) : (
                <p>動画未完成・プレビューなし</p>
              ))}
            {needsImage &&
              (mediaUrl ? (
                <img
                  key={mediaKey}
                  src={mediaUrl}
                  alt="X添付画像"
                  onLoad={loaded}
                  onError={failed}
                />
              ) : (
                <p>X添付画像のプレビューなし</p>
              ))}
            {(needsVideo || needsImage) && !mediaReady && (
              <p>
                {mediaStates[mediaKey] === "failed"
                  ? "添付を読み込めません。再読込して確認してください。"
                  : "添付プレビューの読込・確認が必要です。"}
              </p>
            )}
            <p className="sns-mobile-copy">{d.caption_text}</p>
            <p>{d.hashtags?.join(" ")}</p>
            <EditAssistFindings
              row={row}
              approverId={approverId}
              busy={busy}
              onDecision={onDecision}
            />
            <h4>主張と出典</h4>
            {!claims.length && <p>出典欠落</p>}
            {claims.map((c, i) => {
              const m = manifest.find(
                (entry) => entry.name === `${c.source}.json`,
              );
              return (
                <div key={i}>
                  <p>
                    {c.label || c.source}：{JSON.stringify(c.value)}
                  </p>
                  <p>
                    出典パス：{c.source}/{c.path?.join("/")}
                  </p>
                  <p>
                    件数：{c.count ?? "未確認"} / 範囲：{c.scope || "未確認"} /
                    stage：{m?.stage || "未確認"}
                  </p>
                  <p>
                    取得時点：{time(m?.fetched_at)} / 原文：
                    {m?.source_url || "未確認"}
                  </p>
                </div>
              );
            })}
            <h4>正式公開証拠・risk / QA</h4>
            <p>
              {s.release_evidence?.status || "未確認"} /{" "}
              {s.release_evidence?.url || "公開証拠なし"}
            </p>
            <p>
              QA：{s.qa?.pass === true ? "合格" : "未確認・失敗"} / 数値照合：
              {s.qa?.numeric_claims_match === true ? "合格" : "未確認・失敗"}
            </p>
            <p>risk：{JSON.stringify(d.risk_flags ?? "未確認")}</p>
            <p>
              投稿予定（JST）：{time(row.job?.scheduled_at || d.scheduled_at)} /
              期限：{time(row.job?.expires_at || s.deadline_queue?.expires_at)}
            </p>
            <p>確認版：{row.versionHash || "取得失敗"}</p>
            {row.holds.length > 0 && (
              <ul>
                {row.holds.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={
                busy ||
                !approverId ||
                !row.versionHash ||
                row.holds.length > 0 ||
                !mediaReady
              }
              onClick={() => onApprove(row, approverId)}
            >
              この版の{d.platform === "youtube" ? "Shorts" : "X"}だけ承認
            </button>
            <label>
              修正理由
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !approverId ||
                !reason.trim() ||
                d.status !== "pending_review" ||
                Boolean(
                  d.bundle_import_id ||
                  d.bundle_version_hash ||
                  d.publish_blocked,
                )
              }
              onClick={() => onRevision(row, approverId, reason)}
            >
              この投稿の修正を依頼
            </button>
          </article>
        );
      })}
    </div>
  );
}
export default function MobileApprovalPanel({
  approvers,
  onOperationChange,
  onChanged,
}) {
  const [groups, setGroups] = useState([]),
    [group, setGroup] = useState(""),
    [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [warning, setWarning] = useState(""),
    [busy, setBusy] = useState(false),
    [opened, setOpened] = useState(Date.now());
  useEffect(() => {
    let active = true;
    getMobileApprovalGroups()
      .then((r) => {
        if (active) setGroups(r.data);
      })
      .catch(() => {
        if (active) setError("今日のレースを取得できません");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setRows([]);
    if (group)
      getMobileApprovalRace(group)
        .then((r) => {
          if (active) {
            setRows(r.data);
            setOpened(Date.now());
          }
        })
        .catch(() => {
          if (active) setError("レースを取得できません");
        });
    return () => {
      active = false;
    };
  }, [group]);
  async function act(row, approverId, reason) {
    onOperationChange?.(row.draft.id, true);
    setBusy(true);
    setError("");
    setWarning("");
    try {
      if (reason) {
        const result = await redoDraft(row.draft.id, {
          approverId,
          reasonCodes: [],
          freeText: reason,
          saveAsInsight: false,
          scope: "channel",
        });
        if (result.routine?.fired === false)
          setWarning(
            "修正依頼は保存されましたが、修正処理を起動できませんでした。処理状況を確認してください。",
          );
      } else
        await approveMobileChannel(group, {
          draftId: row.draft.id,
          approverId,
          versionHash: row.versionHash,
          reviewSeconds: Math.min(
            86400,
            Math.floor((Date.now() - opened) / 1000),
          ),
        });
      setRows([]);
      const result = await getMobileApprovalRace(group);
      setRows(result.data);
      setOpened(Date.now());
    } catch {
      setRows([]);
      setError(
        `レースの最新状態を取得できませんでした。レースを選び直して確認してください。`,
      );
    } finally {
      // POST応答消失・409・後続GET失敗でも、親一覧と既存カードを再取得する。
      try {
        await onChanged?.();
      } catch {
        setError(
          (e) =>
            e || "一覧の最新状態を取得できません。再読込して確認してください。",
        );
      }
      onOperationChange?.(row.draft.id, false);
      setBusy(false);
    }
  }
  async function decide(row, approverId, findingId, decision) {
    setBusy(true);
    setError("");
    try {
      await decideMobileFinding(group, {
        draftId: row.draft.id,
        approverId,
        versionHash: row.versionHash,
        inspectionId: row.inspection.id,
        findingId,
        decision,
      });
      const result = await getMobileApprovalRace(group);
      setRows(result.data);
    } catch (e) {
      // 「本人」以外（例: 自動承認）を選んで判断した場合のAPI固定文言だけを安全に通す。
      // それ以外は既存どおり汎用文言に倒す（生のエラー文は表示しない）。
      if (e?.message === "本人の判断が必要です") {
        setError(e.message);
      } else {
        setRows([]);
        setError(
          "レースの最新状態を取得できませんでした。レースを選び直して確認してください。",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="sns-mobile-approval"
      aria-label="今日のレースの個別承認"
    >
      <h2>今日のレースを確認・個別承認</h2>
      <p>
        ShortsとXを同じ画面で確認します。承認は各投稿ごとです。送信は未接続・停止中です。
      </p>
      <label>
        レース
        <select
          value={group}
          disabled={busy}
          onChange={(e) => {
            setGroup(e.target.value);
            setError("");
            setWarning("");
          }}
        >
          <option value="">選択してください</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.raceId}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {warning && <p role="alert">{warning}</p>}
      <MobileRaceReview
        rows={rows}
        approvers={approvers}
        busy={busy}
        onDecision={decide}
        onApprove={(r, a) => act(r, a)}
        onRevision={(r, a, reason) => act(r, a, reason)}
      />
    </section>
  );
}
