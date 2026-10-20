/**
 * vercel.json の ignoreCommand から呼ぶ（BOA-908）。終了コード 0 でビルドしない、1 でビルドする。
 * 判定は scripts/lib/vercelIgnoreBuild.js。前回のデプロイの SHA が無い・git が失敗したときはビルドする。
 */
import { execFileSync } from "node:child_process";
import { shouldSkipBuild } from "./lib/vercelIgnoreBuild.js";

const BUILD = 1;
const SKIP = 0;

// --no-renames: リネームでは旧パスも出す（サイトのファイルを除外ディレクトリへ移すだけのコミットをビルドするため）
function changedFiles(previousSha) {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", previousSha, "HEAD"],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

function main() {
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previousSha) {
    console.log("前回のデプロイの SHA が無いのでビルドする");
    return BUILD;
  }
  let files;
  try {
    files = changedFiles(previousSha);
  } catch (err) {
    console.log(`差分を取れないのでビルドする: ${err.message}`);
    return BUILD;
  }
  if (shouldSkipBuild(files)) {
    console.log(
      `サイトに関係ない変更だけなのでビルドしない（${files.length}件、例: ${files.slice(0, 3).join(", ")}）`,
    );
    return SKIP;
  }
  console.log(`ビルドする（変わったファイル ${files.length}件）`);
  return BUILD;
}

process.exit(main());
