import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,appType:'custom',envDir:false,publicDir:false,plugins:[react()],server:{host:'127.0.0.1',port:47854,strictPort:true}});
server.middlewares.use('/__queue_test',async(_req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end(await server.transformIndexHtml('/__queue_test',`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import DeadlineQueuePanel from '/src/pages/admin/sns-hub/DeadlineQueuePanel.jsx';
 import '/src/styles/design-tokens.css'; import '/src/pages/admin/SnsHubAdmin.css';
 createRoot(document.getElementById('root')).render(React.createElement(DeadlineQueuePanel));
 </script></body></html>`));
});
await server.listen();
