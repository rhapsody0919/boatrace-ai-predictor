import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,envDir:false,publicDir:false,plugins:[react()],server:{host:'127.0.0.1',port:47853,strictPort:true}});
server.middlewares.use('/__x_send_test',async (_req,res)=>{
  res.setHeader('Content-Type','text/html');
  res.end(await server.transformIndexHtml('/__x_send_test', `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import XSendPanel from '/src/pages/admin/sns-hub/XSendPanel.jsx';
    import '/src/styles/design-tokens.css';
    import '/src/pages/admin/SnsHubAdmin.css';
    const blocked=new URLSearchParams(location.search).has('blocked');
    createRoot(document.getElementById('root')).render(React.createElement(XSendPanel,{
      draft:{id:'11111111-1111-1111-1111-111111111111',status:'pending_review'},
      approverId:'22222222-2222-2222-2222-222222222222',blocked,onChanged:()=>{}
    }));
  </script></body></html>`));
});
await server.listen();
