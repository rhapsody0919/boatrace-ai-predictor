import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// configureServer内で直接useすると、Viteの内部middleware（SPAフォールバック）より先に登録される。
// createServer後にserver.middlewares.useすると後ろに積まれ、/__x_send_test にも
// アプリ本体のindex.htmlが返ってテストページが表示されない（2026-10-08、初回の実行で判明）。
const harness = {
  name: "sns-x-send-harness",
  configureServer(server) {
    server.middlewares.use("/__x_send_test", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        await server.transformIndexHtml(
          "/__x_send_test",
          `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import XSendPanel from '/src/pages/admin/sns-hub/XSendPanel.jsx';
    import '/src/styles/design-tokens.css';
    import '/src/pages/admin/SnsHubAdmin.css';
    const blocked=new URLSearchParams(location.search).has('blocked');
    function Harness() {
      const [state, setState] = React.useState('unknown');
      return React.createElement(React.Fragment, null, React.createElement(XSendPanel,{
      draft:{id:'11111111-1111-1111-1111-111111111111',status:'approved'},
      approverId:'22222222-2222-2222-2222-222222222222',blocked,onChanged:()=>{},onStateChange:setState
      }), !['unknown','queued','sending','reconcile','posted'].includes(state) && React.createElement('button', null, '手動投稿'));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
  </script></body></html>`,
        ),
      );
    });
  },
};

const server = await createServer({
  configFile: false,
  envDir: false,
  publicDir: false,
  plugins: [react(), harness],
  server: { host: "127.0.0.1", port: 47853, strictPort: true },
});
await server.listen();
