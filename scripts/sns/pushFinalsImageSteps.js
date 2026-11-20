// pushFinalsImage（push-finals-image.js）の段ごとの処理。受け取りの検査・前の item の探し・予定に入れた後の書き込みと通知を、元の順のまま取り出した。
import { createHash } from "node:crypto";
import { checkXSlot } from "../lib/snsXSlots.js";
import {
  REPLY_EARLIEST_BEFORE_MIN,
  REPLY_LATEST_BEFORE_MIN,
  dailyLimitReason,
  jstDate,
  jstTime,
} from "../lib/sns/finalsImageBase.js";
import { todayTargetReason } from "../lib/sns/thinkingGradeDay.js";
import { checkRace } from "./pushFinalsImageChecks.js";
import { liveOf, pushMainRows, pushReplyRows } from "./pushFinalsImageRows.js";

/** 検査で拒否したときの返し方。書く許可があるときだけ Slack に知らせる */
export const makeReject =
  ({ writes, notify, label, bundle, head }) =>
  async (reasons) => {
    if (writes)
      await notify(
        `SNS ${label} ${bundle?.race_id ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { ...head, reasons };
  };

/** 本投稿を作り直すなら、前の投票のリプも止める（今度の bundle に投票が無くても止める。BOA-1208） */
const pollItemsToStop = async (store, bundle, cfg, kind) =>
  (await store.finalsItems(bundle.race_id, cfg.variants.poll, kind)).filter(
    (i) => !["stopped", "held_manual", "sent"].includes(i.state),
  );

/**
 * 展示後のリプの親は、送った本投稿（job が posted で tweet id がある）。item の状態ではなく job で見る
 * （要照合の後で手で complete した等で item が sent にならない場合も、送った本投稿につなぐ）
 */
async function postedMainJob(store, bundle, cfg, kind) {
  for (const item of await store.finalsItems(
    bundle.race_id,
    cfg.variants.main,
    kind,
  )) {
    const job = await store.jobForDraft(item.draft_id);
    if (job?.state === "posted" && job.external_post_id) return job;
  }
  return null;
}

/**
 * 起こす係（hq finals_run.py）は2分ごとに呼ぶ。同じレース・同じ種類の生きている item・送った item があれば { already }。
 * なければ作り直す対象の item（retry）と、展示後のリプの親の job（無ければ null）を返す
 */
export async function findPrior(store, bundle, { kind, cfg, part }) {
  const live = await liveOf(store, bundle.race_id, cfg.variants[part], kind);
  if (live.already) return { already: live.already };
  const retry = [...live.retry];
  if (part !== "reply")
    retry.push(...(await pollItemsToStop(store, bundle, cfg, kind)));
  const parentJob =
    part === "reply" ? await postedMainJob(store, bundle, cfg, kind) : null;
  return { retry, parentJob };
}

/** race・段・日の上限・思考投稿の対象・取り置きの検査。{ reasons, deadlineAt } を返す */
export async function receiveCheck({ store, bundle, cfg, reply, now, need }) {
  const [race, stage, sendControl, todayJobs, children, picks, twelves] =
    await Promise.all([
      store.race(bundle.race_id),
      // 段を見ない種類（思考投稿）は race_conditions を読まない
      cfg.stage ? store.stage(bundle.race_id) : null,
      store.sendControl(),
      store.jobsAttemptedOn(jstDate(now)),
      reply ? [] : store.waitingChildren(now),
      cfg.todayTarget ? store.todayPicks(jstDate(now)) : null,
      // その日の 12R（格の最上位の場を決める。思考投稿だけ）
      cfg.todayTarget ? store.twelfthRaces(jstDate(now)) : [],
    ]);
  const raceCheck = checkRace({
    bundle,
    race,
    stage,
    now,
    requiredStage: cfg.stage,
    ...(reply
      ? {
          earliestMin: REPLY_EARLIEST_BEFORE_MIN,
          latestMin: REPLY_LATEST_BEFORE_MIN,
        }
      : {}),
  });
  // 本投稿が上限で入らなければ投票のリプも作らない（投票があれば対で2本分）
  const limitReason = dailyLimitReason({
    sendControl,
    jobs: todayJobs,
    now,
    need,
    children,
  });
  if (limitReason) raceCheck.reasons.push(limitReason);
  if (cfg.todayTarget) {
    const targetReason = todayTargetReason(
      picks,
      bundle.race_id,
      race,
      twelves,
    );
    if (targetReason) raceCheck.reasons.push(targetReason);
  }
  // 出し物ごとの取り置き（182、docs/design/x-daily-slots/plan.md）。他の出し物の取り置きの残りを使わないか。
  // 182 の前・読めないときは上の日の上限だけで決める（送り手の claim が正）
  const xSlot = store.xSlotRoom
    ? await checkXSlot(store.xSlotRoom, cfg.slot, need)
    : null;
  if (xSlot?.blocked) raceCheck.reasons.push(xSlot.reason);
  if (xSlot?.note) console.error(xSlot.note);
  return raceCheck;
}

/** bundle と画像のバイトから版（revision）を作る */
export function revisionOf(bundle, names, files) {
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  for (const name of names) hash.update(files[name]);
  return hash.digest("hex").slice(0, 32);
}

/**
 * 前の item を止め、下書きを公開保留に戻す（148 のトリガーが承認を外し、queued・held の job を取り消す。
 * 止めた本投稿を親に持つ投票のリプの job が queued のまま残り、送り手が「親を待つ」を知らせ続けないように）
 */
async function stopSuperseded(store, retry, now) {
  for (const item of retry) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
}

/** 画像を Storage に保存し、その path の配列を返す */
async function saveImages(
  store,
  { cfg, bundle, revision, reply, names, files },
) {
  const paths = names.map(
    (name) =>
      `${cfg.storage}/${bundle.race_id}/${revision}/${reply ? "reply-" : ""}${name}`,
  );
  for (const [i, name] of names.entries())
    await store.saveFile(paths[i], files[name]);
  return paths;
}

/** Slack に出す結果の行 */
function resultNote({ out, reply, withPoll, when, controls }) {
  if (out.send_at)
    return `x: 今すぐ送る（送り手の次の実行、期限 ${jstTime(when.expires_at)}${withPoll ? "。投票のリプは本投稿の公開の後" : ""}）${controls.x?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`;
  if (out.error)
    return `x: 自動の承認に失敗（${reply ? "個別承認に回した" : withPoll ? "本投稿・投票のリプとも止めた" : "本投稿を止めた"}）: ${out.error}`;
  if (reply) return "x: 自動モードでないので個別承認で承認する";
  return withPoll
    ? "x: 自動モードでないので送らない（投票のリプは自動の道だけでつなぐ。本投稿だけを出さない）"
    : "x: 自動モードでないので送らない";
}

/** 前の item を止め、画像を保存し、行を作って承認し、Slack に知らせる。{ out } を返す */
export async function writeRows(
  store,
  { bundle, cfg, kind, reply, names, files, revision, when, now },
  { retry, controls, parentJob, withPoll, notify, label },
) {
  await stopSuperseded(store, retry, now);
  const paths = await saveImages(store, {
    cfg,
    bundle,
    revision,
    reply,
    names,
    files,
  });
  const observedAt = now.toISOString();
  const auto = controls.x?.mode === "auto" && controls.x?.auto_approver_id;
  const byPath = new Map(paths.map((p, i) => [p, files[names[i]]]));
  const common = {
    revision,
    paths,
    when,
    observedAt,
    auto,
    approverId: controls.x?.auto_approver_id,
    byPath,
    kind,
  };
  const out = reply
    ? await pushReplyRows(store, bundle, { ...common, parentJob })
    : await pushMainRows(store, bundle, { ...common, withPoll });
  const line = resultNote({ out, reply, withPoll, when, controls });
  await notify(
    `SNS ${label} ${bundle.race_id}（締切 ${jstTime(when.deadline_at)}）\n${line}\n止めるには: ${cfg.stopSql}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return out;
}
