import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,envDir:false,publicDir:false,plugins:[react()],server:{host:'127.0.0.1',port:47856,strictPort:true}});
server.middlewares.use('/__mobile_test',async(_req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end(await server.transformIndexHtml('/__mobile_test',`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import MobileApprovalPanel from '/src/pages/admin/sns-hub/MobileApprovalPanel.jsx';
 import SnsHubAdmin from '/src/pages/admin/SnsHubAdmin.jsx'; import {MemoryRouter} from 'react-router-dom';
 import '/src/styles/design-tokens.css'; import '/src/pages/admin/SnsHubAdmin.css';
 const content=new URLSearchParams(location.search).has('admin') ? React.createElement(MemoryRouter,null,React.createElement(SnsHubAdmin)) : React.createElement(MobileApprovalPanel,{approvers:[{id:'owner',display_name:'本人'}]});
 createRoot(document.getElementById('root')).render(content);
 </script></body></html>`));
});
await server.listen();
