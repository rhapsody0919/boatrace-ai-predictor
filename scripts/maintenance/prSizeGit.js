/**
 * prSizeGit.js - git から PR の差分を読み、prSize.js の measurePrSize で数える入口（BOA-1718）。
 * Node の組み込みと相対の import だけ（pr-lane.js から使うため）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moveOnlyPaths } from "./prLaneMoveOnly.js";
import { loadMoveOnly } from "./prLaneClassify.js";
import { parsePatch } from "./pr-lane.js";
import { measurePrSize } from "./prSize.js";

const CHECK_CONTENT_PR = fileURLToPath(
  new URL("../content/check-content-pr.js", import.meta.url),
);

/**
 * git の出力から measurePrSize の入力を作る（git は呼び手が渡す: 引数の配列 → 標準出力の文字列）。
 * 差分は merge-base から head まで、改名を見る（-M。verify-pr-shape.js と同じ）。
 * patch は pr-lane.js の parsePatch（改名の元のパスにも空の行が入るが、changes に無いので数えない）
 */
export function collectSizeInput(git, mergeBase, head) {
  const tokens = git(["diff", "--name-status", "-M", "-z", mergeBase, head])
    .split("\0")
    .filter((t) => t !== "");
  const changes = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i][0];
    const twoPaths = status === "R" || status === "C";
    changes.push(
      twoPaths
        ? { status, path: tokens[i + 2], from: tokens[i + 1] }
        : { status, path: tokens[i + 1] },
    );
    i += twoPaths ? 3 : 2;
  }
  const patches = parsePatch(
    git(["diff", "-M", "-U0", "--no-color", "--no-ext-diff", mergeBase, head]),
  );
  const readText = (side, path) => {
    try {
      return git(["show", `${side === "base" ? mergeBase : head}:${path}`]);
    } catch {
      return null; // 無いファイル（足した・消した側）は null。locale の判定は無い側を空として扱う
    }
  };
  return { changes, patches, readText };
}

/**
 * check-content-pr.js を dir（HEAD が PR の head の木）で起動し、標準出力の JSON の ok で記事の PR かを決める。
 * 終了コードでは見ない（起動の失敗・npm の部品が無い等も1になり「記事の PR でない」と区別できない）。JSON が無ければ投げる
 */
function runContentGate(dir, baseSha, timeout) {
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [CHECK_CONTENT_PR, "--base", baseSha],
      {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
        timeout,
      },
    );
  } catch (err) {
    out = err.stdout; // errors のある PR は終了コード1で JSON を出す
    if (!out)
      throw new Error(
        `記事の関門を回せない: ${String(err.message).split("\n")[0]}`,
      );
  }
  return JSON.parse(out).ok === true;
}

/**
 * 記事の PR か（scripts/content/check-content-pr.js をそのまま当てる）。関門は git の HEAD だけを読むので、
 * head が repo の HEAD でなければ一時の作業ツリー（--detach --no-checkout）に head を出して当てる
 */
export function isContentPr(repo, baseSha, headSha, timeout) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    }).trim();
  if (git(["rev-parse", "HEAD"]) === headSha)
    return runContentGate(repo, baseSha, timeout);
  const dir = mkdtempSync(join(tmpdir(), "pr-size-content-"));
  try {
    git(["worktree", "add", "-q", "--detach", "--no-checkout", dir, headSha]);
    return runContentGate(dir, baseSha, timeout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try {
      git(["worktree", "prune"]);
    } catch (err) {
      // 片付けの失敗で元の例外（判定の失敗）を隠さない。残った登録は次の prune で消える
      console.error(`prSize: git worktree prune に失敗: ${err.message}`);
    }
  }
}

/**
 * git から差分を読んで数える（repo の base と head の merge-base から head まで）。
 * 記事の PR の判定（子の過程を起動するので重い）は、数えて線を超えたときだけ回す。
 * timeout: ミリ秒か、残りのミリ秒を返す関数（pr-lane の時間の上限を渡す）。超えたら execFileSync が投げる
 */
export function measureCommits(repo, base, head, { timeout } = {}) {
  const git = (args) =>
    execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: typeof timeout === "function" ? timeout() : timeout,
    });
  const sha = (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  const headSha = sha(head);
  const baseSha = sha(base);
  const mergeBase = git(["merge-base", baseSha, headSha]).trim();
  const input = collectSizeInput(git, mergeBase, headSha);
  const moved = moveOnlyPaths(loadMoveOnly(), input.changes, input.readText);
  const counted = measurePrSize({ ...input, moved });
  if (!counted.over) return counted;
  const left = typeof timeout === "function" ? timeout() : timeout;
  return isContentPr(repo, baseSha, headSha, left)
    ? measurePrSize({ ...input, moved, contentPr: true })
    : counted;
}
