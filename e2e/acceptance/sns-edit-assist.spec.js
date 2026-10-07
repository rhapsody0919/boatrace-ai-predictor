import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
for(const theme of ['light','dark']) test(`375px 編集指摘の判断・承認継続 (${theme})`,async({page})=>{
 let decision=null,approved=false;
 const row=()=>({draft:{id:'draft',title:'展示データを確認',platform:'x',status:'pending_review',caption_text:'件数：30。出典を確認します。',risk_flags:[],source_data:{}},holds:[],versionHash:'v',inspection:{id:'inspection',decisions:decision?{'f':decision}:{},findings:[{id:'f',location:'caption_text',content:'対象範囲が未記載',reason:'読者が確認できません。',suggestion:'対象期間を記載してください。'}]}});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='127.0.0.1')return route.abort();
  if(u.pathname==='/api/admin/sns-hub/mobile-approval') {
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      if(body.action==='edit-decision')decision=body.decision;else approved=true;
      return route.fulfill({json:{data:{}}});
    }
    return route.fulfill({json:{data:u.searchParams.has('group')?[row()]:[{id:'group',raceId:'2026-10-08-11-10'}]}});
  }
  return route.continue();
 });
 await page.goto('/__mobile_test');await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await page.getByLabel('レース',{exact:true}).selectOption('group');
 await page.getByLabel('承認者',{exact:true}).selectOption('owner');
 await expect(page.getByRole('button',{name:'この版のXだけ承認'})).toBeEnabled();
 await page.getByRole('button',{name:'この指摘を採用'}).click();await expect(page.getByText('判断：採用')).toBeVisible();
 await page.getByRole('button',{name:'この指摘を無視'}).click();await expect(page.getByText('判断：無視')).toBeVisible();
 await expect(page.getByText('件数：30。出典を確認します。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=375)).toBe(true);
 await mkdir('../out/reports/2026-10-08-task-08-qa',{recursive:true});
 await page.screenshot({path:`../out/reports/2026-10-08-task-08-qa/edit-${theme}.png`,fullPage:true});
 await page.getByRole('button',{name:'この版のXだけ承認'}).click();await expect.poll(()=>approved).toBe(true);
});
