// 使い方: node render.js <tail.sql> <from YYYY-MM-DD> <to YYYY-MM-DD>  → 実行する SQL を標準出力へ
import fs from 'node:fs'; import path from 'node:path';
const [tail, from, to] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const base = fs.readFileSync(path.join(dir, process.env.BASE || 'sql/pool_base.sql'), 'utf8');
const sql = (base + fs.readFileSync(tail, 'utf8'))
  .replaceAll('{{FROM}}', `DATE '${from}'`).replaceAll('{{TO}}', `DATE '${to}'`)
  .split('\n').map(l => l.replace(/--.*$/, '').trim()).filter(Boolean).join('\n');
process.stdout.write(sql);
