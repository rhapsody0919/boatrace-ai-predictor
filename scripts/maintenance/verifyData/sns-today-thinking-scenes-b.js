/**
 * verify-sns-today-thinking.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-thinking.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { pushFinalsImage } from "../../sns/push-finals-image.js";
import { runSnsTodayThinkingScenes1 } from "./sns-today-thinking-scenes-1.js";
import { runSnsTodayThinkingScenes2 } from "./sns-today-thinking-scenes-2.js";
import { runSnsTodayThinkingScenes3 } from "./sns-today-thinking-scenes-3.js";

let all,
  at,
  BASE_FILES,
  bundle,
  CLEAR_SQL,
  CONTROL_SQL,
  DAY,
  db,
  DEADLINE,
  first,
  IMAGES,
  md5,
  MD5_182,
  MD5_188,
  MIGRATION,
  migration189ForTest,
  NAMES,
  NOW,
  openDb,
  OTHER_RACE,
  POLL,
  PUSHED_AT,
  RACE,
  replyBundle,
  riskRules,
  saved,
  setClock,
  slotAsked,
  sqlOf,
  stageCalls,
  store,
  sttState,
  TODAY_DRAFT,
  transitionBody;

const push = (b = bundle(), opts = {}, deps = store) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...Object.fromEntries(
      Object.entries(IMAGES(b.images ?? NAMES)).map(([name, bytes]) => [
        `/f/${name}`,
        bytes,
      ]),
    ),
  };
  const notes = [];
  return pushFinalsImage("/f", {
    store: deps,
    readBytes: async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};

const transition = async (jobId, action, result = {}, pg = db) =>
  (
    await pg.query("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
      jobId,
      action,
      JSON.stringify(result),
    ])
  ).rows[0].r;

const claim = (jobId) => transition(jobId, "claim");

async function post(jobId, tweetId, postedAt) {
  await claim(jobId);
  await transition(jobId, "begin_post");
  await transition(jobId, "complete", { id: tweetId, posted_at: postedAt });
}

const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});

const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

/** 送り手の読み直し（readCurrent）に PGlite の行を渡す。読んだ表を残す */
const readTables = [];

function sttb1Scene1() {
  // ---- 後半の場面（verifyData/sns-today-thinking-scenes-1.js・sns-today-thinking-scenes-2.js・sns-today-thinking-scenes-3.js） ----
  runSnsTodayThinkingScenes1({
    BASE_FILES,
    MIGRATION,
    MD5_182,
    MD5_188,
    sqlOf,
    md5,
    transitionBody,
    migration189ForTest,
    db,
    first,
    all,
    RACE,
    DEADLINE,
    at,
    NOW,
    setClock,
    saved,
    stageCalls,
    store,
    slotAsked,
    POLL,
    replyBundle,
    push,
    transition,
    claim,
    post,
    readTables,
  });
  runSnsTodayThinkingScenes2({
    db,
    first,
    riskRules,
    RACE,
    OTHER_RACE,
    DAY,
    CLEAR_SQL,
    TODAY_DRAFT,
    sttState,
    stageCalls,
    bundle,
    replyBundle,
    push,
    claim,
    counts,
    NOTHING,
  });
  runSnsTodayThinkingScenes3({
    openDb,
    db,
    first,
    all,
    riskRules,
    RACE,
    DAY,
    DEADLINE,
    at,
    NOW,
    setClock,
    CONTROL_SQL,
    CLEAR_SQL,
    store,
    slotAsked,
    bundle,
    push,
    transition,
    claim,
    post,
    counts,
    NOTHING,
    readTables,
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MD5_182・MD5_188・sqlOf・md5・transitionBody・migration189ForTest・openDb・db・first・all・riskRules・RACE・OTHER_RACE・DAY・DEADLINE・NAMES・at・NOW・PUSHED_AT・setClock・CONTROL_SQL・CLEAR_SQL・TODAY_DRAFT・sttState・saved・stageCalls・store・slotAsked・POLL・bundle・replyBundle・IMAGES） */
export function runSnsTodayThinkingScenesB1(env) {
  ({
    IMAGES,
    replyBundle,
    bundle,
    POLL,
    slotAsked,
    store,
    stageCalls,
    saved,
    sttState,
    TODAY_DRAFT,
    CLEAR_SQL,
    CONTROL_SQL,
    setClock,
    PUSHED_AT,
    NOW,
    at,
    NAMES,
    DEADLINE,
    DAY,
    OTHER_RACE,
    RACE,
    riskRules,
    all,
    first,
    db,
    openDb,
    migration189ForTest,
    transitionBody,
    md5,
    sqlOf,
    MD5_188,
    MD5_182,
    MIGRATION,
    BASE_FILES,
  } = env);
  sttb1Scene1();
}
