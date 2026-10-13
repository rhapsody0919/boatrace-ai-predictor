/**
 * リスクルール（sns-video-studio/remotion/risk-rules.json）を nodejs の関数から読む。
 *
 * JSON を `import x from "...json"` で読めるのは edge の関数だけ（esbuild が束ねる）。nodejs の関数は束ねずに
 * Node の ESM で動くので、import 属性の無い JSON の import は読み込みで落ち、関数が毎回 500 になる
 * （2026-10-13、/api/admin/sns-hub/mobile-approval で「今日のレースを取得できません」）。
 * ファイルとして読む（api/_lib/botPage.js と同じ。vercel.json の includeFiles で関数に同梱する）
 */
import { readFileSync } from "node:fs";

export default JSON.parse(
  readFileSync(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
);
