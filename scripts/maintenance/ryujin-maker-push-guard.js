/**
 * ryujin-maker-token.js の `-- git push` の前に、push する枝の PR がもうマージ済みなら止める
 * （設計 docs/design/harness-migration/dev-friction-2026-11-25.md §3）。
 *
 * 型: #3377。PR のマージ（squash）の後に同じ枝へ直しを push しても master に入らず、直しが消える。
 * 止めたら「origin/master から新しい枝で作り直す」と出す。
 * - 枝を消す push（--delete・`:枝`）と、枝を1つに決められない push（--all・--mirror・--tags）は止めない
 * - 同じ枝の名で開いている PR があれば止めない（名前を使い回した新しい PR）
 * - refspec が無く上流の名前が今の枝と違う push は、今の枝の名で見る（読み違えても止める側には倒れない）
 * - GitHub を読めないときは止めずに警告だけ（push の道そのものを壊さない）
 * - push の後にマージされる競り合いは止められない（マージの後の push だけを止める）
 *
 * 検証: scripts/maintenance/verify-ryujin-maker-token.js の「push の前の確かめ」
 */

const stripHeads = (ref) => ref.replace(/^refs\/heads\//, "");

/**
 * git push の引数から、push する先の枝の名（純関数）。枝を消す push と、決められないときは null。
 * @param {string[]} gitArgs ryujin-maker-token.js が固めた git の引数（-c の後に push …）
 * @param {string} currentBranch 今の枝（git branch --show-current）
 */
export function pushTargetBranch(gitArgs, currentBranch) {
  const at = gitArgs.indexOf("push");
  if (at < 0) return null;
  const rest = gitArgs.slice(at + 1);
  // 消す push と、枝を1つに決められない push（--all・--mirror・--tags）は確かめない
  const skip = new Set(["--delete", "-d", "--all", "--mirror", "--tags"]);
  if (rest.some((a) => skip.has(a))) return null;
  const positional = rest.filter((a) => !a.startsWith("-"));
  const refspecs = positional.slice(1); // 先頭は remote
  if (refspecs.length === 0) return currentBranch || null;
  const last = refspecs[refspecs.length - 1].replace(/^\+/, "");
  if (last.startsWith(":")) return null; // `:枝` は消す push
  const dst = last.includes(":") ? last.split(":")[1] : last;
  const name = dst === "HEAD" ? currentBranch : stripHeads(dst);
  return name || null;
}

/**
 * PR の一覧（GET /pulls?head=…&state=all）から、止める元のマージ済みの PR（無ければ null）。
 * 同じ枝の名で開いている PR があれば止めない（名前を使い回した新しい PR への push）
 */
export function mergedPrOf(pulls) {
  const list = pulls ?? [];
  if (list.some((p) => p?.state === "open")) return null;
  return list.find((p) => p?.merged_at) ?? null;
}

/** 止めるときの文 */
export function blockedMessage(branch, pr) {
  return (
    `枝 ${branch} の PR #${pr.number} はマージ済み（${pr.merged_at}）。この枝に push しても master に入らない。` +
    "origin/master から新しい枝を切って作り直し、新しい PR に #" +
    `${pr.number} を書く`
  );
}

/**
 * push してよいか。{ ok: true } か、止めるときの { ok: false, message }。読めなければ { ok: true, warning }
 * @param {{fetchImpl: typeof fetch, token: string, repo: string, branch: string|null}} io
 */
export async function checkPushTarget({ fetchImpl, token, repo, branch }) {
  if (!branch || branch === "master") return { ok: true };
  const owner = repo.split("/")[0];
  const url = `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=10`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10 * 1000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pr = mergedPrOf(await res.json());
    return pr
      ? { ok: false, message: blockedMessage(branch, pr) }
      : { ok: true };
  } catch (error) {
    return {
      ok: true,
      warning: `枝 ${branch} の PR がマージ済みかを読めなかった（${error.message}）。確かめずに push する`,
    };
  }
}
