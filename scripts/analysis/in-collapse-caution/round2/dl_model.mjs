// 読み取りのみ: 類似レースの距離の重みに使う版（2026-10-06）のモデルと学習の記録を Storage から落とす
import { supabase } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/lib/supabaseClient.js';
import { BUCKET } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/ml/analogy/storage.js';
import fs from 'node:fs'; import zlib from 'node:zlib';
for (const name of ['model_win.txt', 'train_meta.json']) {
  const { data, error } = await supabase.storage.from(BUCKET).download(`2026-10-06/${name}.gz`);
  if (error) throw new Error(`${name}: ${error.message}`);
  fs.writeFileSync(`${process.argv[2]}/${name}`, zlib.gunzipSync(Buffer.from(await data.arrayBuffer())));
  console.log(name);
}
