#!/usr/bin/env node
/**
 * install-actionlint.js - verify-actionlint.js が使う actionlint と shellcheck を、
 * actionlint-tools.json の固定版で取得する（BOA-659）。
 *
 * 取得方法の判断:
 *   - GitHub Releases の配布物を直接取得し、リポジトリに固定した sha256 と照合する。
 *     照合できなければ展開せずに失敗する（配布物の差し替えを検知するため）
 *   - go install はビルドに数十秒かかり、Go の版にも左右される。Docker イメージは
 *     手元の verify:ci から使いにくい。どちらも採らない
 *   - shellcheck も同じ方法で固定する。ubuntu-latest に入っている shellcheck は
 *     ランナーイメージの更新で版が変わり、指摘の増減で台帳が突然壊れるため
 *
 * 置き場所: $XDG_CACHE_HOME（無ければ ~/.cache）/boatai-tools/<名前>-<版>/。
 * worktree をまたいで共有され、版を上げると別ディレクトリになる。
 *
 * 使い方:
 *   node scripts/maintenance/install-actionlint.js   # 未取得なら取得する（取得済みなら何もしない）
 *   npm run setup:actionlint                         # 同じ
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_PATH = path.join(HERE, "actionlint-tools.json");

export const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const cacheRoot = () =>
  path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "boatai-tools",
  );

export async function readTools() {
  return JSON.parse(await fs.readFile(TOOLS_PATH, "utf8"));
}

/**
 * 各ツールの固定版・置き場所を返す。このプラットフォームの配布物が
 * 台帳に無ければ asset は null
 */
export async function toolPaths() {
  const tools = await readTools();
  const describe = (name) => {
    const { version, assets } = tools[name];
    const asset = assets[PLATFORM_KEY] ?? null;
    const dir = path.join(cacheRoot(), `${name}-${version}`);
    return {
      name,
      version,
      asset,
      dir,
      bin: asset ? path.join(dir, asset.binary) : null,
    };
  };
  return {
    actionlint: describe("actionlint"),
    shellcheck: describe("shellcheck"),
  };
}

async function install(tool) {
  if (!tool.asset) {
    throw new Error(
      `${tool.name}: このプラットフォーム（${PLATFORM_KEY}）の配布物が actionlint-tools.json にありません。` +
        "url と sha256 を追記してください",
    );
  }
  if (existsSync(tool.bin)) {
    console.log(`✅ ${tool.name} ${tool.version}: 取得済み（${tool.bin}）`);
    return;
  }
  const res = await fetch(tool.asset.url);
  if (!res.ok) {
    throw new Error(
      `${tool.name}: 取得に失敗しました（HTTP ${res.status}: ${tool.asset.url}）`,
    );
  }
  const body = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== tool.asset.sha256) {
    throw new Error(
      `${tool.name}: sha256 が固定値と一致しません。展開せずに中止します\n` +
        `  期待: ${tool.asset.sha256}\n  実際: ${actual}\n  URL: ${tool.asset.url}`,
    );
  }
  // 途中で落ちても中途半端なディレクトリが「取得済み」と見なされないよう、
  // 一時ディレクトリに展開してから rename する
  await fs.mkdir(path.dirname(tool.dir), { recursive: true });
  const tmp = await fs.mkdtemp(
    path.join(path.dirname(tool.dir), `.${tool.name}-`),
  );
  try {
    const archive = path.join(tmp, "archive.tar.gz");
    await fs.writeFile(archive, body);
    execFileSync("tar", ["xzf", archive, "-C", tmp], { stdio: "inherit" });
    await fs.rm(archive);
    await fs.chmod(path.join(tmp, tool.asset.binary), 0o755);
    await fs.rm(tool.dir, { recursive: true, force: true });
    await fs.rename(tmp, tool.dir);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  console.log(
    `✅ ${tool.name} ${tool.version}: 取得して sha256 を照合しました（${tool.bin}）`,
  );
}

async function main() {
  const { actionlint, shellcheck } = await toolPaths();
  await install(actionlint);
  await install(shellcheck);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
