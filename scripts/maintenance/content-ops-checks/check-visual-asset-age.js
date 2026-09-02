/**
 * 主要な視覚素材（/about ヒーロー動画・オンボーディング動画・ブログカバー画像等）の
 * 最終更新日を一覧化する。陳腐化の自動判定はしない（判断は人間）。
 * 詳細: docs/design/content-ops-flow/plan.md
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");

// 「主要素材」として鮮度を監視する対象ディレクトリ。会場ガイド画像等の
// 大量生成物は対象外（1機能あたり1〜数枚の、露出が大きい素材に絞る）
const TARGET_DIRS = ["public/videos", "public/images/blog"];

async function listFiles(dirRelPath) {
  const dirAbsPath = path.join(REPO_ROOT, dirRelPath);
  let entries;
  try {
    entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relPath = path.join(dirRelPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(relPath)));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

async function getLastCommitDate(relPath) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cI", "--", relPath],
      { cwd: REPO_ROOT },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function daysSince(isoDateString) {
  if (!isoDateString) return null;
  const diffMs = Date.now() - new Date(isoDateString).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function checkVisualAssetAge() {
  const allFiles = [];
  for (const dir of TARGET_DIRS) {
    allFiles.push(...(await listFiles(dir)));
  }

  const assets = await Promise.all(
    allFiles.map(async (relPath) => {
      const lastCommitDate = await getLastCommitDate(relPath);
      return {
        path: relPath,
        lastCommitDate,
        ageDays: daysSince(lastCommitDate),
      };
    }),
  );

  assets.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
  return { assets };
}
