#!/usr/bin/env node
/**
 * E2E の録画（e2e/recordings/）を GitHub Release で配る（BOA-466、ADR-0077）。
 *
 * 録画の本体（api.har と bodies/、約90MB）は git に置かない。撮り直すたびに圧縮後
 * 10〜12MB ずつ履歴が増え、データ取得部分を変える PR が1日に何本も入る運用では
 * すぐに膨らむため。本体は Release に zip で添付し、リポジトリには
 * ポインタ（e2e/recording.json: タグ名・sha256・録画時刻など）だけを置く。
 *
 * サブコマンド:
 *   fetch               ポインタの録画を e2e/recordings/ に展開する（キャッシュ・sha256照合あり）。
 *                       global-setup が replay の前に自動で呼ぶ
 *   publish             e2e/recordings/ を zip にして Release を作り、ポインタを書く
 *                       --skipped=N --tests=N（採用判定に使った再生の結果）
 *   prune               古い録画 Release を消す。--keep=N（既定14）。--dry-run で一覧だけ
 *   skips <results>     Playwright の JSON レポートから件数を数えて JSON で出す
 *   judge <results>     撮り直した録画を採用してよいか判定する（全件通過・skip が増えていない）
 *
 * 環境変数:
 *   E2E_RECORDING_REPO  owner/repo（既定: origin の URL から求める）
 *   E2E_RECORDING_CACHE zip のキャッシュ置き場（既定: node_modules/.cache/boatai-e2e-recording）
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flattenTests } from "./check-e2e-skips.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const POINTER_PATH = path.join(repoRoot, "e2e", "recording.json");
const RECORDINGS_DIR = path.join(repoRoot, "e2e", "recordings");
/** 展開済みの録画がどのポインタ（sha256）から来たかを書いておくファイル */
const SOURCE_MARK = path.join(RECORDINGS_DIR, ".source-sha256");
const ASSET_NAME = "e2e-recording.zip";
const TAG_PREFIX = "e2e-recording-";
const CACHE_DIR =
  process.env.E2E_RECORDING_CACHE ||
  path.join(repoRoot, "node_modules", ".cache", "boatai-e2e-recording");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export function readPointer() {
  try {
    return JSON.parse(readFileSync(POINTER_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `${POINTER_PATH} を読めません（録画のポインタがありません）: ${error.message}`,
    );
  }
}

function repoSlug() {
  if (process.env.E2E_RECORDING_REPO) return process.env.E2E_RECORDING_REPO;
  const url = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const m = url.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
  if (!m)
    throw new Error(`origin の URL から owner/repo を求められません: ${url}`);
  return m[1];
}

/** ポインタの録画を e2e/recordings/ に用意する。既に同じものが展開済みなら何もしない */
export async function ensureRecording({ quiet = false } = {}) {
  const pointer = readPointer();
  if (
    existsSync(SOURCE_MARK) &&
    readFileSync(SOURCE_MARK, "utf8").trim() === pointer.sha256
  ) {
    return pointer;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${pointer.sha256}.zip`);
  if (!existsSync(cached)) {
    const url = `https://github.com/${repoSlug()}/releases/download/${pointer.tag}/${pointer.asset ?? ASSET_NAME}`;
    if (!quiet) console.log(`[e2e recording] 取得: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `録画を取得できません（${response.status} ${response.statusText}）: ${url}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== pointer.sha256) {
      throw new Error(
        `録画の sha256 がポインタと一致しません（期待 ${pointer.sha256} / 実際 ${actual}）: ${url}`,
      );
    }
    const tmp = `${cached}.${process.pid}.tmp`;
    writeFileSync(tmp, buffer);
    renameSync(tmp, cached);
  } else {
    const actual = sha256(readFileSync(cached));
    if (actual !== pointer.sha256) {
      rmSync(cached, { force: true });
      throw new Error(
        `キャッシュの録画が壊れています（sha256 不一致）。消したので再実行してください: ${cached}`,
      );
    }
  }

  rmSync(RECORDINGS_DIR, { recursive: true, force: true });
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  execFileSync("unzip", ["-q", cached, "-d", RECORDINGS_DIR]);
  writeFileSync(SOURCE_MARK, `${pointer.sha256}\n`);
  if (!quiet) {
    console.log(
      `[e2e recording] ${pointer.tag}（録画時刻 ${pointer.recordedAt}）を展開しました`,
    );
  }
  return pointer;
}

/** Playwright の JSON レポートから、全件数・skip・失敗を数える（純関数） */
export function countResults(report) {
  const tests = flattenTests(report);
  const by = (s) => tests.filter((t) => t.status === s).length;
  return {
    tests: tests.length,
    skipped: by("skipped"),
    // flaky（1回目に落ちて CI のリトライで通った）は失敗に数えない。録画に無い通信は
    // strict で abort されるので、録画の不足ならリトライでも落ちて unexpected になる。
    // 1回目だけの失敗は録画ではなく実行環境の負荷によるもの（2026-09-29 の手元検証で、
    // 負荷平均40の中でハンバーガーメニューの遷移が1件タイムアウト→リトライで通過）
    failed: by("unexpected"),
    flaky: by("flaky"),
    errors: (report.errors ?? []).length,
  };
}

/**
 * 撮り直した録画を採用してよいか（純関数）。
 * 1. 撮り直した録画での再生が全件通る（失敗・レポート外のエラーが0）
 * 2. skip が現行の録画より増えていない（発走前のレースが少ない日に撮ると skip が増える）
 */
export function judgeAdoption(counts, current) {
  const reasons = [];
  if (counts.tests === 0) reasons.push("再生で1件もテストが走っていない");
  if (counts.failed > 0) reasons.push(`再生で${counts.failed}件失敗した`);
  if (counts.errors > 0)
    reasons.push(`テスト外のエラーが${counts.errors}件ある`);
  if (
    current &&
    typeof current.skipped === "number" &&
    counts.skipped > current.skipped
  ) {
    reasons.push(
      `skip が現行の録画より増えた（現行 ${current.skipped}件 → 新 ${counts.skipped}件）`,
    );
  }
  return { adopt: reasons.length === 0, reasons };
}

function tagFor(recordedAt) {
  const jst = new Date(new Date(recordedAt).getTime() + 9 * 60 * 60 * 1000);
  const s = jst.toISOString();
  return `${TAG_PREFIX}${s.slice(0, 10).replaceAll("-", "")}-${s.slice(11, 16).replace(":", "")}`;
}

function publish({ skipped, tests }) {
  const meta = JSON.parse(
    readFileSync(path.join(RECORDINGS_DIR, "meta.json"), "utf8"),
  );
  const tag = tagFor(meta.recordedAt);
  const work = path.join(repoRoot, "test-results", ".e2e-recording-publish");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const zipPath = path.join(work, ASSET_NAME);
  // 展開先の目印（.source-sha256）は入れない。-X で拡張属性を落とす
  execFileSync(
    "zip",
    ["-q", "-r", "-X", zipPath, "api.har", "meta.json", "bodies"],
    {
      cwd: RECORDINGS_DIR,
    },
  );
  const buffer = readFileSync(zipPath);
  const digest = sha256(buffer);

  const target = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const notes = [
    "E2E（Playwright）の録画。PRゲートの再生に使う（ADR-0077）。",
    "",
    `- 録画時刻: ${meta.recordedAt}`,
    `- 応答: ${meta.entries}件`,
    `- 再生での件数: ${tests}件（skip ${skipped}件）`,
    `- sha256: ${digest}`,
  ].join("\n");
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      zipPath,
      "--repo",
      repoSlug(),
      "--target",
      target,
      "--title",
      `E2E録画 ${tag.slice(TAG_PREFIX.length)}`,
      "--notes",
      notes,
      "--prerelease",
      "--latest=false",
    ],
    { stdio: "inherit" },
  );

  const pointer = {
    $comment:
      "E2Eの録画のポインタ（ADR-0077）。本体は GitHub Release の添付。npm run e2e:recording:fetch で取得する",
    tag,
    asset: ASSET_NAME,
    sha256: digest,
    bytes: buffer.length,
    recordedAt: meta.recordedAt,
    supabaseOrigin: meta.supabaseOrigin,
    entries: meta.entries,
    tests,
    skipped,
  };
  writeFileSync(POINTER_PATH, JSON.stringify(pointer, null, 2) + "\n");
  // いま展開されている録画はこのポインタそのもの
  writeFileSync(SOURCE_MARK, `${digest}\n`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path.join(CACHE_DIR, `${digest}.zip`), buffer);
  console.log(
    `[e2e recording] ${tag} を公開し、${path.relative(repoRoot, POINTER_PATH)} を更新しました（${(buffer.length / 1024 / 1024).toFixed(1)}MB）`,
  );
}

function prune({ keep, dryRun }) {
  const current = existsSync(POINTER_PATH) ? readPointer().tag : null;
  const releases = JSON.parse(
    execFileSync(
      "gh",
      [
        "release",
        "list",
        "--repo",
        repoSlug(),
        "--limit",
        "500",
        "--json",
        "tagName,createdAt",
      ],
      { encoding: "utf8" },
    ),
  )
    .filter((r) => r.tagName.startsWith(TAG_PREFIX))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const doomed = releases.slice(keep).filter((r) => r.tagName !== current);
  console.log(
    `[e2e recording] 録画 Release ${releases.length}件、残す ${Math.min(keep, releases.length)}件、消す ${doomed.length}件${dryRun ? "（dry-run）" : ""}`,
  );
  for (const r of doomed) {
    console.log(`  ${dryRun ? "消す予定" : "削除"}: ${r.tagName}`);
    if (!dryRun) {
      execFileSync(
        "gh",
        [
          "release",
          "delete",
          r.tagName,
          "--repo",
          repoSlug(),
          "--yes",
          "--cleanup-tag",
        ],
        { stdio: "inherit" },
      );
    }
  }
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const [command, file] = process.argv.slice(2);
  switch (command) {
    case "fetch":
      await ensureRecording();
      return;
    case "publish":
      publish({ skipped: Number(arg("skipped")), tests: Number(arg("tests")) });
      return;
    case "prune":
      prune({
        keep: Number(arg("keep", "14")),
        dryRun: process.argv.includes("--dry-run"),
      });
      return;
    case "skips":
      console.log(
        JSON.stringify(countResults(JSON.parse(readFileSync(file, "utf8")))),
      );
      return;
    case "judge": {
      const counts = countResults(JSON.parse(readFileSync(file, "utf8")));
      const current = existsSync(POINTER_PATH) ? readPointer() : null;
      const result = {
        ...judgeAdoption(counts, current),
        counts,
        current: current && { tag: current.tag, skipped: current.skipped },
      };
      console.log(JSON.stringify(result));
      process.exitCode = result.adopt ? 0 : 3;
      return;
    }
    default:
      console.error(
        "使い方: node scripts/maintenance/e2e-recording.js fetch|publish|prune|skips <json>|judge <json>",
      );
      process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
