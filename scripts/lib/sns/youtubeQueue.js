// YouTube の送信の列（queue・publish・見直し・閉じる・照合・偽の adapter）。api/_lib/snsDeadlineQueue.js から字のまま移した（api/ 側は再 export。
// 送信の runner scripts/lib/snsSendRunner.js が api/ を読まないため）。sha256 の動的 import の先だけ ./xSendCore.js に変えた
import { holdReasonOf } from './xSendCore.js';

/** 全貌の Shorts の説明文に置く、完全版の URL の置き場所（承認するのはこの文字列を含む文。送る時に親の動画の URL に置き換える） */
export const FULL_URL_PLACEHOLDER = '{full_url}';

/**
 * 置き場所を完全版の URL に置き換える（純粋関数）。置き場所はちょうど1つ、動画 ID は YouTube の11字だけを受ける。
 * 承認した文との差はこの URL だけ（ADR 0094 の追記）。親の external_post_id は complete の後に変わらないので、いつでも作り直せる
 */
export function fillFullUrl(text, videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')) throw new Error('parent_video_id_invalid');
  if (typeof text !== 'string' || text.split(FULL_URL_PLACEHOLDER).length !== 2) throw new Error('unresolved_placeholder');
  return text.replace(FULL_URL_PLACEHOLDER, `https://youtu.be/${videoId}`);
}

/** 既存YouTube uploadの非公開adapterを差し込む契約だけ。実API・cronは提供しない。
 * 予約はローカルjobのscheduled_at待ち。時刻到達後、再検査して即時公開する。
 * YouTube publishAtによる外部の自動公開は最終検査を保証できないため今回提供しない。
 * uploadはprivateのみ。processingとmakePublicは別段階。全て自動retry禁止。
 * 142のクォータ予約・呼出し前記録・公開確認契約はsns-hub-shorts-send/contract.md参照。
 * onThumbnailFailed(reason): サムネイル（thumbnails.set）の失敗を受け取る。渡すと失敗しても公開まで進み、渡さなければ今までどおり
 * 非公開のまま残す（BOA-1172。記録する先の無い呼び出しで黙って外さない）
 */
export async function runYoutubeQueueJob(id, { store, youtube, preflight, loadMedia, onThumbnailFailed }) {
  if (!youtube || !preflight) throw new Error('YouTube adapterは未接続です');
  const job = await store.transition(id, 'claim');
  if (job.state !== 'sending') return job;
  let started = false, uploadedKnown = false, publicationPhaseStarted = false;
  try {
    if (job.channel !== 'youtube') throw new Error('チャネルが違います');
    const { sha256 } = await import('./xSendCore.js');
    if (await sha256(new TextEncoder().encode(job.snapshot_text)) !== job.approved_hash) throw new Error('承認版が違います');
    const snapshot = JSON.parse(job.snapshot_text);
    assertMediaContract(snapshot);
    const verifiedMedia = await verifyMedia(snapshot, loadMedia, sha256);
    await fillParentUrl(snapshot, store);
    // adapter が送る前に分かる不備（題名の長さ等）は begin_post の前に落とす。後で落ちると、何も上がっていない job が要照合に残る
    if (youtube.validate) youtube.validate(snapshot);
    await checked(preflight, job);
    const beginning = await store.transition(id, 'begin_post');
    if (beginning.state !== 'reconcile') return beginning;
    started = true;
    // 実adapterは未提供。各Data API呼出しの直前に必ず台帳へ記録する契約。
    const beforeCall = async method => {
      await checked(preflight, job);
      await store.transition(id, 'youtube_call', { method });
    };
    const uploaded = async videoId => {
      const saved = await store.transition(id, 'youtube_uploaded', { id: videoId });
      uploadedKnown = true;
      return saved;
    };
    const uploadedJob = await youtube.upload({ snapshot, media: verifiedMedia, privacyStatus: 'private', publishAt: null, beforeCall, uploaded,
      thumbnailFailed: onThumbnailFailed });
    publicationPhaseStarted = true;
    return await runYoutubePublishJob(uploadedJob, { store, youtube, preflight });
  } catch (error) {
    await recordQueueFailure(error, { id, store, started, uploadedKnown, publicationPhaseStarted });
    throw error;
  }
}

/** 動画・カバーの形が承認した snapshot の契約どおりか。違えば再承認 */
function assertMediaContract(snapshot) {
  const cover = snapshot.source?.cover_image_path;
  if (!snapshot.source?.video_storage_path || !Array.isArray(snapshot.media) ||
    snapshot.media.length !== (cover ? 2 : 1) || snapshot.media[0].type !== 'video/mp4' ||
    snapshot.media[0].path !== snapshot.source.video_storage_path ||
    (cover && (snapshot.media[1].path !== cover || !['image/jpeg','image/png'].includes(snapshot.media[1].type)))) {
    throw new Error('動画・カバーの再承認が必要です');
  }
  if (!['scheduled','immediate'].includes(snapshot.queue?.youtube_mode)) throw new Error('公開方法が未指定です');
}

/** 媒体を読み、承認した大きさ・sha256 と合うことを確かめる */
async function verifyMedia(snapshot, loadMedia, sha256) {
  const verifiedMedia = [];
  for (const media of snapshot.media) {
    if (!loadMedia) throw new Error('媒体検査が未接続です');
    const bytes = await loadMedia(media.path);
    if (bytes.byteLength !== media.size || await sha256(bytes) !== media.sha256) throw new Error('媒体が変更されています');
    verifiedMedia.push({ ...media, bytes });
  }
  return verifiedMedia;
}

/** 親（全貌の完全版）がある Shorts は、親の公開済みの動画 ID で URL の置き場所を埋める（snapshot.text を書き換える）。 */
async function fillParentUrl(snapshot, store) {
  // runner は親が posted の子だけを選び、
  // DB も claim で parent_not_posted として止めるので、ここで親が無いのは異常（begin_post の前なので外部へは何も送らない）
  if (snapshot.queue?.parent_job_id) {
    if (!store.parent) throw new Error('親の照会が未接続です');
    snapshot.text = fillFullUrl(snapshot.text, (await store.parent(snapshot.queue.parent_job_id)).external_post_id);
  }
  if (snapshot.text?.includes(FULL_URL_PLACEHOLDER)) throw new Error('unresolved_placeholder');
}

/** runYoutubeQueueJob の失敗の記録（上がった後の残置・begin_post の前の hold・理由の印）。投げ直しは呼び元 */
async function recordQueueFailure(error, { id, store, started, uploadedKnown, publicationPhaseStarted }) {
  if (started && uploadedKnown && !publicationPhaseStarted) { try { await store.transition(id, 'youtube_retain', retainResult(error)); } catch { /* update開始後は残置扱いに戻さない */ } }
  if (!started) {
    try { await store.transition(id, 'hold', { reason: 'youtube_preflight_failed' }); } catch { /* reconcileを戻さない */ }
    // job の error_code は begin_post の前の全部の失敗で youtube_preflight_failed。元の理由は runner の report と
    // sns_send_events（191、stage=send）に残す（BOA-1201。X の runXSendJob と同じ holdReason）
    error.holdReason ??= holdReasonOf(error, 'youtube_preflight');
  } else {
    // begin_post の後（要照合、上がったかもしれない）。runner は stage=after_post に残す（BOA-1201）
    error.postStarted = true;
  }
}
/**
 * 送る前の検査の失敗に、非公開で残すときの理由（BOA-1164、186 の youtube_retain の reason）を付ける。
 * Chromium の回数の上限は budget、ほかの検査の失敗は check_failed
 */
async function checked(preflight, job) {
  try {
    await preflight(job);
  } catch (error) {
    error.retainReason ??= error.message === 'public_check_budget' ? 'budget' : 'check_failed';
    throw error;
  }
}
const retainResult = error => ({ reason: error?.retainReason ?? 'error' });

/** 処理pollは1回/呼出し、試行全体で最大3回。自動タイマー・再uploadなし。 */
export async function runYoutubePublishJob(job, deps) {
  return publishWhenProcessed(job, deps, {
    check: async () => {
      await deps.store.transition(job.id, 'youtube_poll');
      return deps.youtube.processing(job);
    },
    markReady: () => deps.store.transition(job.id, 'youtube_ready'),
    retainBeforeReady: true,
  });
}

/** 残した理由のうち、期限の前に見直して公開へ進めてよいもの（BOA-1283、196 の youtube_resume と同じ集合） */
export const RESUMABLE_RETAIN_CODES = ['youtube_retained_processing', 'youtube_retained_budget'];

/**
 * 処理待ち・検査の枠で非公開のまま残した job（と、公開の段の途中で実行が切れた ready の job）を、期限の前に見直す（BOA-1283）。読み取り（videos.list）を台帳（youtube_lookup）に
 * 記録してから処理の状態を読み、済んでいれば youtube_resume で ready に戻して今までどおり公開する。まだ処理中なら何も変えずに返す
 * （次の実行でまた見る）。読み取りの失敗・本人の動画と確かめられないときは残した理由を変えない（期限の後は閉じる道に任せる）。
 * 処理の失敗（failed・terminated）は youtube_retain（理由 error）で見直しの対象から外す
 */
export async function resumeRetainedYoutubeJob(job, deps) {
  if (job.channel !== 'youtube' || job.state !== 'reconcile' ||
    !((job.youtube_stage === 'private_retained' && RESUMABLE_RETAIN_CODES.includes(job.error_code)) ||
      (job.youtube_stage === 'ready' && job.error_code == null))) throw new Error('見直す対象ではありません');
  return publishWhenProcessed(job, deps, {
    check: async () => {
      await deps.store.transition(job.id, 'youtube_lookup');
      return deps.youtube.processing(job);
    },
    markReady: processing => deps.store.transition(job.id, 'youtube_resume', {
      owned: true, privacyStatus: processing.privacyStatus, id: processing.id, processingStatus: processing.processingStatus,
    }),
    retainBeforeReady: false,
  });
}

/** 処理の状態の読みが、この job の非公開の動画を確かめているか */
const processingConfirmed = (processing, job) =>
  processing?.confirmed === true && processing.id === job.external_post_id && processing.privacyStatus === 'private';

/** 公開の確認の読みが、この job の公開済みの動画を確かめているか */
const publicationConfirmed = (result, job) =>
  result?.confirmed === true && result.privacyStatus === 'public' && result.id === job.external_post_id &&
  Number.isFinite(Date.parse(result.posted_at));

/**
 * 処理の状態を1回読み、済んでいれば公開する（runYoutubePublishJob と resumeRetainedYoutubeJob の共通）。
 * retainBeforeReady: ready の前（読み取りの失敗）でも非公開のまま残す（youtube_retain）か。処理の失敗と ready の後は常に残す
 */
async function publishWhenProcessed(job, { store, youtube, preflight }, { check, markReady, retainBeforeReady }) {
  let publishStarted = false, retainPrivate = retainBeforeReady;
  try {
    const processing = await check();
    if (!processingConfirmed(processing, job)) {
      retainPrivate = false;
      throw new Error('youtube_processing_unconfirmed');
    }
    if (processing.processingStatus === 'processing') return job;
    retainPrivate = true;
    if (processing.processingStatus !== 'succeeded') throw new Error('youtube_processing_failed');
    job = await markReady(processing);
    await checked(preflight, job);
    job = await store.transition(job.id, 'youtube_publish_begin');
    // videos.list（公開の確認の読み取り）の前は検査しない。videos.update の後なので止められるものが無く、落ちると確認だけを失って
    // update_started の要照合に残る（BOA-1164 の system-architect の指摘。台帳への記録は今までどおり）
    const beforeCall = async method => {
      if (method !== 'videos.list') await checked(preflight, job);
      await store.transition(job.id, 'youtube_call', { method });
      if (method === 'videos.update') publishStarted = true;
    };
    const result = await youtube.makePublic({ job, privacyStatus: 'public', publishAt: null, beforeCall });
    if (!publicationConfirmed(result, job)) throw new Error('youtube_publication_unconfirmed');
    return await store.transition(job.id, 'complete', result);
  } catch (error) {
    // update開始後は公開済みかもしれない。非公開と決めつけず読取照合に残す。
    if (!publishStarted && retainPrivate) {
      try { await store.transition(job.id, 'youtube_retain', retainResult(error)); } catch { /* DB不明なら要照合を維持 */ }
    }
    // 呼ばれるのは begin_post の後（要照合）だけ。runner は stage=after_post に残す（BOA-1201）
    error.postStarted = true;
    throw error;
  }
}
export function createMockYoutubeAdapter({ privacyStatus = 'public', failAt, afterUpload,
  processingStatus = 'succeeded', videoId = 'abcdefghijk', postedAt = new Date().toISOString() } = {}) {
  const calls = [];
  return { calls, async upload(payload) {
    const call = async (method, stage) => {
      await payload.beforeCall(method);
      calls.push({ method, payload });
      if (failAt === stage) throw new Error('mock_failure');
    };
    await call('videos.insert', 'upload');
    const job = await payload.uploaded(videoId);
    if (afterUpload) await afterUpload();
    // 実 adapter と同じく、サムネイルの失敗は thumbnailFailed があれば渡して続ける（BOA-1172）
    if (payload.media.length > 1) {
      try { await call('thumbnails.set', 'thumbnail'); } catch (error) {
        if (error.message !== 'mock_failure' || !payload.thumbnailFailed) throw error;
        payload.thumbnailFailed(error.message);
      }
    }
    return job;
  }, async processing(job) {
    calls.push({method:'videos.list:processing',payload:job});
    if (failAt === 'processing') throw new Error('mock_failure');
    return {confirmed:true,id:videoId,privacyStatus:'private',processingStatus};
  }, async makePublic(payload) {
    await payload.beforeCall('videos.update');
    calls.push({method:'videos.update',payload});
    if (failAt === 'update') throw new Error('mock_failure');
    await payload.beforeCall('videos.list');
    calls.push({method:'videos.list',payload});
    if (failAt === 'confirm') throw new Error('mock_failure');
    return { id:videoId, posted_at:postedAt, confirmed:true, privacyStatus };
  } };
}

/** 送信停止・期限・leaseと独立した読取照合。lookupは単一videos.listのみ、再送禁止。
 * 同一チャンネル/承認版の投稿と実公開時刻を確認できない場合はconfirmed=false。
 * ID不明で一覧探索が必要なケースはこの契約で推測せずオーナー確認へ残す。
 */
export async function reconcileYoutubeJob(job, { store, lookup }) {
  if (job.channel !== 'youtube' || job.state !== 'reconcile' || !lookup) throw new Error('照合対象ではありません');
  await store.transition(job.id, 'youtube_lookup');
  const result = await lookup(job);
  if (result?.confirmed !== true || result.privacyStatus !== 'public' ||
    !/^[A-Za-z0-9_-]{11}$/.test(result.id || '') || !Number.isFinite(Date.parse(result.posted_at))) return job;
  return store.transition(job.id, 'complete', result);
}

/**
 * 非公開のまま残した job を、公開しないで閉じる（BOA-1164、186 の youtube_close_private）。読み取り（videos.list）を台帳に記録してから
 * 動画を読み、自分の非公開の動画と確かめたときだけ閉じる。閉じるかの条件（期限・リース・段）は DB が決める。それ以外は要照合のまま返す
 */
export async function closeRetainedYoutubeJob(job, { store, lookup }) {
  if (job.channel !== 'youtube' || job.state !== 'reconcile' || job.youtube_stage !== 'private_retained' || !lookup)
    throw new Error('閉じる対象ではありません');
  await store.transition(job.id, 'youtube_lookup');
  const result = await lookup(job);
  // 削除済み（videos.list が成功して items が空）も、公開されていないので閉じてよい（2026-10-27、オーナーが Studio で消した2件）
  if (result?.found === false) return store.transition(job.id, 'youtube_close_private', { found: false });
  if (result?.owned !== true || result.privacyStatus !== 'private' || result.id !== job.external_post_id)
    throw new Error(`youtube_close_not_private（${result?.privacyStatus ?? '不明'}）`);
  return store.transition(job.id, 'youtube_close_private', { owned: true, privacyStatus: 'private', id: result.id });
}
