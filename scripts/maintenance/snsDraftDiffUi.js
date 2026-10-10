/** --uiのみ。env読込なし・外部通信遮断・専用経路をSPAより前に登録。 */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const server=await createServer({configFile:false,envDir:false,publicDir:false,appType:'custom',plugins:[react()],server:{host:'127.0.0.1',port:47858,strictPort:true}});
server.middlewares.use('/__draft_diff_test',async(_req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end(await server.transformIndexHtml('/__draft_diff_test',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from 'react'; import {createRoot} from 'react-dom/client'; import {DraftDiffView} from '/src/pages/admin/sns-hub/DraftDiffPanel.jsx';
 import '/src/styles/design-tokens.css';
 const old={content:{title:'タイトル',caption_text:'件数30を確認',hashtags:['#龍神レーダー'],source_data:{n:30},video_storage_path:'video.mp4'},media:{video:{path:'video.mp4',sha256:'a'.repeat(64)}}};
 const current={content:{...old.content,title:'新しいタイトル',caption_text:'件数31を確認',source_data:{n:31}},media:{video:{path:'video.mp4',sha256:'b'.repeat(64)}}};
 function Harness(){const [baseline,setBaseline]=React.useState('previous');return React.createElement(DraftDiffView,{data:{previous:old,approved:null,current},baseline,onBaseline:setBaseline});}
 createRoot(document.getElementById('root')).render(React.createElement(Harness));
 </script></body></html>`));
});
let browser;
try {
 await server.listen();
 browser=await chromium.launch();
 const output=await mkdtemp(path.join(tmpdir(),'sns-draft-diff-ui-'));
 for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width:375,height:900}});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:47858/__draft_diff_test');
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  await page.getByText('差し替え（ファイル hash 変更）',{exact:true}).waitFor();
  assert(await page.locator('del').count()>0);
  assert(await page.locator('ins').count()>0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=375),'375pxで横スクロールなし');
  await page.screenshot({path:path.join(output,`${theme}.png`),fullPage:true});
  await page.getByLabel('比較する版').selectOption('approved');
  await page.getByText('保存された承認版がありません。',{exact:true}).waitFor();
  await page.close();
 }
 console.log(`UI screenshots: ${output}`);
} finally {await browser?.close();await server.close();}
