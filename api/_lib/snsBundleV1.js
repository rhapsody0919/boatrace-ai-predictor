/**
 * 素材バンドル v1 の欄の検査（sns-pdca-loop tasks 6、plan §1）。validateBundle に v1Fields として渡す（push-bundle）。
 * twitter-text を使うので snsBundleValidation.js とは分ける（Edge の管理 API が snsBundleValidation.js を読むため）。
 */
import twitterText from "twitter-text";
import {
  X_THREAD_MAX,
  X_VIDEO,
  ensure,
  record,
  text,
} from "./snsBundleValidation.js";

export const RACE_URL_PREFIX = "https://www.boat-ai.jp/race/";

/** v1 の bundle.json の欄（plan §1）。締切は bundle の値を使わず、送信の側で races から計算する */
export function validateV1Fields(bundle, files) {
  ensure(
    text(bundle.title, 100) &&
      text(bundle.script, 20000) &&
      text(bundle.format, 50) &&
      text(bundle.screen_key, 100) &&
      (bundle.x_text === undefined || text(bundle.x_text, 20000)) &&
      (bundle.template_variant_id === undefined ||
        text(bundle.template_variant_id, 100)),
    "v1の本文・タイトル・screen_keyが不正です",
  );
  const thread = bundle.x_thread;
  ensure(
    Array.isArray(thread) &&
      thread.length >= 1 &&
      thread.length <= X_THREAD_MAX,
    `v1のx_threadは1〜${X_THREAD_MAX}件です`,
  );
  thread.forEach((post, i) => {
    ensure(
      record(post) && post.index === i && text(post.text, 20000),
      "x_threadのindexは0からの連番で、本文が必要です",
    );
    ensure(
      twitterText.parseTweet(post.text).valid,
      `x_thread[${i}]: Xの文字数を超えています`,
    );
    // URL を含む投稿は単価が高い（spec の費用の決まり）ので、URL はスレッドの親だけ
    ensure(
      i === 0 || twitterText.extractUrls(post.text).length === 0,
      `x_thread[${i}]: URLは親（index 0）だけに置けます`,
    );
    if (post.media !== undefined)
      ensure(
        typeof post.media === "string" &&
          files.has(post.media) &&
          /\.(mp4|png)$/.test(post.media),
        `x_thread[${i}]: 媒体が添付にありません`,
      );
  });
  ensure(thread[0].media === X_VIDEO, `x_thread[0]の媒体は${X_VIDEO}です`);
  // 親にはレースの URL がちょうど1つ（送信の前に UTM を差し込む。tasks 23 の insertTrackingUrl）
  const parentUrls = twitterText.extractUrls(thread[0].text);
  ensure(
    parentUrls.length === 1 && parentUrls[0].startsWith(RACE_URL_PREFIX),
    `x_thread[0]にはレースのURL（${RACE_URL_PREFIX}…）をちょうど1つ置きます`,
  );
  ensure(
    Array.isArray(bundle.claims) &&
      bundle.claims.length >= 1 &&
      bundle.claims.length <= 100 &&
      bundle.claims.every(
        (c) =>
          record(c) &&
          text(c.id, 100) &&
          text(c.text, 500) &&
          Object.hasOwn(c, "value") &&
          record(c.source) &&
          typeof c.source.endpoint === "string" &&
          /^\/api\/[A-Za-z0-9/_\-.]+$/.test(c.source.endpoint) &&
          Array.isArray(c.source.path) &&
          c.source.path.length > 0 &&
          c.source.path.length <= 30 &&
          c.source.path.every(
            (p) => typeof p === "string" || Number.isInteger(p),
          ),
      ),
    "v1のclaimsが不正です（id・text・value・source.endpoint・source.path）",
  );
}
