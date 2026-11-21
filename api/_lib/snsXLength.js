/**
 * X の投稿の文字数の上限と判定。本体は scripts/lib/sns/xLength.js（scripts/lib の投稿の文の組み立てが読むので api/ から下ろした。ここは再 export だけ）
 */
export {
  X_POST_MAX,
  X_LONG_POST_MAX,
  xPostValid,
  xPostMax,
} from "../../scripts/lib/sns/xLength.js";
