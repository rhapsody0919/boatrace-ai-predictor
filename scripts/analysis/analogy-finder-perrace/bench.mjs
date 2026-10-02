import { load, contrib } from './treeshap.mjs';
import { readFileSync } from 'node:fs'; import os from 'node:os';
const dir = (process.env.TREESHAP_FIXTURE_DIR || new URL('.', import.meta.url).pathname).replace(/\/?$/, '/'); // model_dump.json と ref.json の置き場（ablate.py・timing.py が作る）
const { trees, nf } = load(dir + 'model_dump.json'); const ref = JSON.parse(readFileSync(dir + 'ref.json', 'utf8'));
const run = n => { for (let i = 0; i < n; i++) contrib(trees, ref.X[i], nf); };
run(60);
const cpu = (n, rep) => { const r = []; for (let k = 0; k < rep; k++) { const c = process.cpuUsage(); const w = performance.now(); run(n); const u = process.cpuUsage(c); r.push([(u.user + u.system) / 1000, performance.now() - w]); } r.sort((a, b) => a[0] - b[0]); return { cpu_ms_min: +r[0][0].toFixed(1), cpu_ms_med: +r[Math.floor(r.length / 2)][0].toFixed(1), wall_ms_med: +r[Math.floor(r.length / 2)][1].toFixed(1) }; };
const before = os.loadavg();
console.log(JSON.stringify({ load_before: before, race1: cpu(6, 30), races168: cpu(1008, 2), load_after: os.loadavg() }));
