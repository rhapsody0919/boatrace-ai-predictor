import { useEffect, useState } from 'react';
import { getDraftDiff } from '../../../services/snsHubService.js';
import { compareDraftSnapshots, draftContent } from '../../../utils/snsDraftDiff.js';
import './DraftDiffPanel.css';
const labels={video:'動画',cover:'画像・サムネイル',dataCard:'追加画像'};
const value=v=>v===undefined?'未記録':v===null?'空欄':JSON.stringify(v);
const canonical=v=>v && typeof v==='object' ? (Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))) : v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function DraftDiffView({ data, baseline, onBaseline }) {
  const before=data[baseline], diff=before?compareDraftSnapshots(before,data.current):null;
  return <section className="sns-draft-diff" aria-label="下書きの版の差分">
    <h4>版の差分</h4>
    <label>比較する版<select value={baseline} onChange={e=>onBaseline(e.target.value)}>
      <option value="previous">直前の版</option><option value="approved">最後に承認された版</option>
    </select></label>
    <p>削除は「−」と取り消し線、追加は「＋」と下線で表示します。</p>
    {!before ? <p>{baseline==='approved'?'保存された承認版がありません。':'比較できる直前の版がありません。'}</p> : <>
      <p>基準の下書き：{before.draft_id || '未記録'} / {before.origin==='last_displayed'?'直前に表示した内容':baseline==='approved'?'承認時の内容':'再生成前の内容'}</p>
      {before.approved_at && <p>承認時刻：{before.approved_at}</p>}
      {diff.text.map(field=><div key={field.key}><h5>{field.label}</h5><p className="sns-draft-diff-copy">{field.parts.map((part,i)=>part.kind==='same'?<span key={i}>{part.text}</span>:part.kind==='removed'?<del key={i}><span aria-hidden="true">−</span>{part.text}</del>:<ins key={i}><span aria-hidden="true">＋</span>{part.text}</ins>)}</p></div>)}
      {diff.media.map(m=><div key={m.key}><h5>{labels[m.key]}</h5>
        <p>{m.state==='unknown'?'ファイル hash 未確認（差し替えを判定できません）':m.state==='added'?'追加':m.state==='removed'?'削除':'差し替え（ファイル hash 変更）'}</p>
        <p>前：{m.before?.path || 'なし'} / SHA256：{m.before?.sha256 || '未確認'}</p>
        <p>今：{m.after?.path || 'なし'} / SHA256：{m.after?.sha256 || '未確認'}</p>
      </div>)}
      {diff.numbers.length>0 && <div><h5>source_data の変わった数値</h5><dl>{diff.numbers.map(n=><div key={n.path}><dt>{n.path}</dt><dd>{value(n.before)} → {value(n.after)}</dd></div>)}</dl></div>}
      {!diff.text.length && !diff.media.length && !diff.numbers.length && <p>比較対象の本文・タイトル・タグ・説明文・媒体 hash・数値に変更はありません。</p>}
    </>}
  </section>;
}
export default function DraftDiffPanel({ draft, versionHash }) {
  const [result,setResult]=useState(null),[failed,setFailed]=useState(null),[reload,setReload]=useState(0),[baseline,setBaseline]=useState('previous');
  const contentKey=JSON.stringify(canonical(draftContent(draft)));
  const key=`${draft.id}:${contentKey}:${versionHash}:${reload}`;
  useEffect(()=>{
    let active=true;
    getDraftDiff(draft.id,versionHash).then(r=>{if(active)setResult({key,data:r.data});}).catch(error=>{if(active)setFailed({key,stale:error.code==='draft_version_changed'});});
    return()=>{active=false;};
  },[draft.id,key,versionHash]);
  if(failed?.key===key && failed.stale) return <p role="alert">最新の版に更新されています。再読み込みしてください</p>;
  if(failed?.key===key) return <div className="sns-draft-diff" role="alert"><p>差分を取得できません。最新の状態を確認してください。</p><button type="button" onClick={()=>setReload(v=>v+1)}>差分を再取得</button></div>;
  if(!result || result.key!==key) return <p>差分を読み込み中…</p>;
  if(!result.data?.current || !equal(result.data.current.content,draftContent(draft))) return <p role="alert">差分の取得中に本文が変わりました。一覧またはレースを再読み込みしてください。</p>;
  return <DraftDiffView key={draft.id} data={result.data} baseline={baseline} onBaseline={setBaseline} />;
}
