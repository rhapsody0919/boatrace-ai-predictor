import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDraft, inspectWithAi } from '../../api/_lib/snsEditAssist.js';

test('読みやすさ・加重文字数・日付時刻・数値出典・敬称を場所付きで指摘する', () => {
  const findings = inspectDraft({ platform:'x', title:'田中太郎', caption_text:'件数：99。2026-02-30 25:70。'+'あ'.repeat(150),
    source_data:{bundle:{claims:[{source:'facts',path:['count'],label:'件数',value:30,count:30,scope:'当日'}],source_data:{facts:{count:31},racers:[{name:'田中太郎'}]}}} }, []);
  for(const code of ['sentence-length','x-weighted-length','date-format','time-format','claim-source-mismatch','claim-text-mismatch','racer-honorific']) assert.ok(findings.some(f=>f.rule===code), code);
  assert.ok(findings.every(f=>f.location && f.content && f.reason && f.suggestion));
});
test('AI差し込み口は既定無効で、明示設定時だけモックを呼ぶ', async () => {
  let calls=0; const messages=async()=>{calls++;return {content:[{type:'text',text:JSON.stringify([{location:'caption_text',content:'長い',reason:'読みにくい',suggestion:'分ける'}])}]};};
  assert.deepEqual(await inspectWithAi({}, {messages}), []); assert.equal(calls,0);
  assert.equal((await inspectWithAi({}, {enabled:true,model:'mock',messages})).length,1); assert.equal(calls,1);
});

test('正常な本文・URL/絵文字・タグ例外・媒体別ルール・ラベルのない数値は誤検知しない', () => {
  const rule=[{id:'platform',platforms:['youtube'],patterns:['VS'],description:'rule'}];
  const d={platform:'x',title:'田中太郎選手',caption_text:'件数：30。2026-10-08 09:05。VS 1R https://example.com/'+ 'a'.repeat(300)+' 😀',hashtags:['#ボートレース'],
    source_data:{racers:[{name:'田中太郎'}],bundle:{claims:[{source:'facts',path:['count'],label:'件数',value:30,count:30,scope:'当日'}],source_data:{facts:{count:30}}}}};
  const findings=inspectDraft(d,rule);
  // URL自体は長い文の助言対象だが、Xでは短縮URLとして加重計算する。
  assert.ok(!findings.some(f=>['x-weighted-length','platform','racer-honorific','date-format','time-format','claim-text-mismatch','claim-source-mismatch'].includes(f.rule)));
  assert.ok(inspectDraft({...d,platform:'youtube'},rule).some(f=>f.rule==='platform'));
  assert.deepEqual(inspectDraft({platform:'x',caption_text:'確認します。'},[]),[]);
});
test('AI無効は接続せず、不正応答・未接続・モック障害を成功扱いしない', async () => {
  await assert.rejects(()=>inspectWithAi({}, {enabled:true,model:'mock'}),/未接続/);
  for(const text of ['null','{"approved":true}','[{"location":"x"}]'])
    await assert.rejects(()=>inspectWithAi({}, {enabled:true,model:'mock',messages:async()=>({content:[{type:'text',text}]})}));
  await assert.rejects(()=>inspectWithAi({}, {enabled:true,model:'mock',messages:async()=>{throw new Error('mock failure');}}),/mock failure/);
});

test('保存原文は実バイトのhashを照合し、不足・改変・取得失敗を未照合として返す', async () => {
  const { readInspectionSources, saveDraftInspection }=await import('../../api/_lib/snsEditAssist.js');
  const { sha256 }=await import('../../api/_lib/snsXSend.js');
  const bytes=new TextEncoder().encode('{"count":31}');
  const d={id:'draft',platform:'x',caption_text:'件数：30',source_data:{bundle:{claims:[{source:'facts',path:['count'],label:'件数',value:30,count:30,scope:'当日'}]},source_manifest:[{name:'facts.json',storage_path:'local/facts.json',sha256:await sha256(bytes)}]}};
  const raw=await readInspectionSources(d,async()=>bytes);
  assert.deepEqual(raw,{facts:{count:31}});
  assert.ok(inspectDraft(d,[],raw).some(f=>f.rule==='claim-source-mismatch'));
  assert.deepEqual(await readInspectionSources(d,async()=>new Uint8Array([1])),{});
  assert.deepEqual(await readInspectionSources(d,async()=>{throw new Error('offline');}),{});
  const calls=[]; const store={saveInspection:async(...args)=>{calls.push(args);return {findings:args[3]};}};
  await saveDraftInspection({draft:d,revision:'r'},[],store,async()=>bytes);
  await saveDraftInspection({draft:d,revision:'r'},[],store,async()=>{throw new Error('offline');});
  assert.notEqual(calls[0][2],calls[1][2]);
  assert.equal(d.caption_text,'件数：30');
});

test('管理APIは指摘を保存し、保存障害を表示し、判断の認証・版・actionを検査する', async () => {
  const fs=await import('node:fs/promises');
  let text=await fs.readFile(new URL('../../api/admin/sns-hub/mobile-approval.js',import.meta.url),'utf8');
  const state={denied:null,saveError:false,decisions:0,saves:0};
  globalThis.__editApiTest=state;
  const mock='data:text/javascript,'+encodeURIComponent(`
    export const requireAdminAuth=async()=>globalThis.__editApiTest.denied;
    export const isConfigured=()=>true;
    export const isValidUuid=v=>typeof v==='string' && v.length>0;
    export const jsonResponse=(v,status=200)=>new Response(JSON.stringify(v),{status});
    export const signStoragePaths=async()=>({});
    export const loadXMedia=async()=>new Uint8Array([1]);
    export const xSendStore={mobileRace:async()=>[{draft:{id:'draft',caption_text:'本文'},revision:'revision'}],
      decideFinding:async()=>{globalThis.__editApiTest.decisions++;return {id:'inspection'};}};
    export const prepareMobileReview=async()=>({versionHash:'version',holds:[]});
    export const approveMobileReview=async()=>({approved:true});
    export const saveDraftInspection=async()=>{globalThis.__editApiTest.saves++;if(globalThis.__editApiTest.saveError)throw new Error('offline');return {id:'inspection',findings:[]};};
  `);
  text=text.replace(/from '[^'\n]+(?:adminAuth|snsHubHelpers|snsXSendStore|snsMobileApproval|snsEditAssist)\.js'/g,`from ${JSON.stringify(mock)}`)
    .replace(/import riskRules from [^;]+;/,`const riskRules={rules:[]};`);
  const handler=(await import('data:text/javascript,'+encodeURIComponent(text))).default;
  const get=()=>handler(new Request('http://local/mobile?group=group'));
  const post=body=>handler(new Request('http://local/mobile?group=group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  assert.equal((await (await get()).json()).data[0].inspection.id,'inspection');
  state.saveError=true;
  const failed=(await (await get()).json()).data[0];assert.ok(failed.inspectionError);assert.deepEqual(failed.holds,[]);
  const body={action:'edit-decision',draftId:'draft',approverId:'owner',inspectionId:'inspection',findingId:'finding',decision:'ignored',versionHash:'version'};
  assert.equal((await post(body)).status,200);assert.equal(state.decisions,1);
  assert.equal((await post({...body,versionHash:'old'})).status,409);
  assert.equal((await post({...body,decision:'other'})).status,400);
  assert.equal((await post({...body,action:'other'})).status,400);assert.equal(state.decisions,1);
  state.denied=new Response('denied',{status:401});assert.equal((await get()).status,401);assert.equal((await post(body)).status,401);
  delete globalThis.__editApiTest;
});

 test('F01: 実APIの原文読込経路でもbundle名簿の敬称を点検する', async () => {
  const { saveDraftInspection }=await import('../../api/_lib/snsEditAssist.js');
  const { sha256 }=await import('../../api/_lib/snsXSend.js');
  const bytes=new TextEncoder().encode('{"count":30}');
  const draft={id:'draft',platform:'x',caption_text:'田中太郎の展示を確認',source_data:{
    bundle:{claims:[{source:'facts',path:['count'],value:30,label:'件数',count:30,scope:'当日'}],source_data:{racers:[{name:'田中太郎'}]}},
    source_manifest:[{name:'facts.json',storage_path:'local/facts.json',sha256:await sha256(bytes)}]}};
  const store={saveInspection:async(id,revision,engine,findings)=>({findings})};
  const {findings}=await saveDraftInspection({draft,revision:'r'},[],store,async path=>{assert.equal(path,'local/facts.json');return bytes;});
  assert.deepEqual(findings.map(f=>f.rule),['racer-honorific']);
  assert.equal(findings[0].location,'caption_text:0');
  assert.equal(draft.caption_text,'田中太郎の展示を確認');
 });
 test('名簿は全参照先を合併し同名の指摘を重複させない', () => {
  const draft={platform:'x',caption_text:'田中太郎と佐藤次郎と山田三郎',source_data:{racers:[{name:'田中太郎'}],bundle:{source_data:{racers:[{name:'田中太郎'},{name:'佐藤次郎'}]}}}};
  assert.deepEqual(inspectDraft(draft,[],{racers:[{name:'山田三郎'}]}).map(f=>f.content),['田中太郎','山田三郎','佐藤次郎']);
 });
