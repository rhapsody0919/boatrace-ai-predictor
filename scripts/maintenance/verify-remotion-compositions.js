/**
 * 動画（sns-video-studio/remotion）の束を実際に作り、composition の一覧が出ることの検査（2026-11-04）。
 *
 * Root は全部の composition を1つの束にするので、どれか1つの import が束を壊すと全部の動画が落ちる
 * （11/4 21:28〜、import.meta.glob に届いて Getting composition で落ちた）。静的な検査は verify-remotion-src-imports.js（ci）。
 * これは `npx remotion compositions src/index.jsx --quiet --props=<{"variant":"border"}>` を実行し、終了コード 0 と、
 * Root.jsx に書いた composition の id が全部一覧にあることを見る。
 *
 * remotion の依存（sns-video-studio/remotion/node_modules）と Chromium が要るので manual。
 * 実行: node scripts/maintenance/verify-remotion-compositions.js（先に sns-video-studio/remotion で npm ci）
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION = join(ROOT, "sns-video-studio/remotion");

if (!existsSync(join(REMOTION, "node_modules/@remotion/cli"))) {
  console.error(
    "verify-remotion-compositions: sns-video-studio/remotion/node_modules が無い。先に sns-video-studio/remotion で npm ci を実行する",
  );
  process.exit(1);
}

// Root.jsx に書かれた composition の id（id="..."）。一覧に全部出ることを見る
const rootSrc = readFileSync(join(REMOTION, "src/Root.jsx"), "utf8");
// JSX のコメント（{/* … */}）の中の id は数えない（コメントで外した composition を期待しない）
const expectedIds = [
  ...rootSrc
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g),
].map((m) => m[1]);
if (expectedIds.length === 0) {
  console.error(
    "verify-remotion-compositions: Root.jsx から composition の id を読めない（検査を見直す）",
  );
  process.exit(1);
}

// 一覧は全部の composition の calculateMetadata を走らせる。節の機力（SetsuKiryokuShort）は defaultProps を置かず
// （Root.jsx の注記）、props の variant が無いと timeline() が「知らない型」で投げるので、variant だけを渡す。
// --props は全部の composition に浅く重なるが、variant を読むのは節の機力だけ
const propsFile = join(
  mkdtempSync(join(tmpdir(), "verify-remotion-")),
  "props.json",
);
writeFileSync(propsFile, JSON.stringify({ variant: "border" }));
const run = spawnSync(
  "npx",
  [
    "remotion",
    "compositions",
    "src/index.jsx",
    "--quiet",
    `--props=${propsFile}`,
  ],
  {
    cwd: REMOTION,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Chromium の取得が止まる等で戻らないとき、黙って待ち続けない
    timeout: 10 * 60 * 1000,
  },
);
const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
if (run.error || run.signal) {
  console.error(
    `verify-remotion-compositions: 実行できない・止められた: ${run.error?.message ?? ""} signal=${run.signal ?? "なし"}\n${out.slice(-4000)}`,
  );
  process.exit(1);
}
if (run.status !== 0) {
  console.error(
    `verify-remotion-compositions: remotion compositions が終了コード ${run.status} で落ちた\n${out.slice(-4000)}`,
  );
  process.exit(1);
}
// --quiet の一覧は id の空白区切り。部分一致（VenueRankingCM が VenueRankingCM-EN に含まれる）で見逃さないよう語で照らす
const listed = new Set((run.stdout ?? "").split(/\s+/).filter(Boolean));
const missing = expectedIds.filter((id) => !listed.has(id));
if (missing.length > 0) {
  console.error(
    `verify-remotion-compositions: 一覧に無い composition: ${missing.join(", ")}\n${out.slice(-4000)}`,
  );
  process.exit(1);
}
console.log(
  `verify-remotion-compositions: OK（composition ${expectedIds.length} 個が一覧に出た）`,
);
