import { test,expect } from '@playwright/test';
let status;
let sent;
test.beforeEach(async({page})=>{
  status={connected:false,job:null,control:{paused:true,budget_microusd:10000000,reserved_microusd:300000}};
  sent=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1') return route.abort();
    if(url.pathname.startsWith('/api/')) {
      if(route.request().method()==='POST') {
        sent.push({path:url.pathname,body:route.request().postDataJSON()});
        if(url.pathname.endsWith('x-send-stop')) status.control.paused=true;
        else status.job={state:'queued',scheduled_at:sent.at(-1).body.scheduledAt};
      }
      return route.fulfill({json:{data:status}});
    }
    return route.continue();
  });
});
for(const theme of ['light','dark']) {
  test(`${theme}: 未接続表示・停止操作・予約承認・公開不可`,async({page})=>{
    await page.goto('/__x_send_test');
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    await expect(page.getByText('接続準備中。公開・予約送信はまだ利用できません。')).toBeVisible();
    await expect(page.getByRole('button',{name:'承認して公開',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'X送信を停止'}).click();
    expect(sent[0].path).toContain('x-send-stop');
    status.connected=true;status.control.paused=false;
    await page.reload();
    await page.getByLabel('X予約日時').fill('2099-10-07T12:30');
    await page.getByRole('button',{name:'承認して予約',exact:true}).click();
    await expect(page.getByText('X送信: 予約・待機中')).toBeVisible();
    expect(sent.at(-1).body.approverId).toBe('22222222-2222-2222-2222-222222222222');
    expect(sent.at(-1).body.scheduledAt).toContain('2099-10-07');
    await page.goto('/__x_send_test?blocked');
    await expect(page.getByRole('button',{name:'承認して公開',exact:true})).toBeDisabled();
  });
  test(`${theme}: 要照合で再送不可`,async({page})=>{
    status.connected=true;status.control.paused=false;status.job={state:'reconcile'};
    await page.goto('/__x_send_test');
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    await expect(page.getByText('X送信: 要照合（再送禁止）')).toBeVisible();
    await expect(page.getByRole('button',{name:'承認して公開',exact:true})).toBeDisabled();
    await expect(page.getByText('手動投稿も照合が済むまで停止してください。')).toBeVisible();
    await page.screenshot({path:`../out/reports/2026-10-07-task-03-qa/${theme}-reconcile.png`});
  });
}
