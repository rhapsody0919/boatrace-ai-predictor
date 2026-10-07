import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const group='group1';
const row=platform=>({draft:{id:platform,title:'準優勝戦の展示データを確認',platform,status:'pending_review',caption_text:'12件の展示データで確認した傾向。ボートレースの画面から出典を確認します。',risk_flags:[],source_data:{race_id:'2026-10-07-11-10',stage:'exhibition',bundle:{claims:[{source:'layer',path:['entries','count'],value:12,count:12,scope:'当日の出走選手'}]},source_manifest:[{name:'layer.json',stage:'exhibition',fetched_at:'2026-10-07T01:00:00Z',source_url:'https://example.com/source'}],qa:{pass:false},deadline_queue:{expires_at:'2026-10-07T07:00:00Z'}}},holds:['QA未確認・失敗','正式公開証拠なし'],versionHash:'a'.repeat(64),videoUrl:null,job:null});
for(const theme of ['light','dark']) test(`375pxの同一画面で本文・根拠・個別承認・保留 (${theme})`,async({page})=>{
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='127.0.0.1')return route.abort();
  if(u.pathname==='/api/admin/sns-hub/mobile-approval')return route.fulfill({json:u.searchParams.has('group')?{data:[row('youtube'),row('x')],connected:false}:{data:[{id:group,raceId:'2026-10-07-11-10'}],connected:false}});
  return route.continue();
 });
 await page.goto('/__mobile_test');await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await page.getByLabel('レース',{exact:true}).selectOption(group);
 await expect(page.getByText('YouTube Shorts：準優勝戦の展示データを確認')).toBeVisible();await expect(page.getByText('X：準優勝戦の展示データを確認')).toBeVisible();
 await expect(page.getByText('出典パス：layer/entries/count')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'この版のShortsだけ承認'})).toBeDisabled();await expect(page.getByRole('button',{name:'この版のXだけ承認'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=375)).toBe(true);
 await mkdir('../out/reports/2026-10-07-task-06-qa',{recursive:true});
 await page.screenshot({path:`../out/reports/2026-10-07-task-06-qa/mobile-${theme}.png`,fullPage:true});
});

const readyRow = () => ({...row('x'), holds:[], draft:{...row('x').draft,status:'approved',language:'ja',format:'short',content_group_id:group,caption_text:'修正前の本文',created_at:'2026-10-08T00:00:00Z'}});
async function setup(page, getRow, overrides = () => null) {
 await page.route('**/*', async route => {
  const u=new URL(route.request().url());
  if(u.hostname!=='127.0.0.1') return route.abort();
  if(await overrides(route,u)) return;
  if(u.pathname==='/api/admin/sns-hub/mobile-approval') return route.fulfill({json:u.searchParams.has('group')?{data:[getRow()]}:{data:[{id:group,raceId:'2026-10-08-11-10'}]}});
  if(u.pathname==='/api/admin/sns-hub/drafts') return route.fulfill({json:{data:[getRow().draft]}});
  if(u.pathname.endsWith('/x-send')) return route.fulfill({json:{data:{connected:false,job:null,control:{paused:true}}}});
  if(u.pathname==='/api/admin/sns-hub/approvers') return route.fulfill({json:{data:[{id:'owner',display_name:'本人'}]}});
  if(u.pathname.startsWith('/api/')) return route.fulfill({json:{data:[]}});
  return route.continue();
 });
}
async function selectRace(page) {
 await page.getByLabel('レース',{exact:true}).selectOption(group);
 await page.locator('.sns-mobile-race').getByLabel('承認者',{exact:true}).selectOption('owner');
}
for (const outcome of ['success','post-lost','race-get-failed','409']) test(`F01: ${outcome}でも既存カードを同期し、古いpollを拒否する`, async ({page}) => {
 let current=readyRow(), post=false, failed=false, draftReads=0;
 let releasePoll, pollStarted, releasePost, postStarted;
 const pollGate=new Promise(resolve=>{releasePoll=resolve;});
 const pollStart=new Promise(resolve=>{pollStarted=resolve;});
 const postGate=new Promise(resolve=>{releasePost=resolve;});
 const postStart=new Promise(resolve=>{postStarted=resolve;});
 let holdPoll=false;
 await setup(page,()=>current,async(route,u)=>{
  if(u.pathname==='/api/admin/sns-hub/drafts') {
   draftReads++;
   // 後続GET失敗時は親一覧も失敗させる。
   if(failed && outcome==='race-get-failed') {await route.fulfill({status:503,json:{error:'一覧取得失敗'}});return true;}
  }
  if(u.pathname.endsWith('/x-send')) {
   if(holdPoll && !post) {holdPoll=false;pollStarted();await pollGate;await route.fulfill({json:{data:{connected:false,job:null,control:{paused:true}}}});return true;}
   if(post && failed && outcome!=='success') {await route.fulfill({status:503,json:{error:'状態取得失敗'}});return true;}
   if(post) {await route.fulfill({json:{data:{connected:false,job:{state:'queued'},control:{paused:true}}}});return true;}
  }
  if(u.pathname==='/api/admin/sns-hub/mobile-approval' && route.request().method()==='POST') {
   post=true;current={...current,job:{state:'queued'},draft:{...current.draft,caption_text:'修正後の本文'}};postStarted();await postGate;failed=true;
   if(outcome==='post-lost') await route.abort();
   else await route.fulfill({status:outcome==='409'?409:200,json:outcome==='409'?{error:'確認した版が変わりました'}:{data:{state:'queued'}}});
   return true;
  }
  if(post && failed && outcome==='race-get-failed' && u.pathname==='/api/admin/sns-hub/mobile-approval' && u.searchParams.has('group')) {await route.fulfill({status:503,json:{error:'レース取得失敗'}});return true;}
  return false;
 });
 await page.clock.install();await page.goto('/__mobile_test?admin');
 await page.locator('.sns-hub-tab-btn').filter({hasText:/^X \(/}).click();
 await page.locator('.status-filter-btn').filter({hasText:'投稿準備完了'}).click();
 const card=page.locator('.draft-card');
 if(await card.getByRole('button',{name:'▼ 詳細・操作を見る',exact:true}).count()) await card.getByRole('button',{name:'▼ 詳細・操作を見る',exact:true}).click();
 const manual=card.getByRole('link',{name:'Xを開く',exact:true});
 await expect(manual).toBeVisible();await selectRace(page);
 holdPoll=true;await page.clock.fastForward(10000);await pollStart;
 await page.getByRole('button',{name:'この版のXだけ承認',exact:true}).click();await postStart;
 await expect(manual).toHaveCount(0);
 releasePoll();await expect(manual).toHaveCount(0);
 releasePost();
 if(outcome==='success') await expect(card.getByText('修正後の本文',{exact:true})).toBeVisible();
 else await expect(page.getByRole('alert').first()).toBeVisible();
 await expect.poll(()=>draftReads).toBeGreaterThan(1);
 await expect(manual).toHaveCount(0);
 if(outcome==='success') await expect(card.getByText('X送信: 予約・待機中',{exact:true})).toBeVisible();
});
test('F02: 修正依頼のroutine.fired=falseをGET成功後も警告表示する',async({page})=>{
 const current={...readyRow(),draft:{...readyRow().draft,status:'pending_review'}};
 await setup(page,()=>current,async(route,u)=>{
  if(u.pathname.endsWith('/redo')) {current.draft.status='revision_requested';await route.fulfill({json:{data:current.draft,routine:{fired:false,reason:'未設定'}}});return true;}
  return false;
 });
 await page.goto('/__mobile_test');await selectRace(page);
 await page.getByLabel('修正理由',{exact:true}).fill('出典を直してください');
 await page.getByRole('button',{name:'この投稿の修正を依頼',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('修正処理を起動できませんでした');
 await expect(page.getByRole('button',{name:'この投稿の修正を依頼',exact:true})).toBeDisabled();
});
for(const type of ['video','image']) test(`F05: Xの${type}添付を表示し、欠落・読込失敗で承認を閉じる`,async({page})=>{
 let current=readyRow();const path=type==='video'?'x/only.mp4':'x/only.png';
 current.draft={...current.draft,[type==='video'?'video_storage_path':'cover_image_path']:path};
 await setup(page,()=>current);
 await page.goto('/__mobile_test');await selectRace(page);
 const approve=page.getByRole('button',{name:'この版のXだけ承認',exact:true});
 await expect(approve).toBeDisabled();
 current={...current,versionHash:'b'.repeat(64),[type==='video'?'videoUrl':'imageUrl']:`http://127.0.0.1/mock.${type==='video'?'mp4':'png'}`};
 await page.getByLabel('レース',{exact:true}).selectOption('');await selectRace(page);
 const media=type==='video'?page.getByLabel('X添付動画',{exact:true}):page.getByAltText('X添付画像',{exact:true});
 await expect(media).toHaveCount(1);await expect(media).toHaveAttribute('src',current[type==='video'?'videoUrl':'imageUrl']);
 // 合成イベントは読込ハンドラの検証だけ。実動画再生の証拠にはしない。
 await media.dispatchEvent(type==='video'?'loadeddata':'load');await expect(approve).toBeEnabled();
 await media.dispatchEvent('error');await expect(approve).toBeDisabled();
});
test('F05: X本文のみは媒体プレビューを要求しない',async({page})=>{
 await setup(page,readyRow);await page.goto('/__mobile_test');await selectRace(page);
 await expect(page.getByRole('button',{name:'この版のXだけ承認',exact:true})).toBeEnabled();
});
