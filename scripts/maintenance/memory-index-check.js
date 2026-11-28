/**
 * SessionStart: Claude の記憶の索引（~/.claude/projects/<作業場所の鍵>/memory/MEMORY.md）が、会話の始めに読み込まれる
 * 上限を越えていないかを見る（check-git-hygiene.js から呼ぶ。問題が無ければ何も出さない）。
 *
 * 上限は公式の文書（https://code.claude.com/docs/en/memory の Auto memory）の「先頭200行か25KBの早い方」。
 * 越えた分は次の読み込みで落ち、起動時の知らせは出ない（文書に記載なし）。
 * 背景: 2026-11-28 の点検で MEMORY.md が 182行・27.8KB になっていた。上限を越えた分は読み込まれず、
 * 末尾に書いた決まりが黙って効かなくなる。索引は repo の外なので verify・PR の関所が見ない。
 * 線の手前（WARN_RATIO）で知らせ、越える前に整理させる（目安・根拠なし）。
 *
 * 依存は Node の標準だけ（check-git-hygiene.js と同じ。node_modules が壊れていても動く）。
 *
 * 検証: scripts/maintenance/verify-memory-index-check.js
 */
import os from "node:os";
import path from "node:path";

export const MAX_LINES = 200;
export const MAX_BYTES = 25 * 1024;
// 線の手前で知らせる割合（目安・根拠なし）
export const WARN_RATIO = 0.9;

/** 作業場所の絶対パスから、~/.claude/projects の下の鍵（/ と . を - に） */
export function projectKey(projectDir) {
  return path.resolve(projectDir).replace(/[/.]/g, "-");
}

export function memoryIndexPath(projectDir, home = os.homedir()) {
  return path.join(
    home,
    ".claude",
    "projects",
    projectKey(projectDir),
    "memory",
    "MEMORY.md",
  );
}

/**
 * 知らせる行（純関数）。text が null（索引が無い）なら何も出さない
 * @param {{file: string, text: string|null}} input
 */
export function memoryIndexLines({ file, text }) {
  if (text === null || text === undefined) return [];
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const bytes = Buffer.byteLength(text, "utf8");
  const over = lines > MAX_LINES || bytes > MAX_BYTES;
  const near = lines > MAX_LINES * WARN_RATIO || bytes > MAX_BYTES * WARN_RATIO;
  if (!near) return [];
  const kb = (bytes / 1024).toFixed(1);
  const head = over
    ? `記憶の索引が読み込みの上限を越えています（${lines}行・${kb}KB、上限 ${MAX_LINES}行・${MAX_BYTES / 1024}KB）。越えた分は読み込まれません。`
    : `記憶の索引が読み込みの上限に近づいています（${lines}行・${kb}KB、上限 ${MAX_LINES}行・${MAX_BYTES / 1024}KB）。`;
  return [
    head,
    `  1行を題と日付の短さにし、済んだ・古い行は索引から外す: ${file}`,
  ];
}
