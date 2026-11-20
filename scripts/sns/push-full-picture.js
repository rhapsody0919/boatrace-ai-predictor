/**
 * 全貌動画（format=full_picture）のフォルダを受け取り、X・YouTube の下書きと自動送信の item を作って、承認なしで送る予定に入れる
 * （2026-10-18 オーナー決定: 承認なし・事前通知と止めるリンクは最小。マイグレーション 161）。
 * hq の作業役が同じ Mac の本リポジトリで実行する。鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-full-picture.js <フォルダ> [--dry-run]
 *
 * フォルダ: bundle.json（format・race_id・x_text・youtube_full{title,description}・review{p0_count}・qa）、
 *   full-x.mp4（X）、full-youtube.mp4（YouTube の完全版）。
 *   bundle_version: 2 のときだけ、youtube_shorts{title,description} と shorts.mp4（入口版、縦）を受け、YouTube の Shorts の下書きを足す
 *   （マイグレーション 172、BOA-912）。Shorts は完全版の公開の後に送り、説明文の {full_url} を完全版の URL に置き換える（parent_job_id）
 *   channels（例 ["youtube","shorts"]）は送るチャネル。x を外すことだけができ、外したときは x_text・full-x.mp4 を受けず、
 *   X の下書き・item・job を作らない（BOA-1167、2026-10-27 オーナー決定「全貌の入口は Shorts、X は不要」）。無い bundle は今までどおり X も出す
 *   youtube_full.thumbnail（型 f01、例 "thumb-full.png"）があれば、フォルダのその名前の画像（PNG・JPEG）を完全版のサムネイルとして
 *   完全版の下書きの cover_image_path に入れる。送信は動画の upload の後に thumbnails.set で上げる（BOA-1172）。欄が無い bundle は今までどおり
 *
 * 1. 検査: 欄・P0 が0件・機械の検査が全部通った・禁止表現・動画の大きさ・レースが今日あり中止でない・締切の45分前より前
 *    文に焼き込んだ「締切HH:MM」が今の締切と合う（文に無ければ見ない、bakedDeadlineReasons）
 *    同じレースの生きた全貌の item があれば、締切が違い・前の束がまだ送信を始めていない・版が違うときだけ差し替える（BOA-1201、supersedePlan）。
 *    ほかは拒否する（同じ締切は重複）
 *    --dry-run はここまで（DB・Storage に書かない。差し替えも書かない）
 * 1b. 差し替え: 前の item を stopped（superseded）にし、続けて前の job を hold（superseded）にする。落ちたら新しい束を作らない
 * 2. 動画（とサムネイル）を Storage（sns-hub-media/full-picture/{race_id}/{版}/）に上げる
 * 3. X・YouTube の下書き（send_lane=A、format=full_picture）と item（kind=full_picture）を作る
 *    X の日の枠の全貌の取り置き（182）に1本が入らなければ X の下書きを作らず、YouTube（完全版・Shorts）だけを送る
 * 4. チャネルが mode=auto なら item を notified にして自動送信の承認者で承認する（送る時刻は締切の60分前と今から5分後の遅い方）。
 *    mode=manual なら item を manual にして、個別承認の画面に回す
 * 5. Slack（SLACK_WEBHOOK_URL、無ければ SLACK_DIGEST_WEBHOOK_URL）に、送る時刻と止める SQL を知らせる
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jstTime, supersedePlan } from "../lib/sns/fullPictureShape.js";
import { draftRows } from "../lib/sns/fullPictureRows.js";
import { checkFullPicture } from "./pushFullPictureCheck.js";
import {
  approveMade,
  createDraftsAndItems,
  planChannels,
  preflight,
  readMedia,
  rejecter,
  revisionOf,
  saveMedia,
  noticeText,
} from "./pushFullPictureParts.js";
import { createRestStore } from "./pushFullPictureStore.js";

// 取り込みの外から使われる名前は、元の場所（このファイル）から引き続き import できる
export {
  FULL_PICTURE_FORMAT,
  FILES,
  MAX_BYTES,
  thumbnailKind,
  SHORTS_BUNDLE_VERSION,
  SHORTS_MACHINE_CHECKS,
  SHORTS_OFFSET_MIN,
  SHORTS_LATEST_BEFORE_MIN,
  NOTIFY_BEFORE_MIN,
  VETO_BEFORE_MIN,
  EXPIRES_BEFORE_MIN,
  LATEST_BEFORE_MIN,
  SEND_GRACE_MIN,
  YOUTUBE_OFFSET_MIN,
  schedule,
  sendAtOf,
  supersedePlan,
  bakedDeadlineReasons,
} from "../lib/sns/fullPictureShape.js";
export {
  fullTagsOf,
  fullYoutubeText,
  draftRows,
} from "../lib/sns/fullPictureRows.js";
export { THUMBNAIL_MAX_BYTES } from "./pushFullPictureParts.js";
export { checkFullPicture, createRestStore };

/**
 * 前の束を止める（BOA-1201）。item を先に stopped（superseded）にして一意の索引（172 の sns_auto_send_items_race_channel）から外し、
 * 続けて queued の job を hold（理由 superseded）にする。item が先なのは、hold の前に claim されても transition_sns_x_send が
 * auto_stopped で止めるため。どこかで落ちたら投げる（呼ぶ側は新しい束を作らない）
 */
async function supersede(store, items, now) {
  for (const item of items)
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
  let held = 0;
  for (const item of items)
    for (const job of item.jobs.filter((j) => j.state === "queued")) {
      await store.holdJob(job.id, "superseded");
      held += 1;
    }
  return held;
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons } （不合格）か { channels: { x: {...}, youtube: {...}, shorts: {...} } }（作ったチャネルだけ）
 */
export async function pushFullPicture(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const reject = rejecter({ bundle, notify, dryRun });
  const reasons = checkFullPicture(bundle, riskRules);
  const media = await readMedia(folder, bundle, readBytes);
  reasons.push(...media.reasons);
  const { files, thumbnail } = media;
  if (reasons.length) return reject(reasons);
  const pre = await preflight({ store, bundle, now });
  if (pre.reasons) return reject(pre.reasons);
  const { deadlineAt, when } = pre;
  const revision = revisionOf(bundle, files, thumbnail);
  // 同じレースの生きた全貌の item（BOA-1201）。あれば一意の索引（172）に当たるので、差し替えるか拒否するかを先に決める
  const plan = supersedePlan(await store.liveFullPicture(bundle.race_id), {
    deadlineAt,
    revision,
  });
  if (plan.reasons) return reject(plan.reasons);
  const { shortsLate, xSlot, channels } = await planChannels({
    store,
    bundle,
    plan,
    deadlineAt,
    now,
  });
  const replacing = plan.items.length
    ? { from: plan.from, to: jstTime(deadlineAt), items: plan.items.length }
    : null;
  if (dryRun)
    return { dryRun: true, revision, when, shortsLate, xSlot, replacing };

  if (replacing) {
    try {
      replacing.held_jobs = await supersede(store, plan.items, now);
    } catch (error) {
      // 新しい item は作らない（送らない側に倒す）。止めた item の job は claim で auto_stopped、残った item は deadline_changed で止まる
      return reject([
        `前の束（締切 ${replacing.from}）の差し替えに失敗したので、新しい束を作らない: ${error.message}`,
      ]);
    }
  }

  const paths = await saveMedia({
    store,
    bundle,
    revision,
    channels,
    files,
    thumbnail,
  });
  const observedAt = now.toISOString();
  const rows = draftRows(bundle, { revision, paths, when, observedAt });
  const controls = await store.controls();
  const { out, made, shortsError } = await createDraftsAndItems({
    store,
    bundle,
    channels,
    rows,
    controls,
    when,
    observedAt,
  });
  await approveMade({ store, made, out, paths, files, thumbnail, when });
  await notify(
    noticeText({
      bundle,
      deadlineAt,
      out,
      controls,
      replacing,
      shortsError,
      xSlot,
      shortsLate,
    }),
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return {
    channels: out,
    revision,
    when,
    shortsLate,
    shortsError,
    xSlot,
    replacing,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/push-full-picture.js <フォルダ> [--dry-run]",
    );
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  const result = await pushFullPicture(folder, {
    store: createRestStore({ url, key }),
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: async (text) => {
      console.log(text);
      if (webhook)
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
    },
    riskRules,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.reasons?.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
