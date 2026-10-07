import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createMockXAdapter, createXSnapshot, runXSendJob } from '../../api/_lib/snsXSend.js';
const db = new PGlite();
let approver;
const bytes = new Uint8Array([1,2,3,4]);
const loadMedia = async () => bytes;
const wait = async () => {};
const query = (sql,args=[]) => db.query(sql,args);
const first = async (sql,args) => (await query(sql,args)).rows[0];
const store = { async transition(id,action,result={}) {
  return (await first('SELECT transition_sns_x_send($1,$2,$3) AS result',[id,action,result])).result;
}};
before(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for(const name of ['035_sns_marketing_hub_schema.sql','135_sns_preview_bundle_import.sql','137_sns_x_send.sql'])
    await db.exec(await readFile(new URL('../../docs/db-migration/'+name,import.meta.url),'utf8'));
  approver=(await first("SELECT id FROM sns_approvers WHERE display_name='本人'")).id;
});
after(()=>db.close());
async function draft() {
  return first("INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,hashtags,video_storage_path) VALUES(gen_random_uuid(),'short','x','ja','ボートレースの発見',ARRAY['#龍神レーダー'],'demo/x.mp4') RETURNING *");
}
async function approve(d,snapshot) {
  return (await first('SELECT approve_sns_x_send($1,$2,$3) AS result',[d.id,approver,snapshot || await createXSnapshot(d,loadMedia)])).result;
}
async function enable(ceiling=300000) {
  await query("UPDATE sns_x_send_control SET paused=false,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=$1,reserved_microusd=0",[ceiling]);
}
const run=(j,x,extra={})=>runXSendJob(j.id,{store,x,loadMedia,wait,...extra});

test('初期停止・未承認・本人以外は送らない',async()=>{
  const d=await draft(), j=await approve(d), x=createMockXAdapter();
  await assert.rejects(run(j,x),/停止中/); assert.equal(x.calls.length,0);
  const outsider=(await first("INSERT INTO sns_approvers(display_name) VALUES('自動承認') RETURNING id")).id;
  await assert.rejects(query('SELECT approve_sns_x_send($1,$2,$3)',[d.id,outsider,j.snapshot]),/本人/);
  await query("UPDATE sns_drafts SET status='pending_review' WHERE id=$1",[d.id]); await enable();
  await assert.rejects(store.transition(j.id,'claim'),/再承認/);
});
test('本文・タグ・媒体パス編集で再承認、snapshot取得中の編集拒否',async()=>{
  for(const patch of ["caption_text='変更'","hashtags=ARRAY['#変更']","video_storage_path='demo/new.mp4'","cover_image_path='demo/new.jpg'"]) {
    const d=await draft(),j=await approve(d);
    await query(`UPDATE sns_drafts SET ${patch} WHERE id=$1`,[d.id]);
    const edited=await first('SELECT * FROM sns_drafts WHERE id=$1',[d.id]);
    assert.equal(edited.status,'pending_review'); assert.equal(edited.x_approved_hash,null);
    assert.equal((await first('SELECT state FROM sns_x_send_jobs WHERE id=$1',[j.id])).state,'cancelled');
    await assert.rejects(approve(edited,j.snapshot),/承認中/); await approve(edited);
  }
});
test('媒体処理完了後に承認版を送る、二重claimと送信中編集拒否',async()=>{
  await enable(); const j=await approve(await draft());
  const x=createMockXAdapter({processingStates:['pending','in_progress','succeeded']});
  const guarded={async transition(id,action,result){
    const value=await store.transition(id,action,result);
    if(action==='claim') {
      await assert.rejects(store.transition(id,'claim'),/claim/);
      await assert.rejects(query("UPDATE sns_drafts SET caption_text='変更' WHERE id=$1",[j.draft_id]),/照合完了/);
    }
    return value;
  }};
  assert.equal((await run(j,x,{store:guarded})).state,'posted');
  assert.equal((await first('SELECT status FROM sns_drafts WHERE id=$1',[j.draft_id])).status,'posted');
  assert.deepEqual(x.calls.map(c=>c.method),['initialize','append','finalize','status','status','createPost']);
  assert.equal(x.calls.at(-1).payload.text,j.snapshot.text);
  await assert.rejects(run(j,x));
});
test('同じパスの実バイト差し替え・hash破損は投稿しない',async()=>{
  await enable();
  for(const corrupt of [false,true]) {
    const j=await approve(await draft()),x=createMockXAdapter();
    const broken={async transition(id,action,result){
      const value=await store.transition(id,action,result);
      return action==='claim' && corrupt ? {...value,snapshot_text:'{}'}:value;
    }};
    await assert.rejects(run(j,x,{store:broken,loadMedia:corrupt?loadMedia:async()=>new Uint8Array([5,6,7,8])}),/hash|媒体/);
    assert.equal(x.calls.length,0);
  }
});
test('外部成功後DB失敗・POSTタイムアウト・開始応答喪失は要照合、再送禁止',async()=>{
  await enable();
  for(const failure of ['complete','createPost','begin_post']) {
    const j=await approve(await draft()),x=createMockXAdapter({failAt:failure==='createPost'?'createPost':null});
    const broken={async transition(id,action,result){
      if(action==='complete' && failure==='complete') throw new Error('db_down');
      const value=await store.transition(id,action,result);
      if(action==='begin_post' && failure==='begin_post') throw new Error('db_response_lost');
      return value;
    }};
    await assert.rejects(run(j,x,{store:broken}));
    assert.equal((await first('SELECT state FROM sns_x_send_jobs WHERE id=$1',[j.id])).state,'reconcile');
    await assert.rejects(run(j,x)); await assert.rejects(store.transition(j.id,'fail'),/要照合/);
    await assert.rejects(approve(await first('SELECT * FROM sns_drafts WHERE id=$1',[j.draft_id])),/要照合/);
    assert.equal(x.calls.filter(c=>c.method==='createPost').length,failure==='begin_post'?0:1);
  }
});
test('月額上限と同時claim・予約時刻・停止後の外部呼び出し拒否',async()=>{
  await enable(6000000); const a=await approve(await draft()),b=await approve(await draft());
  const result=await Promise.allSettled([store.transition(a.id,'claim'),store.transition(b.id,'claim')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number((await first('SELECT reserved_microusd FROM sns_x_send_control')).reserved_microusd),6000000);
  await enable(); const future=await approve(await draft());
  await query("UPDATE sns_x_send_jobs SET scheduled_at=now()+interval '1 day' WHERE id=$1",[future.id]);
  await assert.rejects(store.transition(future.id,'claim'),/claim/);
  const j=await approve(await draft()),x=createMockXAdapter();
  const stopped={async transition(id,action,result){
    const value=await store.transition(id,action,result);
    if(action==='claim') await query('UPDATE sns_x_send_control SET paused=true');
    return value;
  }};
  await assert.rejects(run(j,x,{store:stopped}),/停止中/); assert.equal(x.calls.length,0);
});
test('媒体処理失敗・poll上限・worker中断で盲目的再送しない',async()=>{
  await enable();
  for(const state of ['failed','pending']) {
    const j=await approve(await draft()),x=createMockXAdapter({processingStates:[state]});
    await assert.rejects(run(j,x),/媒体処理/); assert.equal(x.calls.some(c=>c.method==='createPost'),false);
    assert(x.calls.filter(c=>c.method==='status').length<=10);
  }
  const j=await approve(await draft()); await store.transition(j.id,'claim'); await store.transition(j.id,'recover');
  await assert.rejects(store.transition(j.id,'claim'));
});
test('v0公開保留・RLS・RPC権限を維持',async()=>{
  const d=await draft(); await query('UPDATE sns_drafts SET publish_blocked=true WHERE id=$1',[d.id]);
  await assert.rejects(approve(d),/承認できません/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(query('SELECT * FROM sns_x_send_jobs'),/permission denied/);
  await assert.rejects(query("SELECT transition_sns_x_send(gen_random_uuid(),'claim')"),/permission denied/);
  await db.exec('RESET ROLE');
});

test('予約取消と手動記録、追加画像のある投稿は部分送信しない',async()=>{
  await enable();const d=await draft(),j=await approve(d);
  await store.transition(j.id,'cancel');
  await assert.rejects(store.transition(j.id,'claim'));
  await query("UPDATE sns_drafts SET status='posted' WHERE id=$1",[d.id]);
  const extra=await draft();
  await query('UPDATE sns_drafts SET source_data=$1 WHERE id=$2',[{dataCardUrl:'https://example.invalid/card.png'},extra.id]);
  await assert.rejects(createXSnapshot({...extra,source_data:{dataCardUrl:'https://example.invalid/card.png'}},loadMedia),/追加画像/);
  await assert.rejects(approve(extra),/承認できません/);
});

test('タグのみ・空タグ混在でも既存コピーの本文と一致',async()=>{
  const d=await draft();
  await query('UPDATE sns_drafts SET caption_text=NULL,hashtags=$1 WHERE id=$2',[[null,'','#龍神レーダー'],d.id]);
  const edited=await first('SELECT * FROM sns_drafts WHERE id=$1',[d.id]);
  assert.equal((await approve(edited)).snapshot.text,'#龍神レーダー');
});
