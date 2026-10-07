import { test, expect } from '@playwright/test';
for (const theme of ['light','dark']) test(`${theme}: 375px・端末が米国時間でもJST期限順、失効・承認待ち・失敗`,async({page})=>{
 await page.route('**/*',route=>{
  const url=new URL(route.request().url()); if(url.hostname!=='127.0.0.1') return route.abort();
  if(url.pathname==='/api/admin/sns-hub/deadline-queue') return route.fulfill({json:{data:[
   {id:'later',title:'承認待ちの投稿',channel:'x',state:'pending_review',expires_at:'2099-10-07T04:00:00Z',scheduled_at:'2099-10-07T03:00:00Z'},
   {id:'expired',title:'期限を過ぎた投稿',channel:'x',state:'queued',expires_at:'2000-10-07T04:00:00Z'},
   {id:'failed',title:'動画失敗',channel:'youtube',youtube_mode:'scheduled',state:'failed',expires_at:'2099-10-07T02:00:00Z',error_code:'upload_failed'},
  ]}});
  return route.continue();
 });
 await page.goto('/__queue_test'); await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await expect(page.getByRole('heading',{name:'投稿待ち行列（JST）'})).toBeVisible();
 const items=page.getByRole('listitem'); await expect(items).toHaveCount(3);
 await expect(items.nth(0)).toContainText('失効（送信不可）'); await expect(items.nth(1)).toContainText('予約公開'); await expect(items.nth(2)).toContainText('承認待ち');
 await expect(items.nth(2)).toContainText('10/07 12:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=375)).toBe(true);
 await page.screenshot({path:`../out/reports/queue-${theme}.png`,fullPage:true});
});
