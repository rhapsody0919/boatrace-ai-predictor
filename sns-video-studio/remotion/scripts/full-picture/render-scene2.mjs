/**
 * 全貌動画 場面2（試作）を facts.json から書き出す: 材料 JSON・MP4・拍ごとの静止画。
 * 使い方（sns-video-studio/remotion で）:
 *   node scripts/full-picture/render-scene2.mjs <facts.json> <出力ディレクトリ> [--bgm <mp3>] [--no-video]
 * 同じ入力なら同じ出力（材料は scene2-data.mjs の純粋関数、描画は Remotion の決まった手順）。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildScene2 } from "./scene2-data.mjs";
import { scene2Timeline, ANSWER_AT } from "../../src/fullPicture/scene2Timeline.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const noVideo = args.includes("--no-video");
const bgm = flag("--bgm");
const [input, outDir] = args.filter((a) => a !== "--no-video");
if (!input || !outDir) {
  console.error("使い方: node render-scene2.mjs <facts.json> <出力ディレクトリ> [--bgm <mp3>] [--no-video]");
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(join(out, "stills"), { recursive: true });

const scene = buildScene2(JSON.parse(readFileSync(input, "utf8")));
if (bgm) {
  // BGM はリポジトリに入れない（public/full-picture/ は .gitignore）
  mkdirSync("public/full-picture", { recursive: true });
  copyFileSync(bgm, "public/full-picture/bgm.mp3");
  scene.bgm = "full-picture/bgm.mp3";
}
const propsPath = join(out, "scene2.json");
writeFileSync(propsPath, `${JSON.stringify(scene, null, 2)}\n`);
for (const o of scene.omitted) console.warn(`[省いた要素] ${JSON.stringify(o)}`);

const remotion = (...a) =>
  execFileSync("npx", ["remotion", ...a, `--props=${propsPath}`, "--log=error"], { stdio: "inherit" });

// 拍ごとの静止画: 答えが出てから1秒後
const { beats } = scene2Timeline(scene);
const pick = beats.filter((b) => b.kind !== "toCards");
const stills = pick.map((b) => ({
  name: `${String(b.from).padStart(4, "0")}-${b.kind}${b.kind === "focus" ? `-boat${scene.radar.focus[b.index].boat}` : b.kind === "card" ? `-${scene.cards.items[b.index].key}` : ""}.png`,
  frame: b.from + (b.kind === "card" ? 18 + 15 + 14 : ANSWER_AT) + 30,
}));
for (const s of stills)
  remotion("still", "src/index.jsx", "FullPictureScene2", join(out, "stills", s.name), `--frame=${s.frame}`);
if (!noVideo)
  remotion("render", "src/index.jsx", "FullPictureScene2", join(out, "scene2.mp4"), "--codec=h264");
console.log(`${out}: 静止画${stills.length}枚${noVideo ? "" : "・scene2.mp4"}・省いた要素${scene.omitted.length}件`);
