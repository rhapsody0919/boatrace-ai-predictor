/**
 * 型 s02-loss-breakdown-card の試作（関門の段4）。毎日の実行の出力（run-full の出力ディレクトリ）の shorts.mp4 は書き出し直さず、
 * 冒頭に札（1.5秒）をつなぎ、答えの頁と着順の流れの場面に重ねの画像を載せる（ffmpeg）。題・X の本文も型の文に替える。
 * 台本: docs/design/full-picture-type-gate/candidates/s02-loss-breakdown-card/script.md
 *
 * 使い方（sns-video-studio/remotion で）:
 *   node scripts/full-picture/prototype-s02.mjs <run-full の出力ディレクトリ> <出力ディレクトリ>
 * 出力: shorts-s02.mp4・card.png・overlay-*.png・frames/*.png（確認用のコマ）・s02.json（数字・題・本文・検査）
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { S02_CARD_SECONDS, S02_CHIPS_UNTIL, S02_QUESTION_UNTIL, s02Check, s02Facts, s02Text } from "./s02.mjs";
import { fullPictureTimeline } from "../../src/fullPicture/fullPictureTimeline.js";

const [runDir, outArg] = process.argv.slice(2);
if (!runDir || !outArg) {
  console.error("使い方: node scripts/full-picture/prototype-s02.mjs <run-full の出力ディレクトリ> <出力ディレクトリ>");
  process.exit(1);
}
const out = resolve(outArg);
mkdirSync(join(out, "frames"), { recursive: true });
const read = (p) => JSON.parse(readFileSync(join(runDir, p), "utf8"));

const m = read("materials.json");
const bundle = read("bundle/bundle.json");
const props = read("entry/props-entry.json");
const f = s02Facts(m.api.scenario?.scenario);
if (!f.ok) {
  console.error(`作らない: type_unsupported:${f.kind}（${f.reason}）`);
  process.exit(3);
}
const head = bundle.youtube_shorts.title.match(/^(.+?)（(\d+\/\d+)）/);
if (!head) throw new Error(`Shorts の題からレース名と日付を読めない: ${bundle.youtube_shorts.title}`);
const url = bundle.x_text.match(/https:\/\/\S+/)?.[0];
if (!url) throw new Error("X の本文に URL が無い");
const tx = s02Text(f, { race: head[1], date: head[2], deadline: bundle.x_text.match(/締切(\d+:\d+)/)?.[1] ?? null, url });

const shorts = join(runDir, "bundle/shorts.mp4");
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", shorts], { encoding: "utf8" }));
const seconds = dur + S02_CARD_SECONDS;
const why = s02Check(f, tx, seconds);
if (why.length) {
  console.error(`検査で止めた:\n- ${why.join("\n- ")}`);
  process.exit(2);
}

// 着順の流れの場面（入口版の conclusion）の秒。札の分だけ後ろにずれる
const tl = fullPictureTimeline(props.scenes, props.answers);
const conc = tl.starts.find((s) => s.id === "conclusion");
if (!conc) throw new Error("入口版に着順の流れの場面（conclusion）が無い");
const concFrom = conc.from / 30 + S02_CARD_SECONDS;
const concTo = (conc.from + conc.len) / 30 + S02_CARD_SECONDS;

const still = (id, file, p) =>
  execFileSync("npx", ["remotion", "still", "src/index.jsx", id, join(out, file), `--props=${JSON.stringify(p)}`, "--image-format=png"], { stdio: "inherit" });
still("S02Card", "card.png", tx.card);
still("S02Overlay", "overlay-question.png", { question: tx.card.lines.at(-1), chips: tx.chips });
still("S02Overlay", "overlay-chips.png", { chips: tx.chips });

// 札（静止 1.5秒・無音）＋ shorts.mp4。重ね: 1.5〜3.5秒は問いと件数の札、3.5〜8秒は件数の札、着順の流れの場面も件数の札
const C = S02_CARD_SECONDS;
execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-loop", "1", "-framerate", "30", "-t", String(C), "-i", join(out, "card.png"),
    "-i", shorts,
    "-i", join(out, "overlay-question.png"),
    "-i", join(out, "overlay-chips.png"),
    "-f", "lavfi", "-t", String(C), "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex",
    [
      "[0:v]scale=1080:1920,setsar=1,format=yuv420p[c]",
      "[1:v]setsar=1,format=yuv420p[b]",
      "[c][4:a][b][1:a]concat=n=2:v=1:a=1[v0][a]",
      `[v0][2:v]overlay=0:0:enable='between(t,${C},${S02_QUESTION_UNTIL})'[v1]`,
      `[v1][3:v]overlay=0:0:enable='between(t,${S02_QUESTION_UNTIL},${S02_CHIPS_UNTIL})+between(t,${concFrom.toFixed(2)},${concTo.toFixed(2)})'[v]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k",
    join(out, "shorts-s02.mp4"),
  ],
  { stdio: "inherit" },
);

// 確認用のコマ（札・問い・件数の札・着順の流れ）
const frames = { "0-card": 0.7, "1-question": 2.5, "2-chips": 6, "3-flow": concFrom + 1.5 };
for (const [name, t] of Object.entries(frames))
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", join(out, "shorts-s02.mp4"), "-frames:v", "1", join(out, "frames", `${name}.png`)]);

writeFileSync(
  join(out, "s02.json"),
  JSON.stringify({ runDir: resolve(runDir), facts: f, text: tx, seconds: Math.round(seconds * 10) / 10, conclusion: [concFrom, concTo], check: why }, null, 1),
);
console.log(`s02: ${join(out, "shorts-s02.mp4")}（${seconds.toFixed(1)}秒）`);
