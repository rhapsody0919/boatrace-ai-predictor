import { useEffect, useState } from 'react';
import { getDeadlineQueue } from '../../../services/snsHubService.js';

const labels = { queued: '投稿予定', sending: '送信中', reconcile: '要照合（再送禁止）', held: '保留',
  posted: '公開済み', failed: '失敗', cancelled: '承認失効', pending_review: '承認待ち', approved: '承認済み・未登録' };
const format = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '未設定';

export function DeadlineQueueList({ rows, now }) {
  const ordered = [...rows].sort((a, b) => (Date.parse(a.expires_at) || Infinity) - (Date.parse(b.expires_at) || Infinity));
  return <section className="draft-background-details" aria-label="期限順の投稿一覧">
    <h2>投稿待ち行列（JST）</h2>
    <p>各投稿の個別承認が必要です。時刻・本数の設定と実接続は確認待ちです。</p>
    {!ordered.length && <p>対象の投稿はありません。</p>}
    <ul>{ordered.map(row => <li key={row.id}>
      <p>{row.title || row.draft_id} / {row.channel === 'youtube' ? 'YouTube' : 'X'} / {row.youtube_mode === 'scheduled' ? '予約公開' : '即時公開'}</p>
      <p>{['queued','held','pending_review','approved'].includes(row.state) && Date.parse(row.expires_at) <= now ? '失効（送信不可）' : labels[row.state] || row.state}</p>
      <p>投稿予定: {format(row.scheduled_at)} / 送信期限: {format(row.expires_at)} / 公式締切: {format(row.deadline_at)}</p>
      {row.error_code && <p>保留・失敗理由: {row.error_code}</p>}
    </li>)}</ul>
  </section>;
}
export default function DeadlineQueuePanel() {
  const [rows, setRows] = useState([]), [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) setNow(Date.now());
      try { const data = await getDeadlineQueue(); if (active) { setRows(data); setError(''); } }
      catch { if (active) setError('待ち行列を取得できません。送信状態を確認してください。'); }
    };
    refresh(); const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <>{error && <p role="alert">{error}</p>}<DeadlineQueueList rows={rows} now={now} /></>;
}
