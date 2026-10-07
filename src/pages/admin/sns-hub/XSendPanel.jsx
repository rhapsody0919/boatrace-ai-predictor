import { useEffect, useState } from 'react';
import { approveXSend, cancelXSend, getXSendStatus, stopXSend } from '../../../services/snsHubService.js';

const LABELS = { queued: '予約・待機中', sending: '送信中', reconcile: '要照合（再送禁止）',
  posted: '送信成功', failed: '送信前に失敗（再承認が必要）', cancelled: '承認失効・取消済み' };

export default function XSendPanel({ draft, approverId, blocked, onChanged, onStateChange }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => getXSendStatus(draft.id).then(data => {
      if (active) { setStatus(data); onStateChange?.(data.job?.state || 'none'); }
    }).catch(() => { if (active) { setError('X送信状態を取得できません'); onStateChange?.('unknown'); } });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [draft.id, draft.status, onStateChange]);

  async function act(action) {
    setBusy(true); setError('');
    try {
      await action();
      const updated = await getXSendStatus(draft.id);
      setStatus(updated); onStateChange?.(updated.job?.state || 'none');
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const locked = ['queued', 'sending', 'reconcile', 'posted'].includes(status?.job?.state);
  const canApprove = ['pending_review', 'approved'].includes(draft.status);
  return (
    <section className="draft-background-details" aria-label="X送信">
      <p>X送信: {LABELS[status?.job?.state] || '未登録'}</p>
      {!status?.connected && <p>接続準備中。公開・予約送信はまだ利用できません。</p>}
      {status?.control?.paused && <p>送信停止中</p>}
      {status?.control && <p>月額上限 ${(status.control.budget_microusd / 1000000).toFixed(2)} / 予約済み ${(status.control.reserved_microusd / 1000000).toFixed(2)}</p>}
      {status?.job?.scheduled_at && <p>予定: {new Date(status.job.scheduled_at).toLocaleString('ja-JP')}</p>}
      {status?.job?.external_post_url && <a href={status.job.external_post_url} target="_blank" rel="noreferrer">Xの投稿を確認</a>}
      {canApprove && <>
        <label>予約日時（空欄は即時）<input aria-label="X予約日時" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></label>
        <button className="draft-action-btn approve" disabled={busy || blocked || locked || !approverId || !status?.connected || status?.control?.paused}
          onClick={() => act(() => approveXSend(draft.id, approverId, scheduledAt ? new Date(scheduledAt).toISOString() : null))}>
          {scheduledAt ? '承認して予約' : '承認して公開'}
        </button>
      </>}
      {status?.job?.state === 'queued' && <button className="draft-action-btn revise" disabled={busy}
        onClick={() => act(() => cancelXSend(draft.id))}>X予約・待機を取消</button>}
      <button className="draft-action-btn revise" disabled={busy || !status?.control} onClick={() => act(stopXSend)}>X送信を停止</button>
      {['sending','reconcile'].includes(status?.job?.state) && <p>手動投稿も照合が済むまで停止してください。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
