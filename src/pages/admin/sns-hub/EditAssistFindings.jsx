/** 点検は助言。採用は修正方針の記録で、本文を自動変更しない。 */
export default function EditAssistFindings({ row, approverId, busy, onDecision }) {
  const inspection=row.inspection;
  return <section className="sns-edit-findings" aria-label="編集補助の指摘">
    <h4>編集補助・読みやすさ点検</h4>
    <p>指摘は承認を止めません。採用／無視は判断の記録です。採用した修正は別途本文へ反映してください。AI点検は無効です。</p>
    {row.inspectionError && <p role="alert">{row.inspectionError}</p>}
    {!inspection && !row.inspectionError && <p>点検結果は未取得です。</p>}
    {inspection && !inspection.findings.length && <p>機械点検の指摘はありません。内容の正しさを保証するものではありません。</p>}
    {inspection?.findings.map(f=><div key={f.id} className="sns-edit-finding">
      <p>場所：{f.location}</p><p>内容：{f.content}</p><p>理由：{f.reason}</p><p>直し方の案：{f.suggestion}</p>
      <p>判断：{({adopted:'採用',ignored:'無視'})[inspection.decisions?.[f.id]] || '未判断'}</p>
      <button type="button" disabled={busy || !approverId || !row.versionHash} onClick={()=>onDecision(row,approverId,f.id,'adopted')}>この指摘を採用</button>
      <button type="button" disabled={busy || !approverId || !row.versionHash} onClick={()=>onDecision(row,approverId,f.id,'ignored')}>この指摘を無視</button>
    </div>)}
  </section>;
}
