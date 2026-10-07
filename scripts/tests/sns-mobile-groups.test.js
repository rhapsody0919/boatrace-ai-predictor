import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { xSendStore } from '../../api/_lib/snsXSendStore.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const query = url => new URL(String(url).split('/rest/v1/')[1], 'http://localhost/').searchParams;

test('F04: 今日0件なら履歴を読まず、対象日・必要列をDBクエリで限定する', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    const q = query(url); calls.push(q);
    // 旧実装は全履歴を読み、このfixtureの過去分を返される。
    return Response.json(q.has('source_data->>race_id') ? [] : [{content_group_id:'old',source_data:{race_id:'2020-01-01-01-01'}}]);
  };
  assert.deepEqual(await xSendStore.mobileGroups('2026-10-08'), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get('source_data->>race_id'), 'like.2026-10-08-*');
  assert.equal(calls[0].get('select'), 'content_group_id,race_id:source_data->>race_id');
  assert.equal(calls[0].get('content_group_id'), 'not.is.null');
});
test('F04: 今日の複数ページを欠落させず、同groupをまとめる', async () => {
  const calls=[];
  globalThis.fetch=async url=>{
    const q=query(url);calls.push(q);
    const offset=Number(q.get('offset'));
    return Response.json(offset === 0 ? Array.from({length:500},(_,i)=>({content_group_id:`g${i}`,race_id:'2026-10-08-11-10'})) : [{content_group_id:'g0',race_id:'2026-10-08-11-10'},{content_group_id:'last',race_id:'2026-10-08-12-01'}]);
  };
  const groups=await xSendStore.mobileGroups('2026-10-08');
  assert.equal(groups.length,501);assert.equal(groups.at(-1).id,'last');
  assert.deepEqual(calls.map(q=>q.get('offset')),['0','500']);
});
test('F04: 行数・ページ数上限で部分一覧を返さず失敗する', async () => {
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    // 旧実装も停止できるfixture。無限ループにしない。
    return Response.json(calls <= 5 ? Array.from({length:Number(query(url).get('limit'))},(_,i)=>({content_group_id:`g${calls}-${i}`,race_id:'2026-10-08-11-10',source_data:{race_id:'2026-10-08-11-10'}})) : []);
  };
  await assert.rejects(()=>xSendStore.mobileGroups('2026-10-08'), /取得上限/);
  assert.equal(calls,5);
});
test('F04: 対象日が不正ならクエリを発行しない', async () => {
  globalThis.fetch=async()=>assert.fail('不正日付で通信');
  await assert.rejects(()=>xSendStore.mobileGroups('2026-10-08*'), /対象日/);
});
