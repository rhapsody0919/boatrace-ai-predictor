/**
 * 全貌動画（試作: 場面2）の毎日の実行を1本にしたコマンド。入力の JSON 1つ → 文の JSON・MP4・拍ごとの静止画・本文。
 * 龍神の鍵は要らない（鍵が要るのは材料＝/api/analogy/facts の応答の取得だけ）。整えた版の LLM はログイン済みの claude を使う。
 *
 * 使い方（sns-video-studio/remotion で）:
 *   node scripts/full-picture/run.mjs <材料.json> <出力ディレクトリ> [--text template|polished|both] [--bgm <mp3>] [--no-video] [--regen-text]
 *
 * 出力:
 *   scene2.json                材料（描く値と拍ごとの facts＝コードが計算した比較）
 *   text-{版}.json             答えの文（拍ごと。整えた版は検査に落ちて文型に戻した拍と理由も）
 *   {版}/scene2.mp4, {版}/stills/*.png
 *   post-{版}.txt              本文
 * 文の JSON は既にあれば作り直さない（--regen-text で作り直す）。同じ文の JSON なら同じ MP4 になる。
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildScene2, t } from "./scene2-data.mjs";
import { bannedIn, lineWidth, MAX_WIDTH, polishedText, templateText } from "./scene2-text.mjs";
import { ANSWER_AT, scene2Timeline } from "../../src/fullPicture/scene2Timeline.js";
import { fmtCount, venueLabel } from "../../../../src/utils/analogyFormat.js";

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
const noVideo = has("--no-video");
const regenText = has("--regen-text");
const [input, outDir] = args;
if (!input || !outDir || !["template", "polished", "both"].includes(textMode)) {
  console.error("使い方: node run.mjs <材料.json> <出力ディレクトリ> [--text template|polished|both] [--bgm <mp3>] [--no-video] [--regen-text]");
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const scene = buildScene2(JSON.parse(readFileSync(input, "utf8")));
writeJson(join(out, "scene2.json"), scene);
for (const o of scene.omitted) console.warn(`[省いた要素] ${JSON.stringify(o)}`);
if (bgm) {
  // BGM はリポジトリに入れない（public/full-picture/ は .gitignore）
  mkdirSync("public/full-picture", { recursive: true });
  copyFileSync(bgm, "public/full-picture/bgm.mp3");
}

/** 本文（文型。数値は facts から。割合には件数を添える） */
function postText(answers) {
  const [, , , venue, race] = scene.race.raceId.split("-");
  const head = `${venueLabel(Number(venue), t)}${Number(race)}R 6艇比較`;
  const ov = answers[scene.radar.overview.id].join("、");
  // 今日の順位が当てはまるカード（優勝戦・準優勝戦の日の今節の着順点は今日の位置が無い）
  const card = scene.cards.items.find((c) => c.facts.todayRank !== null);
  let cardLine;
  if (card) {
    const f = card.facts;
    const diff =
      f.usualDiffPt === null ? "" : f.usualDiffPt < 1 ? "との差は1ポイント未満" : `より${f.usualDiffPt}ポイント${f.direction}`;
    cardLine = `1号艇の材料: ${f.item}が今日${f.todayRank}位のときの1着率${f.todayRate}%（${fmtCount(f.todayN)}件）、全体${f.usual}%（${fmtCount(f.usualN)}件）${diff}`;
  } else if (scene.cards.items.length) cardLine = `1号艇の材料: ${scene.cards.items.map((c) => c.facts.item).join("・")}で差が大きい`;
  else cardLine = answers[scene.cards.empty.id].join("、");
  return `${head}\n${ov}\n${cardLine}\nデータは龍神レーダーで。\n#ボートレース\n`;
}

const modes = textMode === "both" ? ["template", "polished"] : [textMode];
for (const mode of modes) {
  const textPath = join(out, `text-${mode}.json`);
  const text =
    existsSync(textPath) && !regenText
      ? JSON.parse(readFileSync(textPath, "utf8"))
      : mode === "template"
        ? templateText(scene)
        : polishedText(scene);
  writeJson(textPath, text);
  const back = text.beats.filter((b) => b.reasons);
  if (mode === "polished")
    console.log(`整えた版: ${text.beats.length}拍中 ${back.length}拍を文型の版に戻した`);
  const post = postText(text.answers);
  writeFileSync(join(out, `post-${mode}.txt`), post);
  // 本文も字幕と同じ禁止表現の判定（risk-rules.json）。送る前の関門は hq 側。ここでは記録して知らせる
  const flags = bannedIn(post);
  if (flags.length) console.warn(`[本文の禁止表現] ${mode}: ${flags.join(" / ")}`);
  // 文型の版の幅（下限が上限を越えていないか）
  for (const b of templateText(scene).beats)
    for (const l of b.lines) if (lineWidth(l) > MAX_WIDTH) console.warn(`[文型の幅] ${b.id}: ${l}（全角${lineWidth(l).toFixed(1)}字分）`);

  const props = { ...scene, answers: text.answers, ...(bgm ? { bgm: "full-picture/bgm.mp3" } : {}) };
  const propsPath = join(out, `props-${mode}.json`);
  writeJson(propsPath, props);
  const dir = join(out, mode);
  mkdirSync(join(dir, "stills"), { recursive: true });
  const remotion = (...a) =>
    execFileSync("npx", ["remotion", ...a, `--props=${propsPath}`, "--log=error"], { stdio: ["ignore", "inherit", "pipe"] });
  // 拍ごとの静止画: 答えが出てから1秒後
  const { beats } = scene2Timeline(scene);
  for (const b of beats.filter((x) => x.kind !== "toCards")) {
    const id = b.kind === "overview" ? "overview" : b.kind === "focus" ? scene.radar.focus[b.index].id : b.kind === "card" ? scene.cards.items[b.index].id : "empty";
    const frame = b.from + (b.kind === "card" ? 18 + 15 + 14 : ANSWER_AT) + 30;
    remotion("still", "src/index.jsx", "FullPictureScene2", join(dir, "stills", `${String(b.from).padStart(4, "0")}-${id}.png`), `--frame=${frame}`);
  }
  if (!noVideo) remotion("render", "src/index.jsx", "FullPictureScene2", join(dir, "scene2.mp4"), "--codec=h264");
  console.log(`${dir}: ${noVideo ? "静止画" : "MP4・静止画"}`);
}
