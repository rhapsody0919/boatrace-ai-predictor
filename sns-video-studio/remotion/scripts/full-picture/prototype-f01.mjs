/**
 * 型 f01-landscape-voice-full の試作（関門の段4）。作るのは f01-build.mjs（毎日の実行では run-full.mjs が --type-spec で呼ぶ）。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md
 *
 * 使い方（sns-video-studio/remotion で。ローカルの VOICEVOX engine が要る）:
 *   node scripts/full-picture/prototype-f01.mjs <材料.json> <出力ディレクトリ> [--bgm <mp3>]
 * 出力: f01.mp4・thumb.png・f01.json（台本・時間・検査・撮った画面の文字の大きさ）・description.txt・sheet.png（章ごとのコマの一覧）
 * 作れない・検査で落ちたら終了コード 2（MP4 は作らない）
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { buildF01 } from "./f01-build.mjs";

const args = process.argv.slice(2);
const bi = args.indexOf("--bgm");
const bgm = bi >= 0 ? args.splice(bi, 2)[1] : null;
const [matPath, outArg] = args;
if (!matPath || !outArg) {
  console.error("使い方: node scripts/full-picture/prototype-f01.mjs <材料.json> <出力ディレクトリ> [--bgm <mp3>]");
  process.exit(1);
}
const r = await buildF01(JSON.parse(readFileSync(matPath, "utf8")), resolve(outArg), { bgm, sheet: true });
if (r.reasons.length) {
  console.error(`作らない: ${r.reasons.join(", ")}（${r.detail}）`);
  process.exit(2);
}
console.log(`完了: ${r.mp4}（${r.seconds.toFixed(1)}秒）・${r.thumb}`);
