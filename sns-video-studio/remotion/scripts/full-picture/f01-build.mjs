/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の完全版を作る。run-full.mjs（daily.mjs --type-spec）と試作（prototype-f01.mjs）が使う。
 * 材料 JSON 1つ → 台本（f01.mjs）→ 声（f01-voice.mjs、VOICEVOX）→ 左の実画面（f01-capture.mjs、Playwright）→ 時間の並び →
 * MP4（Remotion F01Landscape）・サムネ（F01Thumb、1280x720）・題・説明欄・章。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md
 * cwd は sns-video-studio/remotion（Remotion の src/index.jsx を読む）。ローカルの VOICEVOX engine が要る
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { f01Check, f01Description, f01RacerCheck, f01Script, splitSubs } from "./f01.mjs";
import { MIN_FONT_PX, fullName, racersOf } from "../../src/fullPicture/f01Right.js";
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
/**
 * 章ごとの左の画面の並び（撮った物の名前・切り替える行の語・カーソル）。行の語は前のカットの行から後ろを探す。
 * cursor: そのカットの上で、次に押す所（cursor の名前の撮った物の cursor / cursorFrom）へカーソルを動かし、0.5秒後に次のカットへ
 * delay: 同じ行の語のカットの、0.5秒後に出す
 */
export const PLAN = {
  c1: [{ k: "c1" }, { k: "c12", re: /2位以内/ }],
  // 着順の流れは押した後を上・下の2カット（下は押してから3秒後）。③の札は図 → 名前と件数の2カット（オーナー 11/2「22.4px の章は2カットに分けて」）
  c2: [{ k: "c2" }, { k: "c2-pre", re: /号艇が勝った/, cursor: "c22" }, { k: "c22", re: /号艇が勝った/, delay: 15 }, { k: "c22b", re: /号艇が勝った/, delay: 105 }],
  c3: [{ k: "c3i" }, { k: "c3", re: /形。/ }, { k: "c3-pre", re: /この形の/, cursor: "c32" }, { k: "c32", re: /この形の/, delay: 15 }, { k: "c32b", re: /号艇が勝った/ }],
  c4: [{ k: "c4" }, { k: "c4b", re: /2着は/ }, { k: "c4", re: /軸を\d号艇に/, cursor: "c42" }, { k: "c42", re: /軸を\d号艇に/, delay: 15 }, { k: "c42b", re: /2着は/ }],
  c5: [{ k: "c5" }],
  close: [{ k: "close" }],
};
/**
 * 左の画面の字の小ささの線（縮めた後の最小の字の高さ px）。下回る撮った物を含む章は出さず警告にする（hq 6節「2カットでも届かなければその章を出さず警報」）。
 * 線は 24px（オーナー 2026-11-02）。部品だけを1カットで撮ると、着順の流れ（正方形の図、字は図の高さの約2.7%）と形の札の図の艇番が約22px 止まりだったので、
 * 着順の流れは上下2カット、形の札は図と名前の2カットに分けた（PLAN）。6節の目安 28px（根拠なし）は線にしない
 */
export { MIN_FONT_PX };
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
    const ch = { id: c.id, from: f(start), len: f(len), tag: c.tag ?? null, scope: c.scope ?? null, answer: c.answer ?? null, answer2: c.answer2 ?? null, path: c.path ?? null, foot: c.foot ?? null, right: c.right ?? null };
    if (c.open) ch.open = c.open;
    else {
      ch.answerAt = at(cue.answer, 1);
      ch.answer2At = at(cue.answer2, len / 2);
      ch.pathAt = f(lineAt[lineAt.length - 1] ?? 0);
      ch.footAt = at(cue.foot);
      // 同じ部品（押す前・押した後、④と締めの軸のボタン）は同じ倍率・同じ箱の高さにそろえる（切り替えで位置と大きさが動かない）
      const plan = PLAN[c.id] ?? [{ k: c.id }];
      const group = (sh) => Object.values(shots).filter((o) => Math.abs(o.clip.x - sh.clip.x) < 2 && Math.abs(o.clip.w - sh.clip.w) < 2 && Math.abs(o.clip.h - sh.clip.h) < 24);
      const cut = (sh, from, extra = {}) => {
        const g = group(sh);
        const scale = Math.min(...g.map((o) => o.scale));
        return { file: basename(sh.file), clip: sh.clip, scale, boxH: Math.max(...g.map((o) => o.clip.h)) * scale, from, ...extra };
      };
      const gAt = at(cue.gold);
      ch.cuts = [];
      let pos = 0;
      for (const p of plan) {
        const sh = shots[p.k];
        if (!sh) continue;
        let T = 0;
        if (p.re) {
          const i = lines.findIndex((l, j) => j >= pos && p.re.test(l.sub));
          if (i < 0) continue;
          pos = i;
          T = f(lineAt[i]) + (p.delay ?? 0);
        }
        const extra = { gold: (sh.goldBoxes ?? []).map((g) => ({ ...g, at: gAt })) };
        const next = p.cursor ? shots[p.cursor] : null;
        // カーソルは押す所へ0.5秒で動く（押す前の画面の座標）
        if (next) extra.cursor = { ...(next.cursor ?? next.cursorFrom), at: T + 15 };
        ch.cuts.push(cut(sh, T, extra));
      }
    }
    chapters.push(ch);
    marks.push({ id: c.id, name: c.name, at: start });
    t += len;
  }
  // 終了画面: 締めの声の約4秒目から重ね、声の後の静止は約8秒
  const close = chapters.find((c) => c.id === "close");
  // 置いた声だけから（字の小ささ等で省いた章の声は voice.lines に残る。Codex P1 #2075）
  const placed = new Map(voice.lines.map((l) => [l.file, l.sec]));
  const lastVoiceEnd = Math.max(0, ...audio.map((a) => a.from + f(placed.get(a.file))));
  const end = close ? { from: close.from + f(4) } : null;
  const total = Math.round(Math.max(t * FPS, lastVoiceEnd + f(8)));
  if (close) close.len = total - close.from;
  return { props: { total, chapters, subs, audio, bgm: bgm ? "bgm.mp3" : null, end }, marks };
}

/**
 * 字の小ささの線を下回る章（撮った物の minFontPx が MIN_FONT_PX 未満）と、最初のカットが撮れなかった章
 * @param {{chapters: {id: string}[]}} s @param {Record<string, {minFontPx: number|null}>} shots
 * @returns {{id: string, reason: string}[]}
 */
export function f01SmallChapters(s, shots) {
  const out = [];
  for (const c of s.chapters) {
    const plan = PLAN[c.id];
    if (!plan) continue;
    if (!shots[plan[0].k]) {
      out.push({ id: c.id, reason: `左の画面（${plan[0].k}）を撮れなかった` });
      continue;
    }
    const low = plan.map((p) => p.k).filter((k, i, a) => shots[k] && a.indexOf(k) === i && (shots[k].minFontPx ?? 0) < MIN_FONT_PX);
    if (low.length) out.push({ id: c.id, reason: `字が小さい（${low.map((k) => `${k} ${shots[k].minFontPx}px`).join("・")}、線 ${MIN_FONT_PX}px）` });
  }
  return out;
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
  // 右の列の名前と級・収まりは声と撮影の前に確かめる（純関数。落ちる日に声と撮影の数分を使わない）
  const racerWhy = f01RacerCheck(s, racersOf(m).racers);
  if (racerWhy.length) return { reasons: ["type_unsupported:f01_check"], detail: racerWhy.join(" / ") };
  let voice;
  try {
    voice = await synthAll(s.chapters, pub, splitSubs);
  } catch (e) {
    return { reasons: ["type_unsupported:voice"], detail: `VOICEVOX: ${e instanceof Error ? e.message : String(e)}` };
  }
  const shots = await captureAll(m, s, pub);
  // 字の小ささの線（MIN_FONT_PX）: 下回る撮った物を含む章・撮れなかった章は出さず、警告として残す
  const small = f01SmallChapters(s, shots);
  if (small.length) {
    s.chapters = s.chapters.filter((c) => !small.some((x) => x.id === c.id));
    s.omitted.push(...small.map((x) => ({ chapter: x.id, reason: x.reason })));
    for (const x of small) console.warn(`[f01 で省いた章] ${x.id}: ${x.reason}`);
  }
  const { props, marks } = f01Timeline(s, voice, shots, { bgm });
  if (bgm) copyFileSync(bgm, join(pub, "bgm.mp3"));
  const chapters = f01Chapters(marks);
  const description = f01Description(s, chapters);
  // 選手名（姓・名の両方。声で読まないことの照合）
  const names = (m.api.races?.find((r) => r.raceId === m.raceId)?.entries ?? []).flatMap((e) => [...(e.name ?? "").split(/\s+/), fullName(e.name)]).filter((x) => x.length >= 2);
  // 名前と級の照合（右の列の文と、材料の出走表 racersOf の名前と級。racersOf 自体の読み方は verify で固定）
  const why = f01Check(s, { desc: description, kana: voice.kana, shots, names, racers: racersOf(m).racers });
  const seconds = props.total / FPS;
  const report = {
    version: s.version,
    raceId: s.raceId,
    title: s.title,
    seconds,
    omitted: s.omitted,
    checks: why,
    minFontPx: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.minFontPx])),
    minFontLine: MIN_FONT_PX,
    smallText: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.small ?? []])),
    dpr: DPR,
    chapters: s.chapters.map((c) => ({ id: c.id, name: c.name, voice: c.voice, answer: c.answer ?? null, answer2: c.answer2 ?? null, scope: c.scope ?? null, right: c.right ?? null, bars: c.open?.bars ?? null, openLayout: c.open?.layout ?? null, facts: c.facts })),
    racers: s.racers,
    marks,
    kana: voice.kana,
  };
  writeFileSync(join(out, "f01.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "description.txt"), description);
  writeFileSync(join(out, "chapters.txt"), chapters);
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

/**
 * 作り済みの完全版（buildF01 の出力）を読む。run-full.mjs --bundle-only（描かずに bundle だけ作り直す）で使う。
 * 無ければ type_unsupported:f01_missing（今の型の完全版で代えない）
 * @param {string} out buildF01 の出力ディレクトリ
 */
export function loadF01(out) {
  const files = ["f01.mp4", "thumb.png", "f01.json", "description.txt", "chapters.txt"];
  const missing = files.filter((f) => !existsSync(join(out, f)));
  if (missing.length) return { reasons: ["type_unsupported:f01_missing"], detail: `${out} に ${missing.join("・")} が無い（--bundle-only の前に f01 を描く）` };
  const report = JSON.parse(readFileSync(join(out, "f01.json"), "utf8"));
  return {
    reasons: [],
    mp4: join(out, "f01.mp4"),
    thumb: join(out, "thumb.png"),
    seconds: report.seconds,
    title: report.title,
    description: readFileSync(join(out, "description.txt"), "utf8"),
    chapters: readFileSync(join(out, "chapters.txt"), "utf8"),
    report,
  };
}
