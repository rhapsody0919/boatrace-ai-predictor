import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server = await createServer({ configFile: false, envDir: false, publicDir: false, plugins: [react()],
  server: { host: '127.0.0.1', port: 47854, strictPort: true } });
server.middlewares.use('/__existing_fixes_test', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(await server.transformIndexHtml('/__existing_fixes_test', `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import BlogPrReview from '/src/pages/admin/sns-hub/BlogPrReview.jsx';
    import {actionFeedback} from '/src/pages/admin/sns-hub/actionFeedback.js';
    import '/src/styles/design-tokens.css';
    import '/src/pages/admin/SnsHubAdmin.css';
    function Harness() {
      const [review, setReview] = useState(null);
      return React.createElement('div', {className:'sns-hub-admin-page'},
        React.createElement(BlogPrReview, {draft:{id:'draft',pr_url:'https://github.com/rhapsody0919/boatrace-ai-predictor/pull/1'},review,onReview:setReview}),
        React.createElement('button', {disabled:!review?.confirmed}, '承認してマージ'),
        React.createElement('div', {role:'alert'}, actionFeedback({routine:{fired:false,reason:'設定なし'},riskWarnings:[{id:'risk',matchedPattern:'対象語'}],thumbnailWarning:'権限不足'}).map((text,i)=>React.createElement('p',{key:i},text)))
      );
    }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
  </script></body></html>`));
});
await server.listen();
