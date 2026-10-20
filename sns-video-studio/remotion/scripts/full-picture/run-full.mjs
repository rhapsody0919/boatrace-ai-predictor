/**
 * 全貌動画の毎日の実行（1本のコマンド）。材料 JSON 1つ → 全場面の文の JSON・MP4（全場面を1本に）・拍ごとの静止画・本文。
 * 龍神の鍵は要らない（鍵が要るのは材料の取得 fetch-materials.mjs だけ）。整えた版の LLM はログイン済みの claude（1レース1回）。
 *
 * 使い方（sns-video-studio/remotion で）:
 *   node scripts/full-picture/run-full.mjs <材料.json> <出力ディレクトリ> [--text template|polished|both] [--bgm <mp3>] [--regen-text]
 * 出力:
 *   scenes.json                全場面の描く値と拍ごとの facts（コードが計算した比較）、omitted（省いた要素）
 *   text-{版}.json             答えの文（拍ごと。整えた版は文型の版に戻した拍と理由も）
 *   {版}/full-picture.mp4      全場面の MP4
 *   {版}/stills/*.png          拍ごとの静止画（MP4 から、答えが出て1秒後のコマ）
 *   post-{版}.txt              本文
 *   run-{版}.json              かかった時間・LLM の回数
 * 文の JSON は既にあれば作り直さない（--regen-text で作り直す）。同じ文の JSON なら同じ MP4。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { buildScene2, t } from "./scene2-data.mjs";
import { allBeats, bannedIn, polishedText, templateText } from "./scene2-text.mjs";
import { buildScene1 } from "./scenes/scene1.mjs";
import { buildScene2b } from "./scenes/scene2b.mjs";
import { buildScene3 } from "./scenes/scene3.mjs";
import { buildScene4 } from "./scenes/scene4.mjs";
import { buildScene5 } from "./scenes/scene5.mjs";
import { buildScene6 } from "./scenes/scene6.mjs";
import { buildScene8 } from "./scenes/scene8.mjs";
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
const textMode = opt("--text", "both");
const bgm = opt("--bgm");
const regenText = has("--regen-text");
// 描画の並列数（既定はコア数−1。ほかの作業と同時に回すときは小さくする）
const concurrency = opt("--concurrency", String(Math.max(1, (await import("node:os")).cpus().length - 1)));
const [input, outDir] = args;
if (!input || !outDir || !["template", "polished", "both"].includes(textMode)) {
  console.error("使い方: node run-full.mjs <材料.json> <出力ディレクトリ> [--text template|polished|both] [--bgm <mp3>] [--regen-text]");
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** 材料 → 全場面（型の並び） */
export function buildAll(m) {
  const s2 = m.api.facts ? buildScene2(m.api.facts) : null;
  return [
    { id: "scene1", kind: "step", data: buildScene1(m) },
    { id: "scene2", kind: "scene2", data: s2 },
    { id: "scene2b", kind: "step", data: buildScene2b(m) },
    { id: "scene3", kind: "step", data: buildScene3(m) },
    { id: "scene4", kind: "step", data: buildScene4(m) },
    { id: "scene5", kind: "step", data: buildScene5(m) },
    { id: "scene6", kind: "step", data: buildScene6(m) },
    { id: "scene8", kind: "step", data: buildScene8(m) },
  ];
}

const m = JSON.parse(readFileSync(input, "utf8"));
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
function stillFrames() {
  const { starts } = fullPictureTimeline(scenes);
  const out = [];
  scenes.forEach((x, i) => {
    const base = starts[i].from;
    if (!starts[i].len) return;
    if (x.kind === "scene2") {
      for (const b of scene2Timeline(x.data).beats) {
        if (b.kind === "toCards") continue;
        const at = b.kind === "overview" ? OVERVIEW_ANSWER_AT : b.kind === "focus" ? ANSWER_AT : b.kind === "card" ? cardAnswerAt(b.index) : 20;
        const id = b.kind === "overview" ? "overview" : b.kind === "focus" ? x.data.radar.focus[b.index].id : b.kind === "card" ? x.data.cards.items[b.index].id : "empty";
        out.push({ frame: base + b.from + Math.min(at + 30, b.len - 1), id: `scene2-${id}` });
      }
    } else {
      stepTimeline(x.data).beats.forEach((b) => {
        const s = x.data.steps[b.index];
        out.push({ frame: base + b.from + Math.min(b.times.answer + 30, b.len - 1), id: s.id });
      });
    }
  });
  return out;
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

const modes = textMode === "both" ? ["template", "polished"] : [textMode];
for (const mode of modes) {
  const t0 = Date.now();
  const textPath = join(out, `text-${mode}.json`);
  let llmCalls = 0;
  const text =
    existsSync(textPath) && !regenText
      ? JSON.parse(readFileSync(textPath, "utf8"))
      : mode === "template"
        ? templateText(beats)
        : (llmCalls++, polishedText(beats));
  writeJson(textPath, text);
  const t1 = Date.now();
  const back = text.beats.filter((b) => b.reasons);
  if (mode === "polished") console.log(`整えた版: ${text.beats.length}拍中 ${back.length}拍を文型の版に戻した`);
  const post = postText(text.answers);
  writeFileSync(join(out, `post-${mode}.txt`), post);
  const flags = bannedIn(post);
  if (flags.length) console.warn(`[本文の禁止表現] ${mode}: ${flags.join(" / ")}`);

  const props = { scenes, answers: text.answers, ...(bgm ? { bgm: "full-picture/bgm.mp3" } : {}) };
  const propsPath = join(out, `props-${mode}.json`);
  writeJson(propsPath, props);
  const dir = join(out, mode);
  mkdirSync(join(dir, "stills"), { recursive: true });
  const mp4 = join(dir, "full-picture.mp4");
  execFileSync("npx", ["remotion", "render", "src/index.jsx", "FullPicture", mp4, "--codec=h264", `--concurrency=${concurrency}`, `--props=${propsPath}`, "--log=error"], { stdio: ["ignore", "inherit", "pipe"] });
  const t2 = Date.now();
  // 拍ごとの静止画は MP4 から抜く（同じ MP4 なら同じ絵。描画をやり直さない）
  for (const s of stillFrames())
    // -ss を -i の前に置き、その時刻へ飛んでから1コマ（フレームの中ほどの時刻で、隣のコマを取らない）
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", ((s.frame + 0.5) / 30).toFixed(4), "-i", mp4, "-frames:v", "1", join(dir, "stills", `${String(s.frame).padStart(5, "0")}-${s.id}.png`)]);
  const t3 = Date.now();
  const { total } = fullPictureTimeline(scenes);
  writeJson(join(out, `run-${mode}.json`), {
    seconds: { text: (t1 - t0) / 1000, render: (t2 - t1) / 1000, stills: (t3 - t2) / 1000, total: (t3 - t0) / 1000 },
    llmCalls,
    beats: text.beats.length,
    backToTemplate: back.length,
    videoSeconds: total / 30,
  });
  console.log(`${dir}: ${(total / 30).toFixed(1)}秒の MP4・静止画（${((t3 - t0) / 1000).toFixed(0)}秒かかった）`);
}
