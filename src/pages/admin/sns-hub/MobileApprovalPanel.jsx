import { useEffect, useState } from 'react';
import { getMobileApprovalGroups, getMobileApprovalRace, approveMobileChannel, redoDraft } from '../../../services/snsHubService.js';
import './MobileApprovalPanel.css';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)) : '未設定';

export function MobileRaceReview({ rows, approvers, onApprove, onRevision, busy }) {
  const [approverId,setApproverId] = useState(''), [reason,setReason] = useState(''), [failedVideos,setFailedVideos] = useState({});
  return <div className="sns-mobile-race">
    <label>承認者<select value={approverId} onChange={e=>setApproverId(e.target.value)}><option value="">選択してください</option>{approvers.map(a=><option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label>
    {rows.map(row=>{ const d=row.draft, s=d.source_data || {}, claims=s.bundle?.claims || [], manifest=s.source_manifest || [];
      return <article key={d.id} className="sns-mobile-channel">
        <h3>{d.platform === 'youtube' ? 'YouTube Shorts' : 'X'}：{d.title}</h3>
        <p>{s.race_id || 'レース不明'} / stage: {s.stage || s.bundle?.stage || '未確認'}</p>
        <p>状態：{row.job?.state || d.status} / 公開時刻：{time(row.job?.posted_at)}</p>
        {row.job?.external_post_url && <a href={row.job.external_post_url} target="_blank" rel="noreferrer">公開結果を確認</a>}
        {d.platform==='youtube' && (row.videoUrl ? <video controls preload="metadata" src={row.videoUrl} onError={()=>setFailedVideos(v=>({...v,[row.versionHash]:true}))} /> : <p>動画未完成・プレビューなし</p>)}
        <p className="sns-mobile-copy">{d.caption_text}</p>
        <p>{d.hashtags?.join(' ')}</p>
        <h4>主張と出典</h4>
        {!claims.length && <p>出典欠落</p>}
        {claims.map((c,i)=>{const m=manifest.find(entry=>entry.name===`${c.source}.json`); return <div key={i}>
          <p>{c.label || c.source}：{JSON.stringify(c.value)}</p>
          <p>出典パス：{c.source}/{c.path?.join('/')}</p>
          <p>件数：{c.count ?? '未確認'} / 範囲：{c.scope || '未確認'} / stage：{m?.stage || '未確認'}</p>
          <p>取得時点：{time(m?.fetched_at)} / 原文：{m?.source_url || '未確認'}</p>
        </div>;})}
        <h4>正式公開証拠・risk / QA</h4>
        <p>{s.release_evidence?.status || '未確認'} / {s.release_evidence?.url || '公開証拠なし'}</p>
        <p>QA：{s.qa?.pass === true ? '合格' : '未確認・失敗'} / 数値照合：{s.qa?.numeric_claims_match === true ? '合格' : '未確認・失敗'}</p>
        <p>risk：{JSON.stringify(d.risk_flags ?? '未確認')}</p>
        <p>投稿予定（JST）：{time(row.job?.scheduled_at || d.scheduled_at)} / 期限：{time(row.job?.expires_at || s.deadline_queue?.expires_at)}</p>
        <p>確認版：{row.versionHash || '取得失敗'}</p>
        {row.holds.length>0 && <ul>{row.holds.map(h=><li key={h}>{h}</li>)}</ul>}
        <button type="button" disabled={busy || !approverId || !row.versionHash || row.holds.length>0 || (d.platform==='youtube' && (!row.videoUrl || failedVideos[row.versionHash]))} onClick={()=>onApprove(row,approverId)}>この版の{d.platform === 'youtube' ? 'Shorts' : 'X'}だけ承認</button>
        <label>修正理由<textarea value={reason} onChange={e=>setReason(e.target.value)} /></label>
        <button type="button" disabled={busy || !approverId || !reason.trim() || d.status !== 'pending_review' || Boolean(d.bundle_import_id || d.bundle_version_hash || d.publish_blocked)} onClick={()=>onRevision(row,approverId,reason)}>この投稿の修正を依頼</button>
      </article>;
    })}
  </div>;
}
export default function MobileApprovalPanel({ approvers }) {
  const [groups,setGroups] = useState([]),[group,setGroup] = useState(''),[rows,setRows] = useState([]),[error,setError] = useState(''),[busy,setBusy] = useState(false),[opened,setOpened] = useState(Date.now());
  useEffect(()=>{let active=true; getMobileApprovalGroups().then(r=>{if(active)setGroups(r.data);}).catch(()=>{if(active)setError('今日のレースを取得できません');}); return()=>{active=false;};},[]);
  useEffect(()=>{let active=true; setRows([]); if(group) getMobileApprovalRace(group).then(r=>{if(active){setRows(r.data);setOpened(Date.now());}}).catch(()=>{if(active)setError('レースを取得できません');}); return()=>{active=false;};},[group]);
  async function act(row,approverId,reason) {
    setBusy(true); setError('');
    try {
      if(reason) await redoDraft(row.draft.id,{approverId,reasonCodes:[],freeText:reason,saveAsInsight:false,scope:'channel'});
      else await approveMobileChannel(group,{draftId:row.draft.id,approverId,versionHash:row.versionHash,reviewSeconds:Math.min(86400,Math.floor((Date.now()-opened)/1000))});
      setRows([]); const result=await getMobileApprovalRace(group);setRows(result.data);setOpened(Date.now());
    } catch(e) { setRows([]);setError(`${e.message}。レースを選び直して確認してください。`); }
    finally {setBusy(false);}
  }
  return <section className="sns-mobile-approval" aria-label="今日のレースの個別承認">
    <h2>今日のレースを確認・個別承認</h2>
    <p>ShortsとXを同じ画面で確認します。承認は各投稿ごとです。送信は未接続・停止中です。</p>
    <label>レース<select value={group} disabled={busy} onChange={e=>{setGroup(e.target.value);setError('');}}><option value="">選択してください</option>{groups.map(g=><option key={g.id} value={g.id}>{g.raceId}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    <MobileRaceReview rows={rows} approvers={approvers} busy={busy} onApprove={(r,a)=>act(r,a)} onRevision={(r,a,reason)=>act(r,a,reason)} />
  </section>;
}
