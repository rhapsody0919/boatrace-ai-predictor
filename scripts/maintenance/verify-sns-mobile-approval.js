import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mobileHolds, prepareMobileReview, approveMobileReview } from '../../api/_lib/snsMobileApproval.js';
const db=new PGlite();
const first=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
let approver;
const media=async()=>new Uint8Array([1,2,3]);
const source=()=>({race_id:'2026-10-07-11-10',stage:'exhibition',bundle:{claims:[{source:'layer',path:['count'],value:12,count:12,scope:'当日の出走選手'}]},
 source_manifest:[{name:'layer.json',hash_verified:true,sha256:'a'.repeat(64),stage:'exhibition',source_url:'https://example.com/source',fetched_at:new Date().toISOString()}],
 qa:{pass:true,numeric_claims_match:true},release_evidence:{status:'released',url:'https://example.com/release'},deadline_queue:{deadline_at:new Date(Date.now()+7200000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()}});
before(async()=>{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
 for(const f of ['035_sns_marketing_hub_schema.sql','042_content_drafts_columns.sql','135_sns_preview_bundle_import.sql','137_sns_x_send.sql','139_sns_deadline_queue.sql','140_sns_mobile_approval.sql']) await db.exec(await readFile(new URL('../../docs/db-migration/'+f,import.meta.url),'utf8'));
 approver=(await first("SELECT id FROM sns_approvers WHERE display_name='本人'")).id;
});
after(()=>db.close());
async function draft(platform='x',group=null){return first("INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,title,video_storage_path,source_data,risk_flags) VALUES(coalesce($1::uuid,gen_random_uuid()),'short',$2,'ja','ボートレースの発見','タイトル','demo/a.mp4',$3,'[]') RETURNING *",[group,platform,source()]);}
async function row(d){return (await first('SELECT read_sns_mobile_race($1) AS result',[d.content_group_id])).result.find(r=>r.draft.id===d.id);}
const approve=async(id,a,revision,snapshot,scheduled,seconds)=>(await first('SELECT approve_sns_mobile_channel($1,$2,$3,$4,$5,$6) result',[id,a,revision,snapshot,scheduled,seconds])).result;
test('1レース2チャネルを返し、個別承認・版・レビュー時間を保存、初期停止を維持',async()=>{
 const x=await draft(),y=await draft('youtube',x.content_group_id),r=await row(x),review=await prepareMobileReview(r,media);
 assert.deepEqual(review.holds,[]); assert.equal((await first('SELECT read_sns_mobile_race($1) r',[x.content_group_id])).r.length,2);
 const j=await approveMobileReview(r,{approverId:approver,versionHash:review.versionHash,reviewSeconds:12},{loadMedia:media,approve});assert.equal(j.channel,'x');
 assert.equal((await first('SELECT status FROM sns_drafts WHERE id=$1',[y.id])).status,'pending_review');
 assert.equal((await first('SELECT review_seconds FROM sns_mobile_reviews WHERE draft_id=$1',[x.id])).review_seconds,12);
 assert.equal((await first('SELECT paused FROM sns_x_send_control')).paused,true);
});
test('本文/QA/根拠の変更とDBロックまでの変更は409用の拒否、古い版に承認しない',async()=>{
 const d=await draft(),r=await row(d),v=await prepareMobileReview(r,media);
 await db.query("UPDATE sns_drafts SET caption_text='変更版' WHERE id=$1",[d.id]);
 await assert.rejects(()=>approve(d.id,approver,r.revision,v.snapshot,null,1),/版が変わりました/);
 const current=await row(d); await assert.rejects(()=>approveMobileReview(current,{versionHash:v.versionHash,approverId:approver,reviewSeconds:1},{loadMedia:media,approve}));
 assert.equal((await first('SELECT count(*) n FROM sns_mobile_reviews WHERE draft_id=$1',[d.id])).n,0);
});
test('同じパスの動画上書きは版hash不一致で拒否',async()=>{
 const r=await row(await draft('youtube')),v=await prepareMobileReview(r,media);
 await assert.rejects(()=>approveMobileReview(r,{versionHash:v.versionHash,approverId:approver,reviewSeconds:1},{loadMedia:async()=>new Uint8Array([9]),approve}));
});
test('動画未完成、QA失敗、出典/件数/範囲/公開証拠欠落、v0は保留',async()=>{
 const d=await draft('youtube');
 for(const change of [v=>v.video_storage_path=null,v=>v.source_data.qa.pass=false,v=>v.source_data.source_manifest=[],v=>delete v.source_data.bundle.claims[0].count,v=>delete v.source_data.bundle.claims[0].scope,v=>delete v.source_data.release_evidence,v=>v.bundle_version_hash='v0',v=>v.risk_flags=[{id:'L0'}]]){
  const v=structuredClone(d);change(v);assert.ok(mobileHolds(v).length>0);
 }
});
test('テーブル/RPCは一般ロールに公開しない',async()=>{
 await db.exec('SET ROLE authenticated'); await assert.rejects(()=>db.query('SELECT * FROM sns_mobile_reviews'));await assert.rejects(()=>db.query('SELECT read_sns_mobile_race(gen_random_uuid())')); await db.exec('RESET ROLE');
});

test('承認後のrisk変更で承認を消しjobを取消、QA変更中の承認も拒否',async()=>{
 const d=await draft(),r=await row(d),v=await prepareMobileReview(r,media);
 await approve(d.id,approver,r.revision,v.snapshot,null,1);
 await db.query('UPDATE sns_drafts SET risk_flags=$2 WHERE id=$1',[d.id,[{id:'L0'}]]);
 assert.equal((await first('SELECT x_approved_hash FROM sns_drafts WHERE id=$1',[d.id])).x_approved_hash,null);
 assert.equal((await first('SELECT state FROM sns_x_send_jobs WHERE draft_id=$1',[d.id])).state,'cancelled');
 const y=await draft('youtube'),yr=await row(y),yv=await prepareMobileReview(yr,media);
 await db.query("UPDATE sns_drafts SET source_data=jsonb_set(source_data,'{qa,pass}','false') WHERE id=$1",[y.id]);
 await assert.rejects(()=>approve(y.id,approver,yr.revision,yv.snapshot,null,1),/版が変わりました/);
});

test('F04: 1groupの上限を超えた下書きは媒体取得前のSQL readで拒否する',async()=>{
 const d=await draft();
 for(let i=0;i<19;i++) await draft('x',d.content_group_id);
 assert.equal((await first('SELECT read_sns_mobile_race($1) result',[d.content_group_id])).result.length,20);
 await draft('x',d.content_group_id);
 await assert.rejects(()=>row(d),/取得上限/);
});
