/**
 * 全貌動画の毎日の実行（1本のコマンド）。材料 JSON 1つ → 文の JSON・完全版の MP4（全場面）・入口版の MP4（59秒以内）・
 * 拍ごとの静止画・本文。龍神の鍵は要らない（鍵が要るのは材料の取得 fetch-materials.mjs だけ）。
 * つないだ版の LLM（つなぐ語を選ぶだけ）はログイン済みの claude（1レース1回）。
 * 2026-10-20 オーナー決定: 完全版は YouTube の通常の動画、入口版（scripts/full-picture/entry.mjs）は X・Shorts。
 *
 * 使い方（sns-video-studio/remotion で）:
 *   node scripts/full-picture/run-full.mjs <材料.json> <出力ディレクトリ> [--text template|connected|both] [--bgm <mp3>] [--regen-text] [--no-video] [--entry-only] [--concurrency N]
 * 出力:
 *   scenes.json                全場面の描く値と拍ごとの facts（コードが計算した比較）、omitted（省いた要素）
 *   text-{版}.json             答えの文（拍ごと。つないだ版はつなぐ語と、付けなかった理由も）
 *   {版}/full-picture.mp4      完全版（全場面）の MP4。{版}/stills/*.png は拍ごとの静止画（答えが出て1秒後のコマ）
 *   entry/entry.mp4            入口版の MP4（文型の版。つなぐ語は完全版の拍の並びに合わせたものなので使わない）。entry/stills/*.png
 *   entry.json                 入口版の場面の並び・省いた要素・尺
 *   post.txt                   完全版（YouTube）の本文。post-entry.txt は入口版（X・Shorts）の本文（動画に出る数字だけ）
 *   chapters.txt               完全版の章（YouTube の説明文に貼る「0:00 条件」の行。10秒未満の場面は前の章に含める）
 *   run-{版}.json・run-entry.json  かかった時間・LLM の回数・尺
 * 文の JSON は既にあれば作り直さない（--regen-text で作り直す）。同じ文の JSON なら同じ MP4。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { allBeats, bannedIn, connectedText, templateText } from "./scene2-text.mjs";
import { entryScenes } from "./entry.mjs";
import { buildAll } from "./build-all.mjs";
import { MATERIALS_SCHEMA, validate } from "./materials-contract.mjs";
import { t } from "./scene2-data.mjs";
import { fullPictureTimeline } from "../../src/fullPicture/fullPictureTimeline.js";
import { scene2Timeline, ANSWER_AT, OVERVIEW_ANSWER_AT, cardAnswerAt } from "../../src/fullPicture/scene2Timeline.js";
import { stepTimeline } from "../../src/fullPicture/stepTimeline.js";
import { venueLabel, fmtCount } from "../../../../src/utils/analogyFormat.js";

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const textMode = opt("--text", "connected");
const bgm = opt("--bgm");
const regenText = has("--regen-text");
const noVideo = has("--no-video");
// 入口版だけ描き直す（完全版の MP4 はそのまま）
const entryOnly = has("--entry-only");
// 描画の並列数（既定はコア数−1。ほかの作業と同時に回すときは小さくする）
const concurrency = opt("--concurrency", String(Math.max(1, (await import("node:os")).cpus().length - 1)));
const [input, outDir] = args;
if (!input || !outDir || !["template", "connected", "both"].includes(textMode)) {
  console.error("使い方: node run-full.mjs <材料.json> <出力ディレクトリ> [--text template|connected|both] [--bgm <mp3>] [--regen-text] [--no-video]");
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const m = JSON.parse(readFileSync(input, "utf8"));
// 材料の契約（materials.schema.json）。形の変わった材料では描かない
const contractErrors = validate(m);
if (contractErrors.length) {
  console.error(`材料が契約（${MATERIALS_SCHEMA.$id}）に合わない:\n${contractErrors.slice(0, 20).join("\n")}`);
  process.exit(1);
}
const scenes = buildAll(m);
const omitted = scenes.flatMap((x) => (x.data?.omitted ?? []).map((o) => ({ scene: x.id, ...o })));
writeJson(join(out, "scenes.json"), { raceId: m.raceId, materialsVersion: m.schemaVersion, missing: m.missing, omitted, scenes });
for (const o of omitted) console.warn(`[省いた要素] ${JSON.stringify(o)}`);
for (const o of omitted.filter((x) => x.mustReport)) console.error(`[要報告] ${o.scene}: ${o.reason}`);
if (bgm) {
  mkdirSync("public/full-picture", { recursive: true });
  copyFileSync(bgm, "public/full-picture/bgm.mp3");
}
const beats = allBeats(scenes);

/** 拍ごとの静止画のフレーム（答えが出て1秒後） */
function stillFrames(list, answers) {
  const { starts } = fullPictureTimeline(list, answers);
  const out = [];
  list.forEach((x, i) => {
    const base = starts[i].from;
    if (!starts[i].len) return;
    if (x.kind === "scene2") {
      for (const b of scene2Timeline({ ...x.data, answers }).beats) {
        if (b.kind === "toCards") continue;
        const at = b.kind === "overview" ? OVERVIEW_ANSWER_AT : b.kind === "focus" ? ANSWER_AT : b.kind === "card" ? cardAnswerAt(b.index) : 20;
        const id = b.kind === "overview" ? "overview" : b.kind === "focus" ? x.data.radar.focus[b.index].id : b.kind === "card" ? x.data.cards.items[b.index].id : "empty";
        out.push({ frame: base + b.from + Math.min(at + 30, b.len - 1), id: `scene2-${id}` });
      }
    } else {
      stepTimeline({ ...x.data, answers }).beats.forEach((b) => {
        const s = x.data.steps[b.index];
        out.push({ frame: base + b.from + Math.min(b.times.answer + 30, b.len - 1), id: s.id });
      });
    }
  });
  return out;
}

/** MP4 と拍ごとの静止画を書き出す。かかった秒（描画・静止画） */
function render(list, answers, dir, name) {
  const props = { scenes: list, answers, ...(bgm ? { bgm: "full-picture/bgm.mp3" } : {}) };
  const propsPath = join(dir, `props-${name}.json`);
  writeJson(propsPath, props);
  mkdirSync(join(dir, "stills"), { recursive: true });
  const t0 = Date.now();
  const mp4 = join(dir, `${name}.mp4`);
  execFileSync("npx", ["remotion", "render", "src/index.jsx", "FullPicture", mp4, "--codec=h264", `--concurrency=${concurrency}`, `--props=${propsPath}`, "--log=error"], { stdio: ["ignore", "inherit", "pipe"] });
  const t1 = Date.now();
  // 拍ごとの静止画は MP4 から抜く（同じ MP4 なら同じ絵。描画をやり直さない）
  for (const s of stillFrames(list, answers))
    // -ss を -i の前に置き、その時刻へ飛んでから1コマ（フレームの中ほどの時刻で、隣のコマを取らない）
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", ((s.frame + 0.5) / 30).toFixed(4), "-i", mp4, "-frames:v", "1", join(dir, "stills", `${String(s.frame).padStart(5, "0")}-${s.id}.png`)]);
  return { render: (t1 - t0) / 1000, stills: (Date.now() - t1) / 1000 };
}

/** 本文（文型。数値は facts から。割合には件数を添える） */
function postText(answers) {
  const [, , , venue, race] = m.raceId.split("-");
  const head = `${venueLabel(Number(venue), t)}${Number(race)}R 全貌`;
  const s2 = scenes.find((x) => x.id === "scene2")?.data;
  const ov = s2 ? answers[s2.radar.overview.id]?.join("、") : null;
  const card = s2?.cards.items.find((c) => c.facts.todayRank !== null);
  let cardLine = null;
  if (card) {
    const f = card.facts;
    const diff = f.usualDiffPt === null ? "" : f.usualDiffPt < 1 ? "との差は1ポイント未満" : `より${f.usualDiffPt}ポイント${f.direction}`;
    cardLine = `1号艇の材料: ${f.item}が今日${f.todayRank}位のときの1着率${f.todayRate}%（${fmtCount(f.todayN)}件）、全体${f.usual}%（${fmtCount(f.usualN)}件）${diff}`;
  }
  return [head, ov, cardLine, "データは龍神レーダーで。", "#ボートレース"].filter(Boolean).join("\n") + "\n";
}

const [, mo, da, venueCode, raceNo] = m.raceId.split("-");
/** レース名（例「下関10R（10/19）」）。入口版の最初の問いと本文に入れる */
const raceLabel = `${venueLabel(Number(venueCode), t)}${Number(raceNo)}R（${Number(mo)}/${Number(da)}）`;
const post = postText(templateText(beats).answers);
writeFileSync(join(out, "post.txt"), post);
const flags = bannedIn(post);
if (flags.length) console.warn(`[本文の禁止表現] ${flags.join(" / ")}`);

/** 完全版の章（YouTube の自動チャプターは 0:00 から、各章10秒以上） */
const CHAPTER = { scene1: "条件", scene2: "6艇比較", scene2b: "類似レース", scene3: "軸", scene4: "展開", scene5: "相手", scene6: "機力と調子", scene8: "展示後に見るところ" };
function chapters(answers) {
  const mmss = (f) => `${Math.floor(f / 30 / 60)}:${String(Math.floor(f / 30) % 60).padStart(2, "0")}`;
  return fullPictureTimeline(scenes, answers)
    .starts.filter((x) => x.len >= 300)
    .map((x, i) => `${i === 0 ? "0:00" : mmss(x.from)} ${CHAPTER[x.id] ?? x.id}`)
    .join("\n") + "\n";
}

const modes = entryOnly ? [] : textMode === "both" ? ["template", "connected"] : [textMode];
for (const mode of modes) {
  const t0 = Date.now();
  const textPath = join(out, `text-${mode}.json`);
  let llmCalls = 0;
  const text =
    existsSync(textPath) && !regenText
      ? JSON.parse(readFileSync(textPath, "utf8"))
      : mode === "template"
        ? templateText(beats)
        : (llmCalls++, connectedText(beats));
  writeJson(textPath, text);
  const seconds = { text: (Date.now() - t0) / 1000 };
  if (mode === "connected") {
    const on = text.beats.filter((b) => b.connector).length;
    const back = text.beats.filter((b) => b.reasons).length;
    console.log(`つないだ版: ${text.beats.length}拍中 ${on}拍につなぐ語、${back}拍は検査に落ちてつなぐ語なし`);
  }
  const { total } = fullPictureTimeline(scenes, text.answers);
  if (!noVideo) {
    const dir = join(out, mode);
    mkdirSync(dir, { recursive: true });
    Object.assign(seconds, render(scenes, text.answers, dir, "full-picture"));
    console.log(`${dir}: 完全版 ${(total / 30).toFixed(1)}秒の MP4・静止画（描画 ${seconds.render.toFixed(0)}秒）`);
  }
  writeJson(join(out, `run-${mode}.json`), { seconds, llmCalls, beats: text.beats.length, videoSeconds: total / 30 });
  if (mode === "connected" || textMode === "template") writeFileSync(join(out, "chapters.txt"), chapters(text.answers));
}

// 入口版（文型の版。59秒を越えたら entryScenes が条件の2つ目を外し、それでも越えたら止める）
const entryAnswers = templateText(beats).answers;
const entry = entryScenes(scenes, entryAnswers, { race: raceLabel });
// 入口版の本文: 動画に出る数字だけ（最初の答えと結論。x-channel 2026-10-20 P1）
const stepsOf = (id) => entry.scenes.find((x) => x.id === id)?.data?.steps ?? [];
const lineOf = (s) => (s ? (entryAnswers[s.id] ?? s.lines).join("、") : null);
const postEntry = [entry.scenes[0].data.steps[0]?.question ?? raceLabel, lineOf(stepsOf("scene1")[0]), lineOf(stepsOf("conclusion")[0]), "データは龍神レーダーで。", "#ボートレース"].filter(Boolean).join("\n") + "\n";
writeFileSync(join(out, "post-entry.txt"), postEntry);
const flagsEntry = bannedIn(postEntry);
if (flagsEntry.length) console.warn(`[入口版の本文の禁止表現] ${flagsEntry.join(" / ")}`);
for (const o of entry.omitted) console.warn(`[入口版で省いた要素] ${JSON.stringify(o)}`);
writeJson(join(out, "entry.json"), { seconds: entry.total / 30, omitted: entry.omitted, scenes: entry.scenes.map((x) => ({ id: x.id, steps: x.kind === "scene2" ? ["overview", ...(x.data?.radar?.focus ?? []).map((f) => f.id)] : x.data.steps.map((s) => s.id) })) });
if (!noVideo) {
  const dir = join(out, "entry");
  mkdirSync(dir, { recursive: true });
  const seconds = render(entry.scenes, entryAnswers, dir, "entry");
  writeJson(join(out, "run-entry.json"), { seconds, llmCalls: 0, videoSeconds: entry.total / 30 });
  console.log(`${dir}: 入口版 ${(entry.total / 30).toFixed(1)}秒の MP4・静止画（描画 ${seconds.render.toFixed(0)}秒）`);
}
