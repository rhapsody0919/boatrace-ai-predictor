import { test, expect } from '../fixtures.js';
for (const theme of ['light','dark']) test(`${theme}: 375px・端末が米国時間でもJST期限順、失効・承認待ち・失敗`,async({page})=>{
 await page.route('**/*',route=>{
  const url=new URL(route.request().url()); if(url.hostname!=='127.0.0.1') return route.abort();
  if(url.pathname==='/api/admin/sns-hub/deadline-queue') return route.fulfill({json:{data:[
   {id:'later',title:'承認待ちの投稿',channel:'x',state:'pending_review',expires_at:'2099-10-07T04:00:00Z',scheduled_at:'2099-10-07T03:00:00Z'},
   {id:'expired',title:'期限を過ぎた投稿',channel:'x',state:'queued',expires_at:'2000-10-07T04:00:00Z'},
   {id:'failed',title:'動画失敗',channel:'youtube',youtube_mode:'scheduled',state:'failed',expires_at:'2099-10-07T02:00:00Z',error_code:'upload_failed'},
  ]}});
  return route.fallback();
 });
 await page.goto('/__queue_test'); await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await expect(page.getByRole('heading',{name:'投稿待ち行列（JST）'})).toBeVisible();
 const items=page.getByRole('listitem'); await expect(items).toHaveCount(3);
 await expect(items.nth(0)).toContainText('失効（送信不可）'); await expect(items.nth(1)).toContainText('予約公開'); await expect(items.nth(2)).toContainText('承認待ち');
 await expect(items.nth(2)).toContainText('10/07 12:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=375)).toBe(true);
 await page.screenshot({path:`../out/reports/queue-${theme}.png`,fullPage:true});
});

for (const theme of ['light','dark']) test(`${theme}: 非公開残置の動画ID・要照合と手動削除案内`,async({page})=>{
 await page.route('**/*',route=>{
  const url=new URL(route.request().url()); if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/admin/sns-hub/deadline-queue')return route.fulfill({json:{data:[{
   id:'retained',title:'公開しなかった動画',channel:'youtube',state:'reconcile',youtube_stage:'private_retained',external_post_id:'abcdefghijk',error_code:'youtube_private_retained',
  }]}});
  return route.fallback();
 });
 await page.goto('/__queue_test');await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await expect(page.getByRole('listitem')).toContainText('要照合（再送禁止）');
 await expect(page.getByRole('listitem')).toContainText('abcdefghijk');
 await expect(page.getByText(/非公開のまま残置（削除はオーナー操作）/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=375)).toBe(true);
 await page.screenshot({path:`../out/reports/task-10b-qa/retained-${theme}.png`,fullPage:true});
});

// 2026-10-18 オーナー報告: ダークテーマで :root の白文字が一覧に継承され、明るい地の上で読めなかった。
// 一覧の各行の文字色と、実際に下に見える地の色のコントラスト比が 4.5 以上かを見る
const contrastOfListText=page=>page.evaluate(()=>{
 const rgb=v=>v.match(/[\d.]+/g).map(Number);
 const lum=([r,g,b])=>{const c=[r,g,b].map(x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4;});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
 const bgOf=el=>{for(let e=el;e;e=e.parentElement){const c=rgb(getComputedStyle(e).backgroundColor);if(c.length<4||c[3]>0)return c.slice(0,3);}return[255,255,255];};
 return [...document.querySelectorAll('section[aria-label="期限順の投稿一覧"] :is(h2,p)')].map(el=>{
  const a=lum(rgb(getComputedStyle(el).color)),b=lum(bgOf(el));
  return {text:el.textContent.slice(0,30),ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
 });
});
for (const [label,setup] of [
 ['data-theme=light',async page=>page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'))],
 ['data-theme=dark',async page=>page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'))],
 ['OSのダーク設定（data-theme 未設定）',async page=>page.emulateMedia({colorScheme:'dark'})],
]) test(`${label}: 期限順一覧の文字が地の色に対して 4.5:1 以上`,async({page})=>{
 await page.route('**/*',route=>{
  const url=new URL(route.request().url()); if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/admin/sns-hub/deadline-queue')return route.fulfill({json:{data:[
   {id:'pending',title:'滋賀支部のA1比率は、長崎支部の2.2倍',channel:'x',state:'pending_review'},
  ]}});
  return route.fallback();
 });
 await page.goto('/__queue_test'); await setup(page);
 await expect(page.getByRole('listitem')).toContainText('承認待ち');
 const low=(await contrastOfListText(page)).filter(r=>r.ratio<4.5);
 expect(low).toEqual([]);
});
