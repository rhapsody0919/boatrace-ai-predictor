/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の完全版を作る。run-full.mjs（daily.mjs --type-spec）と試作（prototype-f01.mjs）が使う。
 * 材料 JSON 1つ → 台本（f01.mjs）→ 声（f01-voice.mjs、VOICEVOX）→ 左の実画面（f01-capture.mjs、Playwright）→ 時間の並び →
 * MP4（Remotion F01Landscape）・サムネ（F01Thumb、1280x720）・題・説明欄・章。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md
 * cwd は sns-video-studio/remotion（Remotion の src/index.jsx を読む）。ローカルの VOICEVOX engine が要る
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { f01Check, f01Description, f01Script, splitSubs } from "./f01.mjs";
import { synthAll } from "./f01-voice.mjs";
import { DPR, captureAll } from "./f01-capture.mjs";

const FPS = 30;
/** 章の中で、どの行で何を出すか（行の文の語で決める） */
const CUE = {
  c1: { answer: /2位以内/, cut2: /2位以内/ },
  c2: { answer: /1着は/, cut2: /号艇が勝った/ },
  c3: { gold: /形。/, answer: /1着は/, cut2: /この形の/, answer2: /号艇が勝った/ },
  c4: { answer2: /1号艇が1着の/, answer: /軸を\d号艇に/, cut2: /軸を\d号艇に/ },
  c5: { answer2: /2位以内/, gold: /2位以内/, answer: /項目が多いのは|材料が少ない/ },
  close: { gold: /号艇を軸に/, foot: /説明欄/ },
};
const f = (sec) => Math.round(sec * FPS);
const LEAD = 0.5;
const GAP = 0.25;
const TAIL = 0.9;

/** 声の行と撮った画面 → composition の props（時間の並び）と章の始まり */
export function f01Timeline(s, voice, shots, { bgm = null } = {}) {
  const chapters = [];
  const subs = [];
  const audio = [];
  const marks = [];
  let t = 0;
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
      const one = shots[c.id];
      const two = shots[`${c.id}2`];
      // 押す前・押した後で同じ部品を撮った物は同じ倍率にそろえる。④と締めは同じ部品（思考アシストの相手）
      const same = two && Math.abs(two.clip.x - one.clip.x) < 2 && Math.abs(two.clip.w - one.clip.w) < 2;
      const sc = c.id === "c4" || c.id === "close" ? Math.min(shots.c4.scale, shots.c42.scale) : same ? Math.min(one.scale, two.scale) : null;
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
    }
    chapters.push(ch);
    marks.push({ id: c.id, name: c.name, at: start });
    t += len;
  }
  // 終了画面: 締めの声の約4秒目から重ね、声の後の静止は約8秒
  const close = chapters.find((c) => c.id === "close");
  const lastVoiceEnd = Math.max(...voice.lines.map((l) => audio.find((a) => a.file === l.file).from + f(l.sec)));
  const end = close ? { from: close.from + f(4) } : null;
  const total = Math.round(Math.max(t * FPS, lastVoiceEnd + f(8)));
  if (close) close.len = total - close.from;
  return { props: { total, chapters, subs, audio, bgm: bgm ? "bgm.mp3" : null, end }, marks };
}

/** YouTube の章の行（「0:00 冒頭」）。10秒未満の章は前の章に含める */
export const f01Chapters = (marks) => {
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const keep = marks.filter((x, i) => i === 0 || (marks[i + 1]?.at ?? Infinity) - x.at >= 10 || i === marks.length - 1);
  return keep.map((x, i) => `${i === 0 ? "0:00" : mmss(x.at)} ${x.name}`).join("\n") + "\n";
};

/**
 * 完全版を作る。作れないときは reasons（type_unsupported:<項目> の固定の文）と detail を返す（黙って今の型で作らない）
 * @param {object} m 材料 JSON
 * @param {string} out 出力ディレクトリ（public/ に声・撮った画面を置く）
 * @param {{bgm?: string|null, concurrency?: string|number, sheet?: boolean}} [o]
 */
export async function buildF01(m, out, { bgm = null, concurrency = 4, sheet = false } = {}) {
  const pub = join(out, "public");
  mkdirSync(pub, { recursive: true });
  const s = f01Script(m);
  if (!s.ok) return { reasons: [`type_unsupported:${s.kind}`], detail: s.reason };
  let voice;
  try {
    voice = await synthAll(s.chapters, pub, splitSubs);
  } catch (e) {
    return { reasons: ["type_unsupported:voice"], detail: `VOICEVOX: ${e instanceof Error ? e.message : String(e)}` };
  }
  const shots = await captureAll(m, s, pub);
  const { props, marks } = f01Timeline(s, voice, shots, { bgm });
  if (bgm) copyFileSync(bgm, join(pub, "bgm.mp3"));
  const chapters = f01Chapters(marks);
  const description = f01Description(s, chapters);
  // 選手名（姓・名の両方。声で読まないことの照合）
  const names = (m.api.races?.find((r) => r.raceId === m.raceId)?.entries ?? []).flatMap((e) => (e.name ?? "").split(/\s+/)).filter((x) => x.length >= 2);
  const why = f01Check(s, { desc: description, kana: voice.kana, shots, names });
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
  writeFileSync(join(out, "description.txt"), description);
  writeFileSync(join(out, "props.json"), JSON.stringify(props));
  if (why.length) return { reasons: ["type_unsupported:f01_check"], detail: why.join(" / "), report };
  const mp4 = join(out, "f01.mp4");
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.jsx", "F01Landscape", mp4, "--codec=h264", "--crf=23", "--audio-bitrate=160k", `--props=${join(out, "props.json")}`, `--public-dir=${pub}`, `--concurrency=${concurrency}`, "--log=error"],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  // サムネ（横 1280x720）: 冒頭の問い＋数字1つ（hq の型の thumb「問い10字前後＋数字1つ」）
  const thumb = join(out, "thumb.png");
  const thumbProps = { head: `${s.raceName}  ${s.date}`, question: "1号艇を崩すのは？", number: `${Math.round((s.open.k0 / s.open.n0) * 10)}割`, numberLabel: "過去の1号艇の1着" };
  writeFileSync(join(out, "props-thumb.json"), JSON.stringify(thumbProps));
  execFileSync("npx", ["remotion", "still", "src/index.jsx", "F01Thumb", thumb, `--props=${join(out, "props-thumb.json")}`, "--image-format=png", "--log=error"], { stdio: ["ignore", "inherit", "inherit"] });
  if (sheet) {
    // 章ごとのコマの一覧（各章の答えが出た後と、2カット目の後）
    const picks = [];
    for (const c of props.chapters) {
      if (c.open) picks.push(c.from + f(4));
      else {
        picks.push(c.from + Math.min(c.len - 5, (c.answerAt ?? 0) + f(1)));
        const c2 = c.cuts[c.cuts.length - 1];
        if (c.cuts.length > 1) picks.push(c.from + Math.min(c.len - 5, c2.from + f(2)));
      }
    }
    if (props.end) picks.push(props.total - f(1));
    const sel = picks.map((p) => `eq(n\\,${Math.round(p)})`).join("+");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", mp4, "-vf", `select='${sel}',scale=640:360,tile=3x${Math.ceil(picks.length / 3)}`, "-frames:v", "1", "-vsync", "vfr", join(out, "sheet.png")]);
  }
  return { reasons: [], mp4, thumb, seconds, title: s.title, description, chapters, report };
}
