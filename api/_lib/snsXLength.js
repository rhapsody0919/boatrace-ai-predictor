/**
 * X の投稿の文字数（2026-10-14 オーナー決定: X は長文の1投稿、Premium 前提）。
 * 子のあるスレッドの各投稿は今までどおり加重の文字数で280まで。親1件だけのスレッド（長文の1投稿）は25,000まで。
 * 加重の数え方（全角は2）は twitter-text のまま、上限だけを変える。
 */
import twitterText from "twitter-text";

export const X_POST_MAX = 280;
export const X_LONG_POST_MAX = 25000;
const LONG_CONFIG = {
  ...twitterText.configs.defaults,
  maxWeightedTweetLength: X_LONG_POST_MAX,
};

/** @param {{long?: boolean}} options long は「親1件だけのスレッド」 */
export function xPostValid(text, { long = false } = {}) {
  return twitterText.parseTweet(text, long ? LONG_CONFIG : undefined).valid;
}

export const xPostMax = (long) => (long ? X_LONG_POST_MAX : X_POST_MAX);
