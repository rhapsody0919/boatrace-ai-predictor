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
