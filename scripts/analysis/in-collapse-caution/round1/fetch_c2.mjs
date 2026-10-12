// 読み取りのみ: analogy_v16_snapshots（racecard/exhibition, ok）の類似レース上位400件から1号艇の1着数を数える
import { fetchAll } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/lib/supabaseClient.js';
import { readObject, objectPath } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/api/_lib/analogyV16.js';
import { mergeExhibition } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/api/analogy/similar/[raceId].js';
import { aggregateNeighbors } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/src/utils/analogyAggregate.js';
import fs from 'node:fs';
const snaps = await fetchAll('analogy_v16_snapshots','race_id,stage,run_id,status,n_layer,computed_at', q=>q.lt('race_id','2026-10-11').order('race_id').order('stage'));
const rc = new Map(snaps.filter(s=>s.stage==='racecard'&&s.status==='ok').map(s=>[s.race_id,s]));
const ex = new Map(snaps.filter(s=>s.stage==='exhibition'&&s.status==='ok').map(s=>[s.race_id,s]));
const out=['race_id,stage,n_layer,n,b1win,computed_at'];
let first=true; const ids=[...rc.keys()];
const one = async (id) => {
  const r = rc.get(id);
  const card = await readObject(objectPath(id, r.run_id, 'similar-racecard', id));
  if (!card) return;
  
  const lines=[];
  const cnt = (sim, stage, at) => { const top = sim.neighbors.slice(0, Math.min(400, sim.n_layer));
    const a = aggregateNeighbors(top); lines.push([id,stage,sim.n_layer,a.n,a.win[0],at].join(',')); };
  cnt(card,'racecard',r.computed_at);
  const e = ex.get(id);
  if (e && typeof mergeExhibition==='function') { const exo = await readObject(objectPath(id, e.run_id, 'similar-exhibition', id)); if (exo) cnt(mergeExhibition(card, exo),'exhibition',e.computed_at); }
  out.push(...lines);
};
for (let i=0;i<ids.length;i+=8) await Promise.all(ids.slice(i,i+8).map(one));
fs.writeFileSync(process.argv[2], out.join('\n')+'\n'); console.log(rc.size, ex.size, out.length-1);
