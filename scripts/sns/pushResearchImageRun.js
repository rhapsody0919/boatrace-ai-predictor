// push-research-image.js から移した、受け取って送る予定に入れる pushDailyImage（段ごとに関数へ割った）・item の生死の確認 liveOf・その日の状態 researchStatus
import { createHash } from "node:crypto";
import path from "node:path";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { dailyIdOf } from "../../api/_lib/snsResearchImage.js";
import { PUSH_RULES } from "../lib/sns/researchPushRules.js";
import {
  checkTiming,
  dryRunClock,
  jstDate,
  jstTime,
  observedAtOf,
  schedule,
} from "../lib/sns/researchSchedule.js";
import {
  checkImages,
  dailyLimitReason,
  RETRYABLE_JOB_STATES,
} from "./push-finals-image.js";
import {
  checkResearchBundle,
  RESEARCH_TYPE,
} from "./pushResearchImageChecks.js";
import { dailyStatusOf, draftRow, itemRow } from "./pushResearchImageRows.js";

const stopSql = (type) =>
  `UPDATE public.sns_auto_send_control SET ${type.enabledColumn} = false WHERE channel = 'x';`;

/**
 * 同じ日の生きている item を見る。送った・送っている・待っている item があれば { already } を返す（1日1本）。
 * 自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無い item は、作り直す対象として返す
 */
async function liveOf(store, date, type) {
  const live = (await store.researchItems(date)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (
      item.state === "notified" &&
      (!job || RETRYABLE_JOB_STATES.includes(job.state))
    )
      retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じ日の ${type.kind} が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: dailyStatusOf(type, item, job),
        },
      };
  }
  return { retry };
}

/** 検査・時刻の検査（reasons が返れば不合格）。通れば送る時刻の表と集計の時刻を返す */
function checkBeforeLive({ bundle, riskRules, type, researchId, now }) {
  const reasons = checkResearchBundle(bundle, riskRules, type);
  if (reasons.length) return { reasons };
  if (!type.parseId(researchId))
    return { reasons: [`${type.idField} が作れない`] };
  const when = schedule(bundle, now);
  const observedAt = observedAtOf(bundle);
  const timing = checkTiming(bundle, when, now, observedAt);
  if (timing.length) return { reasons: timing };
  return { when, observedAt };
}

/** 画像を読んで検査する（reasons が返れば不合格） */
async function readImage(folder, readBytes, bundle) {
  const [name] = bundle.images;
  let bytes;
  try {
    bytes = await readBytes(path.join(folder, name));
  } catch (error) {
    // 無い（ENOENT）は checkImages が「無い」と書く。それ以外（権限・I/O）は原因を残す
    if (error?.code && error.code !== "ENOENT")
      return {
        reasons: [`${name} を読めない（${error.code}: ${error.message}）`],
      };
  }
  const imageReasons = checkImages([name], { [name]: bytes });
  return imageReasons.length ? { reasons: imageReasons } : { bytes };
}

/** X の日の上限の理由（無ければ null）。その日の送信の記録と上限の設定を読む */
async function dailyLimitOf(store, now) {
  const [sendControl, todayJobs] = await Promise.all([
    store.sendControl(),
    store.jobsAttemptedOn(jstDate(now)),
  ]);
  return dailyLimitReason({ sendControl, jobs: todayJobs, now });
}

/** 前の item を止め、下書きを公開保留に戻す（148 のトリガーが承認を外し、queued・held の job を取り消す） */
async function supersedeItems(store, items, now) {
  for (const item of items) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
}

/** 自動の承認（snapshot・job）。落ちたら item を held_manual にして { error } を返す */
async function approveAuto({
  store,
  draft,
  item,
  controls,
  imagePath,
  bytes,
  when,
}) {
  try {
    const snapshot = await createXSnapshot(draft, async (p) =>
      p === imagePath ? bytes : Promise.reject(new Error("媒体の path が違う")),
    );
    const job = await store.approve({
      p_draft_id: draft.id,
      p_approver_id: controls.x.auto_approver_id,
      p_snapshot: snapshot,
      p_scheduled_at: when.send_at,
    });
    if (!job?.id) throw new Error("job の id を受け取れない");
    return { job_id: job.id, send_at: when.send_at };
  } catch (error) {
    let message = error.message;
    // 承認に落ちた item は held_manual にして、次の呼び出しで作り直せるようにする（1日1本の索引から外れる）
    await store
      .updateItem(item.id, "notified", {
        state: "held_manual",
        held_reason: `自動の承認に失敗: ${error.message.split("\n")[0]}`,
      })
      .catch((updateError) => {
        // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
        console.error(
          `item ${item.id} を held_manual に戻せない: ${updateError.message}`,
        );
        message += `（item を戻せない: ${updateError.message}）`;
      });
    return { error: message };
  }
}

/** 画像の保存・下書き・item の追加と、自動なら承認。返り値は pushDailyImage の out（when・revision の前まで） */
async function writeAndApprove(ctx) {
  const { store, bundle, type, when, observedAt, revision, bytes, now } = ctx;
  const { controls, researchId } = ctx;
  const imagePath = `${type.storagePrefix}/${bundle.date}/${bundle.slug}/${revision}.png`;
  await store.saveFile(imagePath, bytes);
  const checkedAt = now.toISOString();
  const auto = controls.x?.mode === "auto" && controls.x?.auto_approver_id;
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, imagePath, when, observedAt }, type),
  );
  const item = await store.insertItem(
    itemRow(
      bundle,
      {
        draftId: draft.id,
        when,
        state: auto ? "notified" : "held_manual",
        checkedAt,
        heldReason: auto
          ? null
          : "自動モードでない（この型は自動の道だけで送る）",
      },
      type,
    ),
  );
  const out = {
    [type.idField]: researchId,
    draft_id: draft.id,
    item_id: item.id,
    auto: Boolean(auto),
  };
  if (!auto) return out;
  return {
    ...out,
    ...(await approveAuto({
      store,
      draft,
      item,
      controls,
      imagePath,
      bytes,
      when,
    })),
  };
}

/** Slack に出す1行（送る時刻・承認の失敗・自動でない） */
function resultNoticeLine(out, when, controls) {
  return out.send_at
    ? `x: ${jstTime(when.send_at)} に送る（期限 ${jstTime(when.expires_at)}）${controls.x?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : out.error
      ? `x: 自動の承認に失敗（送らない）: ${out.error}`
      : "x: 自動モードでないので送らない";
}

/** --dry-run で今日でない日の束を通す時計（simulated）と、結果に足す欄（dryRunAhead の型だけ。書く道では使わない） */
function simulatedClock(bundle, realNow, dryRun, type) {
  // --dry-run で今日でない日の束（hq の見本・前日の試し）は、その日の送る時刻の2分前の時計で時刻の検査を通す（dryRunAhead の型だけ。
  // push-setsu-kiryoku-short.js と同じ時計）。その日の X の日の上限はまだ決まらないので見ない（limit_checked=false、結果の1行に simulated_now）。
  // Shorts は今の値で上限を見るが、X の上限は daily_baseline_date が今日の分しか無いので、別の日には当てられない。書く道では使わない
  const simulated =
    dryRun && PUSH_RULES[type.kind].dryRunAhead
      ? dryRunClock(bundle, realNow)
      : null;
  const extra = simulated
    ? { simulated_now: simulated.toISOString(), limit_checked: false }
    : {};
  return { simulated, extra, now: simulated ?? realNow };
}

/** bundle の date・slug から作る id（作れなければ null） */
const researchIdOf = (type, bundle) =>
  bundle?.date && bundle?.slug
    ? dailyIdOf(type, bundle.date, bundle.slug)
    : null;

/** 検査で拒否したときの返り値を作る関数（書く道なら Slack に通知する） */
const rejecter =
  ({ writes, notify, type, researchId, extra }) =>
  async (reasons) => {
    if (writes)
      await notify(
        `SNS ${type.label} ${researchId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { [type.idField]: researchId, reasons, ...extra };
  };

/** 書かずに返すときの結果（--dry-run、または許可が off） */
function dryRunResult({
  type,
  researchId,
  enabled,
  dryRun,
  revision,
  when,
  extra,
}) {
  return {
    [type.idField]: researchId,
    dryRun: true,
    enabled,
    // --dry-run でなく、許可が off なので書かなかった（exit 3）
    disabled: !dryRun,
    revision,
    when,
    ...extra,
  };
}

/** 型（type）ごとの受け取り。返り値の id は type.idField（research_id・setsu_id）のキー */
export async function pushDailyImage(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now: realNow = new Date(),
    dryRun = false,
    type = RESEARCH_TYPE,
  },
) {
  const idKey = type.idField;
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const { simulated, extra, now } = simulatedClock(
    bundle,
    realNow,
    dryRun,
    type,
  );
  const researchId = researchIdOf(type, bundle);
  const controls = await store.controls();
  // 列が無い（179・194 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.x?.[type.enabledColumn] === true;
  const writes = enabled && !dryRun;
  const reject = rejecter({ writes, notify, type, researchId, extra });
  const checked = checkBeforeLive({ bundle, riskRules, type, researchId, now });
  if (checked.reasons) return reject(checked.reasons);
  const { when, observedAt } = checked;
  // 同じ日の生きている item・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、179）
  const live = await liveOf(store, bundle.date, type);
  if (live.already) return { [idKey]: researchId, ...live.already };
  const image = await readImage(folder, readBytes, bundle);
  if (image.reasons) return reject(image.reasons);
  const { bytes } = image;
  const limitReason = simulated ? null : await dailyLimitOf(store, now);
  if (limitReason) return reject([limitReason]);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  hash.update(bytes);
  const revision = hash.digest("hex").slice(0, 32);
  if (!writes)
    return dryRunResult({
      type,
      researchId,
      enabled,
      dryRun,
      revision,
      when,
      extra,
    });

  await supersedeItems(store, live.retry, now);
  const out = await writeAndApprove({
    store,
    bundle,
    type,
    when,
    observedAt,
    revision,
    bytes,
    now,
    controls,
    researchId,
  });
  await notify(
    `SNS ${type.label} ${researchId}\n${resultNoticeLine(out, when, controls)}\n止めるには: ${stopSql(type)}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

/** 送る前の検査で落ちた理由（送り手の最後の報告の alerts から。読めなければ null） */
async function precheckReasonOf(store, job) {
  // 送る前の検査（readCurrent・preflight）で落ちた job は claim されず queued のまま、期限の後に deadline_expired になるので、
  // job に理由が残らない。送り手の最後の報告（scrape_job_state の sns_send の last_report.alerts、key は precheck:{job_id}:{理由}）から引く。
  // 報告は2分ごとに上書きされ、理由は見直すまで30分だけ残る（snsSendRunner.js の CONTINUING_ALERT_MINUTES）。読めなければ null
  const report = await store.sendReport().catch((error) => {
    console.error(`送り手の報告を読めない: ${error.message}`);
    return null;
  });
  const prefix = `precheck:${job.id}:`;
  const alert = (report?.alerts ?? []).find((a) => a?.key?.startsWith(prefix));
  return alert ? alert.key.slice(prefix.length) : null;
}

/**
 * その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null。
 * job が queued のまま送る時刻を過ぎていれば、日の上限の見込み（blocked_hint）を添える（claim が「日次全体上限です」で投げている間は
 * job に error_code が残らず、期限の後に deadline_expired になるため）
 */
export async function researchStatus(
  date,
  { store, now = new Date(), type = RESEARCH_TYPE },
) {
  const items = await store.researchItems(date);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  const job = await store.jobForDraft(item.draft_id);
  const status = dailyStatusOf(type, item, job);
  if (job && job.state !== "posted" && store.sendReport)
    status.precheck_reason = await precheckReasonOf(store, job);
  if (
    job?.state === "queued" &&
    job.scheduled_at &&
    now.getTime() > Date.parse(job.scheduled_at) + 5 * 60000
  )
    status.blocked_hint =
      (await dailyLimitOf(store, now)) ??
      "送る時刻を過ぎて待っている（送り手の検査の通知を Slack で見る）";
  return status;
}
