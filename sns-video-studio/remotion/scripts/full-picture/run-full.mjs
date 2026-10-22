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
 *   post.txt                   完全版（YouTube）の本文。post-entry.txt は入口版（X・Shorts）の本文（動画に出る数字だけ＋このレースの URL）
 *   bundle/                    送信の道（scripts/sns/push-full-picture.js）に渡すフォルダ: bundle.json（bundle.mjs）・full-x.mp4（入口版）・
 *                              full-youtube.mp4（完全版）・shorts.mp4（入口版）。完全版と入口版の両方を描いたときだけ作る
 *   chapters.txt               完全版の章（YouTube の説明文に貼る「0:00 条件」の行。10秒未満の場面は前の章に含める）
 *   run-{版}.json・run-entry.json  かかった時間・LLM の回数・尺
 * 文の JSON は既にあれば作り直さない（--regen-text で作り直す）。同じ文の JSON なら同じ MP4。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { allBeats, checkAnswers, checkPost, connectedText, sameAsTemplate, scopeReasons, templateText } from "./scene2-text.mjs";
import { entryQuestion, entryScenes } from "./entry.mjs";
import { buildAll } from "./build-all.mjs";
import { MATERIALS_SCHEMA, validate } from "./materials-contract.mjs";
import { FULL_MIN_SECONDS, buildBundle, chaptersOk, checkBundle, raceHeader } from "./bundle.mjs";
import { MAX_BYTES as PUSH_MAX_BYTES } from "../../../../scripts/sns/push-full-picture.js";
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
// 描かずに、今ある MP4 から送信の道に渡すフォルダ（bundle/）だけを作り直す
const bundleOnly = has("--bundle-only");
// 描画の並列数（既定はコア数−1。ほかの作業と同時に回すときは小さくする）
// 完全版の画質（h264 の crf。大きいほど小さいファイル）。送信の上限 32MiB に収める（Remotion の既定 18 では 31〜35MB だった）。
// 音声は BGM だけなので 160kbps（既定の約317kbps だと容量の約36%を占めていた。visual-designer 2026-10-20 P2）
const crf = Number(opt("--crf", "23"));
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
const [, mo, da, venueCode, raceNo] = m.raceId.split("-");
// レースの見出し（例「10/22（木）児島12R 準優勝戦 締切16:44」、BOA-989）。レース名は facts の round、締切は races.start_time
const round = m.api.facts?.today?.round ?? null;
const header = raceHeader({ year: Number(m.raceId.slice(0, 4)), month: Number(mo), day: Number(da), venue: venueLabel(Number(venueCode), t), raceNo: Number(raceNo), round, deadline: m.race?.startTime ?? null });
// 完全版の冒頭の場面（場面1の会場の1着率の問い）にも見出しを出す。入口版の entryScenes と同じく s1-venue90 だけを書き換える
// （会場の集計が無い日に風・水面の頁へ「1号艇は堅い？」を付けない）
{
  const venue90 = scenes.find((x) => x.id === "scene1")?.data?.steps?.find((st) => st.id === "s1-venue90");
  if (venue90) venue90.question = entryQuestion(header);
}
const omitted = scenes.flatMap((x) => (x.data?.omitted ?? []).map((o) => ({ scene: x.id, ...o })));
writeJson(join(out, "scenes.json"), { raceId: m.raceId, materialsVersion: m.schemaVersion, missing: m.missing, omitted, scenes });
for (const o of omitted) console.warn(`[省いた要素] ${JSON.stringify(o)}`);
// 省略禁止の場面（場面4 展開）の材料が無ければ止める（2026-10-20 オーケストレーター）
{
  const must = omitted.filter((x) => x.mustReport);
  if (must.length) {
    console.error(`省略禁止の場面の材料が無いので止める:\n${must.map((o) => `${o.scene}: ${o.reason}`).join("\n")}`);
    process.exit(1);
  }
}
// BGM はレースごとの名前で置く（並行して回しても別のレースの BGM が入らない）
const bgmName = `full-picture/bgm-${m.raceId}.mp3`;
if (bgm) {
  mkdirSync("public/full-picture", { recursive: true });
  copyFileSync(bgm, join("public", bgmName));
}
/** 止める（終了コード1）。文・本文が検査に落ちたら描かない・本文を出さない */
const stop = (what, why) => {
  console.error(`${what}が検査に落ちたので止める:\n${why.slice(0, 20).join("\n")}`);
  process.exit(1);
};
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
/** 送信の上限（送信の道の決まりをそのまま使う） */
const MAX_BYTES = Math.min(PUSH_MAX_BYTES.x, PUSH_MAX_BYTES.youtube);
const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration,size", "-of", "json", file], { encoding: "utf8" }));
  return { width: j.streams?.[0]?.width, height: j.streams?.[0]?.height, seconds: Number(j.format?.duration), bytes: Number(j.format?.size) };
};
function render(list, answers, dir, name) {
  const props = { scenes: list, answers, ...(bgm ? { bgm: bgmName } : {}) };
  const propsPath = join(dir, `props-${name}.json`);
  writeJson(propsPath, props);
  // 前の書き出しの静止画を残さない（拍の長さが変わるとフレーム番号が変わり、古い静止画が混ざっていた）
  rmSync(join(dir, "stills"), { recursive: true, force: true });
  mkdirSync(join(dir, "stills"), { recursive: true });
  const t0 = Date.now();
  const mp4 = join(dir, `${name}.mp4`);
  execFileSync("npx", ["remotion", "render", "src/index.jsx", "FullPicture", mp4, "--codec=h264", `--crf=${crf}`, "--audio-bitrate=160k", `--concurrency=${concurrency}`, `--props=${propsPath}`, "--log=error"], { stdio: ["ignore", "inherit", "pipe"] });
  // 上限を越えたら画質を1段下げて作り直す（映像だけ。音はそのまま）。それでも越えたら止める
  if (probe(mp4).bytes > MAX_BYTES) {
    const tmp = join(dir, `${name}.reencode.mp4`);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp4, "-c:v", "libx264", "-crf", String(crf + 5), "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp]);
    copyFileSync(tmp, mp4);
    rmSync(tmp);
    if (probe(mp4).bytes > MAX_BYTES) stop(`${name}.mp4 の大きさ`, [`${probe(mp4).bytes} バイトが上限 ${MAX_BYTES} を越える`]);
  }
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
    const diff = f.usualDiffPt === null ? "" : f.usualDiffPt < 1 ? "との差は1ポイント未満" : `より${f.usualDiffPt.toFixed(1)}ポイント${f.direction}`;
    cardLine = `1号艇の材料: ${f.item}が今日${f.todayRank}位のときの1着率${f.todayRate}%（${fmtCount(f.todayN)}件）、同じ級別の1号艇${f.usual}%（${fmtCount(f.usualN)}件）${diff}`;
  }
  return [head, ov, cardLine, "データは龍神レーダーで。", "#ボートレース"].filter(Boolean).join("\n") + "\n";
}

const templateAnswers = templateText(beats).answers;
{
  // 数字の範囲（個人か集計か）が分からない答えは止める（hq の型の正本 2026-10-20）
  const why = [...checkAnswers(templateAnswers), ...beats.flatMap((b) => scopeReasons(b.template, b.facts).map((w) => `${b.id}: ${w}`))];
  if (why.length) stop("文型の文", why);
}
const post = postText(templateAnswers);
if (checkPost(post).length) stop("本文", checkPost(post));
writeFileSync(join(out, "post.txt"), post);

/** 完全版の章（YouTube の自動チャプターは 0:00 から、各章10秒以上） */
const CHAPTER = { scene1: "条件", scene2: "6艇比較", scene2b: "類似レース", scene3: "軸", scene4: "展開", scene5: "相手", scene6: "機力と調子", scene8: "展示後に見るところ" };
function chapters(answers) {
  const mmss = (f) => `${Math.floor(f / 30 / 60)}:${String(Math.floor(f / 30) % 60).padStart(2, "0")}`;
  return fullPictureTimeline(scenes, answers)
    .starts.filter((x) => x.len >= 300)
    .map((x, i) => `${i === 0 ? "0:00" : mmss(x.from)} ${CHAPTER[x.id] ?? x.id}`)
    .join("\n") + "\n";
}

// 入口版（文型の版。59秒を越えたら entryScenes が条件の2つ目を外し、それでも越えたら止める）。描く前に文を確かめる
const entryAnswers = templateAnswers;
const entry = entryScenes(scenes, entryAnswers, { race: header });
const entryStepAnswers = Object.fromEntries(entry.scenes.flatMap((x) => (x.kind === "step" ? x.data.steps.map((s) => [s.id, entryAnswers[s.id] ?? s.lines]) : [])));
/** 送信の道に渡す文（題名・説明文・X の本文）。数値は場面の facts（字幕と同じ値）から */
const factsOf = (sceneId, stepId) => scenes.find((x) => x.id === sceneId)?.data?.steps?.find((st) => st.id === stepId)?.facts ?? null;
const bundleText = (qa, chaptersText = chapters(entryAnswers), fullSeconds = fullPictureTimeline(scenes, entryAnswers).total / 30) =>
  buildBundle({
    raceId: m.raceId,
    venue: venueLabel(Number(venueCode), t),
    raceNo: Number(raceNo),
    month: Number(mo),
    day: Number(da),
    round,
    grade: m.race?.grade ?? null,
    deadline: m.race?.startTime ?? null,
    facts: {
      venue90: factsOf("scene1", "s1-venue90"),
      overview: scenes.find((x) => x.id === "scene2")?.data?.radar?.overview?.facts ?? null,
      conclusion: scenes.find((x) => x.id === "scene4")?.data?.conclusion?.facts ?? null,
    },
    chapters: chaptersText,
    fullSeconds,
    qa,
  });
const preBundle = bundleText({});
const postEntry = `${preBundle.x_text}\n`;
{
  const b = preBundle;
  const why = [...checkPost(postEntry), ...checkAnswers(entryStepAnswers), ...[b.youtube_full.title, b.youtube_full.description, b.youtube_shorts.title, b.youtube_shorts.description].flatMap(checkPost)];
  if (why.length) stop("入口版の文・本文・題名・説明文", why);
}
writeFileSync(join(out, "post-entry.txt"), postEntry);

const modes = entryOnly || bundleOnly ? [] : textMode === "both" ? ["template", "connected"] : [textMode];
for (const mode of modes) {
  const t0 = Date.now();
  const textPath = join(out, `text-${mode}.json`);
  let llmCalls = 0;
  // 文の JSON は同じレース・同じ文型のときだけ使い回す（別のレースの答えを重ねない）
  const saved = existsSync(textPath) && !regenText ? JSON.parse(readFileSync(textPath, "utf8")) : null;
  const reusable = saved && saved.raceId === m.raceId && !saved.llmError && beats.every((b) => sameAsTemplate(saved.answers?.[b.id], b.template));
  if (saved && !reusable) console.warn(`[文の JSON を作り直す] ${textPath} はこの材料（${m.raceId}）の文と合わない`);
  const text = reusable
    ? saved
    : { raceId: m.raceId, ...(mode === "template" ? templateText(beats) : (llmCalls++, connectedText(beats))) };
  {
    const why = checkAnswers(text.answers);
    if (why.length) stop(`文（${mode}）`, why);
  }
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
  // LLM のトークン（呼んだときだけ。使い回した文の JSON なら0回）
  const llm = llmCalls ? (text.llm ?? { calls: 1, tokens_in: null, tokens_out: null }) : { calls: 0, tokens_in: 0, tokens_out: 0 };
  writeJson(join(out, `run-${mode}.json`), { seconds, llmCalls, llm, beats: text.beats.length, videoSeconds: total / 30 });
  if (mode === "connected" || textMode === "template") writeFileSync(join(out, "chapters.txt"), chapters(text.answers));
}

for (const o of entry.omitted) console.warn(`[入口版で省いた要素] ${JSON.stringify(o)}`);
writeJson(join(out, "entry.json"), { seconds: entry.total / 30, omitted: entry.omitted, scenes: entry.scenes.map((x) => ({ id: x.id, steps: x.kind === "scene2" ? ["overview", ...(x.data?.radar?.focus ?? []).map((f) => f.id)] : x.data.steps.map((s) => s.id) })) });
if (!noVideo && !bundleOnly) {
  const dir = join(out, "entry");
  mkdirSync(dir, { recursive: true });
  const seconds = render(entry.scenes, entryAnswers, dir, "entry");
  writeJson(join(out, "run-entry.json"), { seconds, llmCalls: 0, videoSeconds: entry.total / 30 });
  console.log(`${dir}: 入口版 ${(entry.total / 30).toFixed(1)}秒の MP4・静止画（描画 ${seconds.render.toFixed(0)}秒）`);
}

// 送信の道に渡すフォルダ（完全版と入口版の両方があるときだけ）。機械の検査が全部通ったときだけ作る
// 完全版はこの実行の版のもの（古い版の MP4 を入れない。代わりの審査 P2）
const fullMp4 = join(out, textMode === "both" ? "connected" : textMode, "full-picture.mp4");
const entryMp4 = join(out, "entry", "entry.mp4");
if (!noVideo && existsSync(fullMp4) && existsSync(entryMp4)) {
  const f = probe(fullMp4);
  const e = probe(entryMp4);
  const qa = {
    contract: true,
    text: true,
    post: true,
    entry_max59s: entry.total <= 59 * 30,
    full_size: f.bytes <= MAX_BYTES,
    shorts_vertical: e.width === 1080 && e.height === 1920,
    shorts_max_60s: e.seconds <= 60,
    shorts_size: e.bytes <= MAX_BYTES,
    // 縦で3分以下は Shorts になる。完全版は通常の動画で出す（youtube-channel 2026-10-20 P1）
    full_min185s: f.seconds >= FULL_MIN_SECONDS,
  };
  // 章は描いた完全版の拍の並びのもの（つないだ版はつなぐ語の分だけ長さが変わる）。実ファイルの尺で自動チャプターの条件を見る
  const chaptersPath = join(out, "chapters.txt");
  const chaptersText = existsSync(chaptersPath) ? readFileSync(chaptersPath, "utf8") : chapters(entryAnswers);
  qa.chapters = chaptersOk(chaptersText, f.seconds);
  const b = bundleText(qa, chaptersText, f.seconds);
  const why = checkBundle(b);
  if (why.length) stop("bundle", why);
  const dir = join(out, "bundle");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "bundle.json"), b);
  copyFileSync(entryMp4, join(dir, "full-x.mp4"));
  copyFileSync(fullMp4, join(dir, "full-youtube.mp4"));
  copyFileSync(entryMp4, join(dir, "shorts.mp4"));
  // X と Shorts は同じ入口版（同じバイト列）。送信側は中身を解析しないので、作り手が確かめる（送信レーン 2026-10-20、x-channel P2）
  const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sha(join(dir, "full-x.mp4")) !== sha(join(dir, "shorts.mp4"))) stop("bundle", ["full-x.mp4 と shorts.mp4 の中身が違う"]);
  console.log(`${dir}: bundle.json と動画3本（完全版 ${(f.bytes / 1048576).toFixed(1)}MiB・入口版 ${(e.bytes / 1048576).toFixed(1)}MiB）`);
}
