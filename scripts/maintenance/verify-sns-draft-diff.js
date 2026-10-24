import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { draftContent, characterDiff, numericDiff, compareDraftSnapshots } from '../../src/utils/snsDraftDiff.js';

// 仕様: sns-hub-draft-diff/contract.md、関数コメント、BOA-1083。
// 未定義・不一致の入力は合格条件にせず、実行時の値を末尾に表示する。
const KNOWN_GAPS = [
  { input: 'numericDiff(0, -0)', specification: '未定（符号付きゼロの扱い）', actual: () => numericDiff(0, -0) },
  { input: 'draftContent({}).source_data', specification: 'BOA-1083: 無い値は null', actual: () => draftContent({}).source_data },
  { input: 'characterDiff: 共通部分除去後の積が1000000',
    specification: 'contract.md: 100万以上は削除/追加。BOA-1083: 100万を超えるとき',
    actual: () => characterDiff('a'.repeat(499) + 'b' + 'a'.repeat(500), 'c'.repeat(499) + 'b' + 'c'.repeat(500))
      .map(({ kind, text }) => ({ kind, length: Array.from(text).length })) },
];
let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message.replaceAll('\n', ' ')}`);
  }
}
const part = (kind, text) => ({ kind, text });
const snapshot = (content = {}, media) => ({ content, media });

test('characterDiff: 置換・追加・削除・同一・null の値', () => {
  assert.deepEqual(characterDiff('abc', 'axc'), [part('same', 'a'), part('removed', 'b'), part('added', 'x'), part('same', 'c')]);
  assert.deepEqual(characterDiff('', 'ab'), [part('added', 'ab')]);
  assert.deepEqual(characterDiff('ab', ''), [part('removed', 'ab')]);
  assert.deepEqual(characterDiff('abc', 'abc'), [part('same', 'abc')]);
  assert.deepEqual(characterDiff(null, null), []);
});
test('characterDiff: Unicode コードポイント', () => {
  assert.deepEqual(characterDiff('😀a', '😀b'), [part('same', '😀'), part('removed', 'a'), part('added', 'b')]);
  assert.deepEqual(characterDiff('a😀z', 'a😁z'), [part('same', 'a'), part('removed', '😀'), part('added', '😁'), part('same', 'z')]);
});
test('characterDiff: LCS の内部共通文字を残す', () => {
  assert.deepEqual(characterDiff('abc', 'xbz'), [part('removed', 'a'), part('added', 'x'), part('same', 'b'), part('removed', 'c'), part('added', 'z')]);
});
test('characterDiff: 長文の変更範囲と共通前後', () => {
  assert.deepEqual(characterDiff('x' + 'a'.repeat(1001) + 'y', 'x' + 'c'.repeat(1000) + 'z')
    .map(({ kind, text }) => [kind, text.length]), [['same', 1], ['removed', 1002], ['added', 1001]]);
  const before = 'x' + 'a'.repeat(500) + 'b' + 'a'.repeat(500) + 'y';
  const after = 'x' + 'c'.repeat(500) + 'b' + 'c'.repeat(500) + 'y';
  assert.deepEqual(characterDiff(before, after), [part('same', 'x'), part('removed', before.slice(1, -1)), part('added', after.slice(1, -1)), part('same', 'y')]);
});
for (const [index, [before, after]] of [
  ['', ''], ['abc', 'axc'], ['ababa', 'babab'], ['abc', ''], ['', '日本語'],
  ['😀ab🚤', '😁ba🚤'], ['prefix abc suffix', 'prefix cba suffix'],
  ['x' + 'a'.repeat(1001) + 'y', 'x' + 'c'.repeat(1000) + 'z'],
].entries()) {
  test(`characterDiff: 復元・結合・非空 ${index + 1}`, () => {
    const parts = characterDiff(before, after);
    assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), before);
    assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), after);
    parts.forEach((p, i) => {
      assert.ok(['same', 'removed', 'added'].includes(p.kind));
      assert.ok(p.text.length > 0);
      assert.notEqual(p.kind, parts[i - 1]?.kind);
    });
  });
}
test('numericDiff: 入れ子・JSON Pointer・キー順', () => {
  assert.deepEqual(numericDiff({ a: 1, b: { c: 2 }, 'x/y': 3 }, { a: 1, b: { c: 5 }, 'x/y': 4 }), [
    { path: '/b/c', before: 2, after: 5 }, { path: '/x~1y', before: 3, after: 4 },
  ]);
  assert.deepEqual(numericDiff({ z: 1, '~/': 2, a: [3] }, { z: 4, '~/': 5, a: [6] }), [
    { path: '/a/0', before: 3, after: 6 }, { path: '/z', before: 1, after: 4 }, { path: '/~0~1', before: 2, after: 5 },
  ]);
});
test('numericDiff: 数値のみ・追加削除・最上位・NaN', () => {
  assert.deepEqual(numericDiff({ a: '1', b: true }, { a: '2', b: false }), []);
  assert.deepEqual(numericDiff(2, 3), [{ path: '/', before: 2, after: 3 }]);
  assert.deepEqual(numericDiff(NaN, NaN), []);
  assert.deepEqual(numericDiff({ gone: 2 }, { added: 3 }), [
    { path: '/added', before: undefined, after: 3 }, { path: '/gone', before: 2, after: undefined },
  ]);
});
test('draftContent: 6キー・署名URL除外・入力不変', () => {
  const input = { title: '題', caption_text: '文', hashtags: ['#tag'], source_data: { dataCardUrl: 'signed', n: 2, bundle: { script: '台本' } },
    video_storage_path: 'v', cover_image_path: 'c', status: 'draft' };
  const original = structuredClone(input);
  assert.deepEqual(draftContent(input), { title: '題', caption_text: '文', hashtags: ['#tag'], source_data: { n: 2, bundle: { script: '台本' } }, video_storage_path: 'v', cover_image_path: 'c' });
  assert.deepEqual(input, original);
  const empty = draftContent({ source_data: {} });
  assert.deepEqual(Object.keys(empty).sort(), ['title', 'caption_text', 'hashtags', 'source_data', 'video_storage_path', 'cover_image_path'].sort());
  for (const key of ['title', 'caption_text', 'hashtags', 'video_storage_path', 'cover_image_path']) assert.equal(empty[key], null);
});
test('compareDraftSnapshots: 変更した本文だけ・タグ結合・数値接続', () => {
  const before = { title: '旧', caption_text: '文', hashtags: ['#a', '#b'], source_data: { bundle: { youtube_description: '旧説明', script: '旧台本' }, n: 1 } };
  const after = { ...before, title: '新', hashtags: ['#a', '#c'], source_data: { bundle: { youtube_description: '新説明', script: '新台本' }, n: 2 } };
  const result = compareDraftSnapshots(snapshot(before), snapshot(after));
  assert.deepEqual(result.text, [
    { key: 'title', label: 'タイトル', parts: characterDiff('旧', '新') },
    { key: 'hashtags', label: 'ハッシュタグ', parts: characterDiff('#a #b', '#a #c') },
    { key: 'description', label: '説明文', parts: characterDiff('旧説明', '新説明') },
    { key: 'script', label: '台本', parts: characterDiff('旧台本', '新台本') },
  ]);
  assert.deepEqual(result.numbers, [{ path: '/n', before: 1, after: 2 }]);
  assert.deepEqual(result.media, []);
  assert.deepEqual(compareDraftSnapshots(snapshot(before), snapshot(before)), { text: [], media: [], numbers: [] });
  assert.deepEqual(compareDraftSnapshots(snapshot(), snapshot({ caption_text: '本文' })).text,
    [{ key: 'caption_text', label: '本文・説明文', parts: [part('added', '本文')] }]);
});
for (const key of ['video', 'cover', 'dataCard']) {
  const media = (path, sha256) => ({ path, sha256 });
  for (const [name, before, after, state] of [
    ['両方無し', null, null, 'same'], ['追加', null, media('new', 'b'), 'added'],
    ['削除', media('old', 'a'), null, 'removed'], ['旧hash無し', media('old', null), media('new', 'b'), 'unknown'],
    ['新hash無し', media('old', 'a'), media('new', null), 'unknown'],
    ['同一hash別パス', media('old', 'a'), media('new', 'a'), 'same'],
    ['同一パス別hash', media('path', 'a'), media('path', 'b'), 'replaced'],
  ]) {
    test(`compareDraftSnapshots: ${key} ${name}`, () => {
      const result = compareDraftSnapshots(snapshot({}, { [key]: before }), snapshot({}, { [key]: after }));
      assert.deepEqual(result.media, state === 'same' ? [] : [{ key, before, after, state }]);
    });
  }
  test(`compareDraftSnapshots: ${key} パスからの未確認媒体`, () => {
    const content = path => key === 'dataCard' ? { source_data: { dataCardPath: path } }
      : { [key === 'video' ? 'video_storage_path' : 'cover_image_path']: path };
    const old = { path: 'old', sha256: null }, next = { path: 'new', sha256: null };
    assert.deepEqual(compareDraftSnapshots(snapshot(content('old')), snapshot(content('new'))).media,
      [{ key, before: old, after: next, state: 'unknown' }]);
    assert.deepEqual(compareDraftSnapshots(snapshot(), snapshot(content('new'))).media,
      [{ key, before: null, after: next, state: 'added' }]);
    assert.deepEqual(compareDraftSnapshots(snapshot(content('old')), snapshot()).media,
      [{ key, before: old, after: null, state: 'removed' }]);
    const explicit = { path: 'explicit', sha256: 'hash' };
    assert.deepEqual(compareDraftSnapshots(snapshot(content('old'), { [key]: explicit }), snapshot()).media,
      [{ key, before: explicit, after: null, state: 'removed' }]);
  });
}
console.log(`KNOWN_GAPS ${KNOWN_GAPS.length}`);
for (const gap of KNOWN_GAPS) console.log(inspect({ ...gap, actual: gap.actual() }, { depth: null, compact: true, breakLength: Infinity }));
console.log(`Result: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
