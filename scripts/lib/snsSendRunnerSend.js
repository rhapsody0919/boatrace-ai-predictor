/**
 * snsSendRunnerParts.js から分けた、候補を順に送る段（sendCandidates）と、非公開で残した YouTube の見直しの段（resumeRetainedJobs）。
 * 元は snsSendRunner.js の runSnsSend の中。振る舞いは元のまま。
 */
import {
  adapterFor,
  headlessNeed,
  positionOf,
  reconcileLabel,
  recordEvent,
  RESUME_RETRY_MINUTES,
  sendFailureOf,
  sendYoutube,
  slug,
  tell,
  YOUTUBE_RESUME_CHECKS,
  YOUTUBE_RESUME_MAX,
  YOUTUBE_RESUME_START_LIMIT_SEC,
  youtubeQuotaDayWait,
} from "./snsSendRunnerParts.js";

/** 途中で止めた時の次の実行の起点: 最後に見た job の位置（先頭なら前の実行の位置） */
function stopCursor(rs, candidates, index) {
  return index > 0
    ? positionOf(candidates[index - 1])
    : (rs.ctx.state?.cursor ?? null);
}

/** YouTube は PT の日付境界の前後は待つ（claim しない）。待つなら true（outcome と通知は付け済み） */
function deferYoutube(rs, controls, job, result) {
  if (
    job.channel !== "youtube" ||
    !rs.live ||
    controls.youtube?.dry_run !== false ||
    !youtubeQuotaDayWait(rs.ctx.now())
  )
    return false;
  result.outcome = "youtube_quota_day_wait";
  rs.alerts.push({
    key: `youtube_quota_day_wait:${job.id}`,
    text: `SNS の送信: YouTube job ${job.id} は太平洋時間の日付境界（前10分・後5分）のため待機（claim していない）。期限 ${job.expires_at}`,
    until: rs.continuingUntil,
  });
  return true;
}

// 検査の枠（BOA-1164）: この実行で既に検査を使い、残りでこの job を最後まで送れないなら、ここから先は次の実行に回す。
// 先に別のレースの X が枠を使い、YouTube が公開の準備の後の検査で public_check_budget になって非公開のまま残った（10/25 浜名湖10R）。
// 最初の job は必要数が上限を超えても進める（回し続けて永久に送らないことを避ける）。回すなら true
function headlessBudgetWait(rs, controls, job, result) {
  const need = headlessNeed(
    job,
    rs.live && controls[job.channel]?.dry_run === false,
  );
  if (rs.checks > 0 && rs.checks + need > rs.headlessBudget) {
    result.outcome = "headless_budget_wait";
    return true;
  }
  return false;
}

/** claim の前の送る前の検査（元の try/catch）。落ちたら通知・記録を付けて true */
async function precheckFailed(rs, job, result) {
  try {
    await rs.countedPreflight(job);
  } catch (error) {
    result.outcome = "precheck_failed";
    result.reason = error.holdReason ?? slug(error.message);
    rs.alerts.push({
      key: `precheck:${job.id}:${result.reason}`,
      text: `送る前の検査で止めた（claim していない）: ${job.channel} job ${job.id} 理由 ${result.reason}`,
      until: rs.continuingUntil,
    });
    await recordEvent(rs, job, "precheck", result.reason, error.message);
    return true;
  }
  return false;
}

/** トークン（claim の前）。取れなければ通知を足して null、取れれば {adapter} */
async function tokenForSend(rs, job, result) {
  const got = await adapterFor(rs, job.channel);
  const { error: tokenError } = got;
  if (tokenError) {
    result.outcome = "token_failed";
    if (!rs.tokenChecked.has(job.channel))
      rs.alerts.push({
        key: `token:${job.channel}`,
        text: `${job.channel} のトークンを取れないので送信していない（claim していない）: ${tokenError.message}`,
        until: rs.continuingUntil,
      });
    rs.tokenChecked.add(job.channel);
    return null;
  }
  rs.tokenChecked.add(job.channel);
  return got;
}

/** claim 以降の送信（X は runXSendJob、YouTube は sendYoutube） */
function dispatchSend(rs, job, adapter, result) {
  return job.channel === "x"
    ? rs.api.runXSendJob(job.id, {
        store: rs.store,
        x: adapter,
        loadMedia: rs.loadMedia,
        wait: rs.wait,
        preflight: rs.countedPreflight,
      })
    : sendYoutube(job, {
        store: rs.store,
        youtube: adapter,
        preflight: rs.countedPreflight,
        loadMedia: rs.loadMedia,
        wait: rs.wait,
        shouldStop: rs.ctx.shouldStop,
        pollWaitSec: rs.pollWaitSec,
        api: rs.api,
        onThumbnailFailed: (reason) => {
          result.thumbnail_error = reason;
        },
      });
}

/** 送信の結果（done）を result・通知・alerts に写す（元の try の後半） */
async function recordSendDone(rs, job, result, done) {
  result.outcome = done.state;
  result.error_code = done.error_code ?? null;
  if (done.state === "posted") rs.posted += 1;
  // 出し物ごとの取り置き（182）で claim が止めた。取り置きは後から空かないので一度きりの事象として知らせる
  if (done.state === "held" && done.error_code === "kind_slot_full")
    await tell(
      rs,
      `held:${job.id}`,
      `SNS の送信を止めた（X の日の枠の出し物ごとの取り置きに入らない、kind_slot_full）: ${job.channel} job ${job.id}。送るなら取り置き（sns_x_kind_reserves）か daily_limit_x を見直して再承認する`,
    );
  // 要照合になったら、この実行の report にも出す（次の実行からは DB の状態から作る）
  if (done.state === "reconcile")
    rs.alerts.push({
      key: `reconcile:${job.id}`,
      text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${reconcileLabel(done)}）。管理画面で照合する`,
    });
}

/** 送信の例外（元の catch）。job の状態（held・要照合）は送信の関数が DB に残している。ここでは理由を知らせるだけ */
async function reportSendError(rs, job, result, error) {
  result.outcome = "error";
  const failure = sendFailureOf(error);
  result.reason = failure.reason;
  await recordEvent(rs, job, failure.stage, failure.reason, failure.detail);
  await tell(
    rs,
    `send:${job.id}`,
    `SNS の送信が止まった: ${job.channel} job ${job.id}: ${error.message}`,
  );
}

/**
 * 候補1件の流れ（元の for の中身）。この実行をここで止めるなら "stop"（呼び元が cursor を決める）、次の候補へ進むなら null
 */
async function sendOneJob(rs, controls, job, result) {
  if (deferYoutube(rs, controls, job, result)) return null;
  if (headlessBudgetWait(rs, controls, job, result)) return "stop";
  if (await precheckFailed(rs, job, result)) return null;
  // dry_run の行が無い（153 未適用など）ときも送らない（fail-closed）
  if (!rs.live || controls[job.channel]?.dry_run !== false) {
    result.outcome = rs.live ? "dry_run" : "shadow";
    return null;
  }
  // トークンの取得と claim の前にも、関数の時間の残りを確かめる（途中で切れて要照合にしないため）
  if (rs.ctx.shouldStop()) {
    result.outcome = "deferred";
    return "stop";
  }
  const token = await tokenForSend(rs, job, result);
  if (!token) return null;
  // 検査やトークン取得を待つ間に停止窓へ入った場合も claim しない。
  if (deferYoutube(rs, controls, job, result)) return null;
  rs.attempted += 1;
  try {
    await recordSendDone(
      rs,
      job,
      result,
      await dispatchSend(rs, job, token.adapter, result),
    );
  } catch (error) {
    await reportSendError(rs, job, result, error);
  }
  // サムネイルの失敗は一度きりの事象（動画の送信は続けた。後で公開に失敗したときも、サムネイルの理由は別に知らせる）
  if (result.thumbnail_error)
    await tell(
      rs,
      `thumbnail:${job.id}`,
      `SNS の送信: YouTube job ${job.id} のサムネイルを設定できなかった（動画の送信は続けた）: ${result.thumbnail_error}。403 はチャンネルの確認（カスタムサムネイルの権限）が無いときにも返る。付けるなら Studio で設定する`,
    );
  return null;
}

/** 候補を順に送る。返すのは次の実行の cursor: 途中で止めたら最後に見た job の位置、最後まで見たら DB の読み取りの続き（nextCursor） */
export async function sendCandidates(rs, controls, candidates, nextCursor) {
  let cursor = nextCursor;
  for (const [index, job] of candidates.entries()) {
    if (rs.attempted >= rs.maxJobs || rs.ctx.shouldStop()) {
      cursor = stopCursor(rs, candidates, index);
      break;
    }
    const result = { id: job.id, channel: job.channel };
    rs.results.push(result);
    if ((await sendOneJob(rs, controls, job, result)) === "stop") {
      cursor = stopCursor(rs, candidates, index);
      break;
    }
  }
  return cursor;
}

/** 見直しを始めてよいか（元の if の条件。この順に評価する） */
function canResume(rs, controls) {
  return (
    rs.live &&
    rs.store.resumableYoutubeJobs &&
    rs.ctx.now().getTime() - rs.now.getTime() <=
      YOUTUBE_RESUME_START_LIMIT_SEC * 1000 &&
    controls.youtube?.dry_run === false &&
    !youtubeQuotaDayWait(rs.ctx.now())
  );
}

/** 見直す候補1件の送信（元の try/catch）。失敗は理由を記録し、読み直さない印を resumeRetry に足す */
async function resumeOne(rs, job, adapter, result, resumeRetry) {
  try {
    const done = await rs.api.resumeRetainedYoutubeJob(job, {
      store: rs.store,
      youtube: adapter,
      preflight: rs.countedPreflight,
    });
    result.outcome =
      done.state === "reconcile" && done.youtube_stage === "private_retained"
        ? "youtube_still_processing"
        : done.state;
    result.error_code = done.error_code ?? null;
    if (done.state === "posted") rs.posted += 1;
  } catch (error) {
    result.outcome = "error";
    const failure = sendFailureOf(error);
    result.reason = failure.reason;
    await recordEvent(rs, job, failure.stage, failure.reason, failure.detail);
    // 本人の非公開の動画と確かめられない（公開・限定公開・削除済み）なら、期限まで読み直さない（期限の後は閉じる道が確かめる）
    resumeRetry.push({
      id: job.id,
      until:
        error.message === "youtube_processing_unconfirmed"
          ? job.expires_at
          : new Date(
              rs.now.getTime() + RESUME_RETRY_MINUTES * 60000,
            ).toISOString(),
    });
    await tell(
      rs,
      `resume:${job.id}`,
      `SNS の送信: 非公開で残した YouTube job ${job.id} を公開に進められなかった: ${error.message}`,
    );
  }
}

// 処理待ち・検査の枠で非公開のまま残した YouTube を、期限の前に見直す（BOA-1283）。読み取り1回（クォータ1）で処理が済んでいれば公開する。
// 公開には検査が2回（youtube_publish_begin の前・videos.update の前）要るので、この実行の枠に残りが無ければ次の実行に回す。
// この実行で上げて残したばかりの job は見ない（処理の確認をしたばかり）
export async function resumeRetainedJobs(rs, controls, resumeRetry) {
  if (!canResume(rs, controls)) return;
  const touched = new Set([
    ...rs.results.map((r) => r.id),
    ...resumeRetry.map((r) => r.id),
  ]);
  const resumable = (
    await rs.store.resumableYoutubeJobs(
      rs.ctx.now(),
      YOUTUBE_RESUME_MAX + touched.size,
    )
  )
    .filter((j) => !touched.has(j.id))
    .slice(0, YOUTUBE_RESUME_MAX);
  for (const job of resumable) {
    if (rs.ctx.shouldStop()) break;
    if (rs.checks > 0 && rs.checks + YOUTUBE_RESUME_CHECKS > rs.headlessBudget)
      break;
    const result = { id: job.id, channel: "youtube", resumed: true };
    rs.results.push(result);
    const { adapter, error: tokenError } = await adapterFor(rs, "youtube");
    if (tokenError) {
      result.outcome = "token_failed";
      rs.alerts.push({
        key: `token:youtube`,
        text: `youtube のトークンを取れないので、非公開で残した job ${job.id} を見直していない: ${tokenError.message}`,
        until: rs.continuingUntil,
      });
      rs.tokenChecked.add("youtube");
      break;
    }
    await resumeOne(rs, job, adapter, result, resumeRetry);
  }
}
