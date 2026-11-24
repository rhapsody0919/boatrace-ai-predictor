#!/usr/bin/env node
/**
 * verify-pr-size.js - PR の大きさ（300行・5ファイル）の数え方（scripts/maintenance/prSize.js・prSizeGit.js、BOA-1718）を、
 * 実の履歴のコミットで確かめ、この PR の数を出す。
 *
 * 作り手が自分で数えて置き場の決まりを曲げた（#3304 とその前の #3303 で、src/pure に置かない・訳のキーを流用・注釈を削る）ので、
 * 数え方を機械に移した。数えない物は prSize.js の頭の注釈。超えても落とさない（オーナー 2026-11-24 の (ii)、
 * 超えた PR を重い道に回すのは pr-lane）。この verify は試験が落ちたときだけ落ち、この PR の数は表示するだけ。
 * 純関数の場面は verify-pr-size-rules.js・verify-pr-size-mutation.js。
 *
 * 確かめること（実の履歴。git の木を作らず、作業場所に書かない）:
 *   1. #3304（3fa222c70）と #3303（1069770b5）は線の中で、新しい spec を数えない
 *   2. 移すだけ（split-data-layer.mjs の RA10〜RA13 の5本）は線の外。例外を外すと線を超える（例外が効いている）
 *   3. 記事の PR: #3313（442432b57）は check-content-pr.js が通す。418行の記事 d15c76bdf（manifest の契約より前）は通さず、数えて超える
 *   4. 改名（-M）: #2819（2dd78794b）の weatherInfo.js の改名と書き換えは、新しいパスで書き換えた行だけを数える
 *   5. この PR（merge-base から HEAD）の数を出す
 *
 * 使い方: node scripts/maintenance/verify-pr-size.js --base=origin/master
 *   base や上のコミットを読めない場合、CI（環境変数 CI）では失敗、手元ではスキップする。
 */
import { SIZE_LIMIT, measurePrSize } from "./prSize.js";
import { isContentPr, measureCommits, readCommits } from "./prSizeGit.js";

const ROOT = new URL("../..", import.meta.url).pathname;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const skipOrFail = (message) => {
  if (process.env.CI) {
    failures += 1;
    console.error(`❌ ${message}`);
  } else console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
};

/** 実のコミット sha を、親から数える。読めなければ null（手元はスキップ、CI は失敗） */
const measured = (sha) => {
  try {
    return measureCommits(ROOT, `${sha}^`, sha);
  } catch (err) {
    skipOrFail(`${sha} を読めない: ${String(err.message).split("\n")[0]}`);
    return null;
  }
};

// ---- 1. #3304 と #3303（作り手が線に合わせて置き場を曲げた PR） ----
for (const [pr, sha, spec] of [
  ["#3304", "3fa222c70", "e2e/venue-race-block.spec.js"],
  ["#3303", "1069770b5", "e2e/venue-meet-heading.spec.js"],
]) {
  const r = measured(sha);
  if (r)
    check(
      `実の差分: ${pr} は線の中で、新しい spec を数えない`,
      !r.over &&
        r.exempt === null &&
        r.skipped.some((s) => s.path === spec) &&
        r.lines < SIZE_LIMIT.lines,
      JSON.stringify({ lines: r.lines, files: r.files, counted: r.counted }),
    );
}

// ---- 2. 移すだけ（RA10〜RA13） ----
for (const sha of [
  "07b5bfc57",
  "5c99d2da7",
  "c2afe571f",
  "251b1a770",
  "53811bb2c",
]) {
  const r = measured(sha);
  if (!r) continue;
  check(
    `実の差分: 移すだけの ${sha} は線の外`,
    r.exempt !== null && !r.over,
    JSON.stringify(r).slice(0, 300),
  );
  const { input } = readCommits(ROOT, `${sha}^`, sha);
  const raw = measurePrSize(input);
  check(
    `実の差分: 移すだけの ${sha} は、例外を外すと線を超える`,
    raw.exempt === null && raw.over,
    JSON.stringify({ lines: raw.lines, files: raw.files }),
  );
}

// ---- 3. 記事の PR ----
try {
  check(
    "実の差分: #3313（442432b57）は記事の関門が通す",
    isContentPr(ROOT, "442432b57^", "442432b57"),
  );
  const old = measured("d15c76bdf");
  if (old)
    check(
      "実の差分: manifest の無い 418行の記事 d15c76bdf は関門が通さず、数えて超える",
      old.exempt === null && old.over && old.lines > SIZE_LIMIT.lines,
      JSON.stringify({ lines: old.lines, files: old.files }),
    );
  const { input } = readCommits(ROOT, "d15c76bdf^", "d15c76bdf");
  const asContent = measurePrSize({ ...input, contentPr: true });
  check(
    "記事の PR と判定されれば線の外",
    asContent.exempt !== null && !asContent.over,
  );
} catch (err) {
  skipOrFail(`記事の PR を読めない: ${String(err.message).split("\n")[0]}`);
}

// ---- 4. 改名（-M） ----
{
  const r = measured("2dd78794b");
  const moved = r?.counted.find((c) => c.path === "src/utils/weatherInfo.js");
  if (r)
    check(
      "実の差分: 改名と書き換えは新しいパスで書き換えた行だけ（元のパスは数えない）",
      moved !== undefined &&
        moved.lines > 0 &&
        moved.lines < 10 &&
        !r.counted.some((c) => c.path === "src/components/race/weatherInfo.js"),
      JSON.stringify(r.counted),
    );
}

if (failures > 0) {
  console.error(`NG: PR の大きさの数え方の試験が ${failures} 件失敗`);
  process.exit(1);
}

// ---- 5. この PR ----
const base =
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length))
    .pop() || "origin/master";
let mine;
try {
  mine = measureCommits(ROOT, base, "HEAD");
} catch (err) {
  skipOrFail(
    `base（${base}）から HEAD を数えられない: ${String(err.message).split("\n")[0]}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}
if (mine.exempt) console.log(`OK: この PR は線の外（${mine.exempt}）`);
else {
  console.log(
    `${mine.over ? "超える" : "OK"}: この PR は ${mine.lines}行・${mine.files}ファイル（線は ${SIZE_LIMIT.lines}行・${SIZE_LIMIT.files}ファイル、数え方は scripts/maintenance/prSize.js）`,
  );
  for (const c of mine.counted) console.log(`  数える ${c.lines}行 ${c.path}`);
  for (const s of mine.skipped) console.log(`  数えない ${s.path}（${s.why}）`);
  if (mine.over)
    console.log(
      "  超えても落とさない。超えた PR は pr-lane で重い道（人が見る）に回す",
    );
}
