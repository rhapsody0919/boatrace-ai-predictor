/**
 * 型 f01 の試作: 声（VOICEVOX 青山龍星・ノーマル、speedScale 1.1）。ローカルの engine（既定 http://127.0.0.1:50021）に字幕の1行ずつ読ませる。
 * 読みは辞書（f01.mjs の VOICE_DICT）で置き換えた文で読ませ、audio_query の kana を返す（照合は f01Check）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE, voiceText } from "./f01.mjs";

export const ENGINE = process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";

async function speakerId(name) {
  const res = await fetch(`${ENGINE}/speakers`);
  if (!res.ok) throw new Error(`VOICEVOX の /speakers: HTTP ${res.status}`);
  const sp = (await res.json()).find((s) => s.name === name);
  const st = sp?.styles.find((x) => x.name === "ノーマル");
  if (!st) throw new Error(`VOICEVOX に「${name}」のノーマルが無い`);
  return st.id;
}

/** wav（PCM）の秒 */
function wavSeconds(buf) {
  const rate = buf.readUInt32LE(24);
  const bytesPerSec = buf.readUInt32LE(28);
  let i = 12;
  while (i < buf.length - 8) {
    const id = buf.toString("ascii", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "data") return size / bytesPerSec;
    i += 8 + size;
  }
  throw new Error(`wav に data が無い（${rate}Hz）`);
}

/**
 * @param {{id: string, voice: string, subs: string[]}[]} chapters
 * @param {string} outDir
 * @returns {Promise<{lines: {chapter: string, i: number, sub: string, file: string, sec: number}[], kana: Record<string, string>}>}
 */
export async function synthAll(chapters, outDir, splitSubs) {
  const id = await speakerId(VOICE.speaker);
  const lines = [];
  const kana = {};
  for (const c of chapters) {
    // 冒頭は字幕を出さないが、声は同じ単位で区切る
    const parts = c.subs.length ? c.subs : splitSubs(c.voice);
    for (const [i, sub] of parts.entries()) {
      const text = voiceText(sub);
      const q = await fetch(`${ENGINE}/audio_query?speaker=${id}&text=${encodeURIComponent(text)}`, { method: "POST" });
      if (!q.ok) throw new Error(`audio_query: HTTP ${q.status}（${text}）`);
      const query = await q.json();
      query.speedScale = VOICE.speedScale;
      kana[`${c.id}-${i}`] = query.kana;
      const w = await fetch(`${ENGINE}/synthesis?speaker=${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
      if (!w.ok) throw new Error(`synthesis: HTTP ${w.status}（${text}）`);
      const buf = Buffer.from(await w.arrayBuffer());
      const file = `voice-${c.id}-${i}.wav`;
      writeFileSync(join(outDir, file), buf);
      lines.push({ chapter: c.id, i, sub: sub, file, sec: Math.round(wavSeconds(buf) * 1000) / 1000 });
    }
  }
  return { lines, kana };
}
