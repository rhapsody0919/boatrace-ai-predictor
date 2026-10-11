import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getDrafts } from '../../src/services/snsHubService.js';
import { completedResponse } from '../../api/_lib/snsExternalOperations.js';
import { actionFeedback } from '../../src/pages/admin/sns-hub/actionFeedback.js';

// API失敗・通信拒否・成功応答内の警告に内部詳細を注入する。実通信はしない。
const detail = 'internal SQL exception / private upstream detail';
const originalFetch = globalThis.fetch;
try {
  for (const status of [400, 409, 500, 502]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: detail }), { status });
    await assert.rejects(getDrafts, error => {
      assert(!error.message.includes(detail));
      assert(error.message.includes('確認'));
      return true;
    });
  }
  globalThis.fetch = async () => { throw new Error(detail); };
  await assert.rejects(getDrafts, error => !error.message.includes(detail) && error.message.includes("確認"));
  const feedback = actionFeedback({ routine: { fired: false, reason: detail }, thumbnailWarning: detail });
  assert.equal(feedback.length, 2);
  assert(feedback.every(message => !message.includes(detail)));
  assert.deepEqual(actionFeedback({ thumbnailWarning: 'unconfirmed' }), ['サムネイルの設定結果を確認できていません。YouTube Studio で確認してください。']);
  assert.deepEqual(actionFeedback({ thumbnailWarning: 'failed' }), ['サムネイルを設定できませんでした。']);
} finally {
  globalThis.fetch = originalFetch;
}

for (const warning of ['unconfirmed', 'サムネイル設定結果は未確認です', 'failed', detail]) {
  const response = completedResponse({ external_operation_result: { thumbnailWarning: warning } });
  assert.equal(response.thumbnailWarning, ['unconfirmed', 'サムネイル設定結果は未確認です'].includes(warning) ? 'unconfirmed' : 'failed');
}

// 実際のGET handlerでDB例外を注入。import先だけモックに置換する。
const url = new URL('../../api/admin/sns-hub/approvers/index.js', import.meta.url);
let source = await fs.readFile(url, 'utf8');
const mock = 'data:text/javascript,' + encodeURIComponent(`
export const requireAdminAuth=async()=>null;
export const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status});
export const isConfigured=()=>true;
export const supabaseRequest=async()=>{throw new Error(${JSON.stringify(detail)})};
`);
source = source.replace(/^const SUPABASE_.*$/gm, line => line.includes('URL') ? 'const SUPABASE_URL = "https://local.invalid";' : 'const SUPABASE_SERVICE_KEY = "local-placeholder";');
source = source.replace(/from ["'][^"']+\.js["']/g, `from ${JSON.stringify(mock)}`);
const handler = (await import('data:text/javascript,' + encodeURIComponent(source))).default;
const logs = [];
globalThis.fetch = async () => { throw new Error(detail); };
const originalError = console.error;
console.error = (...args) => logs.push(args);
try {
  const response = await handler(new Request('https://local.invalid/approvers'));
  assert.equal(response.status, 500);
  assert(!(await response.text()).includes(detail));
  assert(logs.some(args => args.some(arg => arg instanceof Error && arg.message === detail)));
} finally {
  console.error = originalError;
  globalThis.fetch = originalFetch;
}

async function walk(url) {
  for (const entry of await fs.readdir(url, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
    if (entry.isDirectory()) await walk(child);
    else if (/\.(js|jsx)$/.test(entry.name)) {
      const text = await fs.readFile(child, 'utf8');
      assert(!/error:\s*\w+\.message|setError\([^\n]*(?:\.message|errorMessageOf)|thumbnailError\s*=\s*\w+\.message/.test(text), child.pathname);
    }
  }
}
await walk(new URL('../../api/admin/sns-hub/', import.meta.url));
await walk(new URL('../../src/pages/admin/sns-hub/', import.meta.url));
console.log('SNS raw errors: API exception/log, service failures, success warnings and source guards passed');
