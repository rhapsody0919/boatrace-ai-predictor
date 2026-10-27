/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の試作（関門の段4）。毎日の生成にはつながない。型の表（TYPE_IMPL）にも載せない。
 * 材料 JSON 1つ → 台本（f01.mjs）→ 声（f01-voice.mjs、VOICEVOX）→ 左の実画面（f01-capture.mjs、Playwright）→ 時間の並び → MP4（Remotion F01Landscape）。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md
 *
 * 使い方（sns-video-studio/remotion で。ローカルの VOICEVOX engine が要る）:
 *   node scripts/full-picture/prototype-f01.mjs <材料.json> <出力ディレクトリ> [--bgm <mp3>]
 * 出力: f01.mp4・f01.json（台本・時間・検査・撮った画面の文字の大きさ）・description.txt・sheet.png（章ごとのコマの一覧）
 * 検査で落ちたら終了コード 2（MP4 は作らない）
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { f01Check, f01Description, f01Script, splitSubs } from "./f01.mjs";
import { synthAll } from "./f01-voice.mjs";
import { DPR, captureAll } from "./f01-capture.mjs";

const FPS = 30;
const args = process.argv.slice(2);
const bi = args.indexOf("--bgm");
const bgm = bi >= 0 ? args.splice(bi, 2)[1] : null;
const [matPath, outArg] = args;
if (!matPath || !outArg) {
  console.error("使い方: node scripts/full-picture/prototype-f01.mjs <材料.json> <出力ディレクトリ> [--bgm <mp3>]");
  process.exit(1);
}
const out = resolve(outArg);
const pub = join(out, "public");
mkdirSync(pub, { recursive: true });
const m = JSON.parse(readFileSync(matPath, "utf8"));

const s = f01Script(m);
if (!s.ok) {
  console.error(`作らない: type_unsupported:${s.kind}（${s.reason}）`);
  process.exit(3);
}
console.log(`台本: ${s.title}（章 ${s.chapters.length}、省いた章 ${s.omitted.length}）`);
const voice = await synthAll(s.chapters, pub, splitSubs);
console.log(`声: ${voice.lines.length}行 ${voice.lines.reduce((a, l) => a + l.sec, 0).toFixed(1)}秒`);
const shots = await captureAll(m, s, pub);
console.log(`画面: ${Object.keys(shots).length}枚`);

/** 章の中で、どの行で何を出すか（行の文の語で決める） */
const CUE = {
  c1: { answer: /2位以内/ },
  c2: { answer: /1着は/, cut2: /号艇が勝った/ },
  c3: { gold: /形。/, answer: /1着は/, cut2: /この形の/, answer2: /号艇が勝った/ },
  c4: { answer2: /1号艇が1着の/, answer: /軸を/, cut2: /軸を/ },
  c5: { answer2: /2位以内/, gold: /2位以内/, answer: /材料があるのは|材料が少ない/ },
  close: { gold: /号艇を軸に/, foot: /説明欄/ },
};
const f = (sec) => Math.round(sec * FPS);
const LEAD = 0.5;
const GAP = 0.25;
const TAIL = 0.9;
const chapters = [];
const subs = [];
const audio = [];
let t = 0;
const marks = [];
for (const c of s.chapters) {
  const start = t;
  const lines = voice.lines.filter((l) => l.chapter === c.id);
  let u = LEAD + (c.id === "open" ? 0.6 : 0);
  const lineAt = [];
  for (const l of lines) {
    lineAt.push(u);
    audio.push({ file: l.file, from: f(start + u) });
    if (!c.noSubs) subs.push({ text: l.sub, from: f(start + u), to: f(start + u + l.sec) });
    u += l.sec + GAP;
  }
  const len = u - GAP + TAIL;
  const cue = CUE[c.id] ?? {};
  const at = (re, def = 0) => {
    if (!re) return f(def);
    const i = lines.findIndex((l) => re.test(l.sub));
    return f(i >= 0 ? lineAt[i] : def);
  };
  const ch = { id: c.id, from: f(start), len: f(len), tag: c.tag ?? null, scope: c.scope ?? null, answer: c.answer ?? null, answer2: c.answer2 ?? null, path: c.path ?? null, foot: c.foot ?? null };
  if (c.open) ch.open = c.open;
  else {
    ch.answerAt = at(cue.answer, 1);
    ch.answer2At = at(cue.answer2, len / 2);
    ch.pathAt = f(lineAt[lineAt.length - 1] ?? 0);
    ch.footAt = at(cue.foot);
    const id1 = c.id;
    const id2 = `${c.id}2`;
    const one = shots[id1];
    const two = shots[id2];
    // 押す前・押した後で同じ部品を撮った物は同じ倍率にそろえる
    const sc = two && Math.abs(two.clip.x - one.clip.x) < 2 && Math.abs(two.clip.w - one.clip.w) < 2 ? Math.min(one.scale, two.scale) : null;
    const cut = (sh, from, extra = {}) => ({ file: basename(sh.file), clip: sh.clip, scale: sc ?? sh.scale, from, ...extra });
    const gAt = at(cue.gold);
    ch.cuts = [cut(one, 0, { gold: (one.goldBoxes ?? []).map((g) => ({ ...g, at: gAt })) })];
    if (two) {
      const T = at(cue.cut2);
      if (two.pre) {
        // 押す前の画面を出し、0.5秒でカーソルが帯に届いたら押した後の画面にする
        ch.cuts.push({ ...cut({ ...two, file: two.pre }, T), cursor: { ...two.cursor, at: T + 15 } });
        ch.cuts.push(cut(two, T + 15));
      } else if (two.cursorFrom) {
        ch.cuts[0].cursor = { ...two.cursorFrom, at: T + 15 };
        ch.cuts.push(cut(two, T + 15));
      } else ch.cuts.push(cut(two, T));
    }
    // 締めは④の後の画面（押していない軸に GOLD の枠）
    if (c.id === "close" && shots.c42) ch.cuts[0].scale = Math.min(shots.c4.scale, shots.c42.scale);
    if (c.id === "c4" && shots.close) for (const k of ch.cuts) k.scale = Math.min(shots.c4.scale, shots.c42.scale);
  }
  chapters.push(ch);
  marks.push({ id: c.id, name: c.name, at: start });
  t += len;
}
// 終了画面: 締めの声の約4秒目から重ね、声の後の静止は約8秒
const close = chapters.find((c) => c.id === "close");
const lastVoiceEnd = Math.max(...voice.lines.map((l) => audio.find((a) => a.file === l.file).from + f(l.sec)));
const end = close ? { from: close.from + f(4) } : null;
const total = Math.max(t * FPS, lastVoiceEnd + f(8));
if (close) close.len = total - close.from;
const props = { total: Math.round(total), chapters, subs, audio, bgm: bgm ? "bgm.mp3" : null, end };
if (bgm) copyFileSync(bgm, join(pub, "bgm.mp3"));

const desc = f01Description(s, marks.map((x) => ({ name: x.name, at: x.at })));
// 選手名（姓・名の両方。声で読まないことの照合）
const names = (m.api.races?.find((r) => r.raceId === m.raceId)?.entries ?? []).flatMap((e) => (e.name ?? "").split(/\s+/)).filter((x) => x.length >= 2);
const why = f01Check(s, { desc, kana: voice.kana, shots, names });
const seconds = props.total / FPS;
const report = {
  version: s.version,
  raceId: s.raceId,
  title: s.title,
  seconds,
  omitted: s.omitted,
  checks: why,
  minFontPx: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.minFontPx])),
  dpr: DPR,
  chapters: s.chapters.map((c) => ({ id: c.id, name: c.name, voice: c.voice, answer: c.answer ?? null, answer2: c.answer2 ?? null, scope: c.scope ?? null, facts: c.facts })),
  marks,
  kana: voice.kana,
};
writeFileSync(join(out, "f01.json"), JSON.stringify(report, null, 2));
writeFileSync(join(out, "description.txt"), desc);
writeFileSync(join(out, "props.json"), JSON.stringify(props));
if (why.length) {
  console.error(`検査で止めた:\n- ${why.join("\n- ")}`);
  process.exit(2);
}
execFileSync("npx", ["remotion", "render", "src/index.jsx", "F01Landscape", join(out, "f01.mp4"), `--props=${join(out, "props.json")}`, `--public-dir=${pub}`, "--concurrency=4"], { stdio: "inherit" });
// 章ごとのコマの一覧（各章の答えが出た後と、2カット目の後）
const picks = [];
for (const c of chapters) {
  if (c.open) picks.push(c.from + f(4));
  else {
    picks.push(c.from + Math.min(c.len - 5, (c.answerAt ?? 0) + f(1)));
    const c2 = c.cuts[c.cuts.length - 1];
    if (c.cuts.length > 1) picks.push(c.from + Math.min(c.len - 5, c2.from + f(2)));
  }
}
if (end) picks.push(total - f(2));
const sel = picks.map((p) => `eq(n\\,${Math.round(p)})`).join("+");
const rows = Math.ceil(picks.length / 3);
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(out, "f01.mp4"), "-vf", `select='${sel}',scale=640:360,tile=3x${rows}`, "-frames:v", "1", "-vsync", "vfr", join(out, "sheet.png")]);
console.log(`完了: ${join(out, "f01.mp4")}（${seconds.toFixed(1)}秒）`);
