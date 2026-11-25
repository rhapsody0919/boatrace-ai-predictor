/**
 * verify-ryujin-maker-token.js の「push の前の確かめ」の場面（ryujin-maker-push-guard.js、#3377 の型）。verify ではない。
 * check は verify 側の物を受け取る（失敗の数は verify が数える）。通信しない（偽の fetch）。
 */
import {
  blockedMessage,
  checkPushTarget,
  mergedPrOf,
  pushTargetBranch,
} from "../ryujin-maker-push-guard.js";

/** push の先の枝の読み・マージ済みの PR の拾い（純関数） */
function pureScenes(check) {
  const pin = ["-c", "credential.helper=", "-c", "credential.helper=!x"];
  const t = (rest, cur = "claude/a") =>
    pushTargetBranch([...pin, "push", ...rest], cur);
  check(
    t(["-u", "origin", "HEAD"]) === "claude/a" &&
      t([]) === "claude/a" &&
      t(["origin"]) === "claude/a" &&
      t(["-q", "-u", "origin", "claude/b"]) === "claude/b" &&
      t(["origin", "HEAD:refs/heads/claude/c"]) === "claude/c" &&
      t(["origin", "+claude/d"]) === "claude/d",
    "push の先の枝: 今の枝・名指し・src:dst・refs/heads・強制の + を読む",
  );
  check(
    t(["origin", "--delete", "claude/a"]) === null &&
      t(["origin", ":claude/a"]) === null &&
      pushTargetBranch([...pin, "status"], "claude/a") === null,
    "枝を消す push と push でない命令は確かめない",
  );
  check(
    mergedPrOf([
      { number: 1, merged_at: null },
      { number: 2, merged_at: "2026-11-25T06:00:00Z" },
    ])?.number === 2 &&
      mergedPrOf([{ number: 1, merged_at: null }]) === null &&
      mergedPrOf(undefined) === null,
    "マージ済みの PR だけを拾う（閉じただけの PR は止めない）",
  );
}

/** GitHub を読んで止める・通す（偽の fetch） */
async function fetchScenes(check) {
  const urls = [];
  const fake =
    (body, status = 200) =>
    async (url) => {
      urls.push(url);
      return { ok: status < 300, status, json: async () => body };
    };
  const merged = await checkPushTarget({
    fetchImpl: fake([{ number: 3377, merged_at: "2026-11-25T01:00:00Z" }]),
    token: "t",
    repo: "rhapsody0919/boatrace-ai-predictor",
    branch: "claude/x",
  });
  check(
    merged.ok === false &&
      merged.message ===
        blockedMessage("claude/x", {
          number: 3377,
          merged_at: "2026-11-25T01:00:00Z",
        }) &&
      merged.message.includes("origin/master から新しい枝") &&
      urls[0].includes("head=rhapsody0919%3Aclaude%2Fx") &&
      urls[0].includes("state=all"),
    "マージ済みの PR の枝への push は止め、origin/master から作り直すと出す",
    JSON.stringify({ merged, url: urls[0] }),
  );
  const open = await checkPushTarget({
    fetchImpl: fake([{ number: 9, merged_at: null }]),
    token: "t",
    repo: "o/r",
    branch: "claude/y",
  });
  const down = await checkPushTarget({
    fetchImpl: fake({}, 502),
    token: "t",
    repo: "o/r",
    branch: "claude/y",
  });
  const master = await checkPushTarget({
    fetchImpl: fake([{ number: 1, merged_at: "x" }]),
    token: "t",
    repo: "o/r",
    branch: "master",
  });
  check(
    open.ok === true &&
      !open.warning &&
      down.ok === true &&
      down.warning.includes("HTTP 502") &&
      master.ok === true,
    "開いた PR の枝は通す・読めなければ警告して通す・master は確かめない",
    JSON.stringify({ open, down, master }),
  );
}

/** @param {(ok: boolean, label: string, detail?: string) => void} check */
export async function runPushGuardScenes(check) {
  pureScenes(check);
  await fetchScenes(check);
}
