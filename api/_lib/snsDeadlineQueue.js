import twitterText from 'twitter-text';

// 推奨値は運用承認ではない。DB timing_approved=falseが初期値。
export const QUEUE_TIMING_PROPOSAL = { scheduleMinutes: 90, expiryMinutes: 30 };
export function deadlineSchedule(deadlineAt, policy = QUEUE_TIMING_PROPOSAL) {
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t) || policy.scheduleMinutes <= policy.expiryMinutes || policy.expiryMinutes <= 0) throw new Error('締切設定が不正です');
  return { scheduled_at: new Date(t - policy.scheduleMinutes * 60000).toISOString(),
    expires_at: new Date(t - policy.expiryMinutes * 60000).toISOString() };
}

/** headless.inspectは毎回新しい未認証contextで開く。Cookie/Storage/Preview設定を持ち込まない。
 * {url, context:{storageState:null}, requiredSelectors} -> {finalUrl, visibleSelectors}
 * selectorsは公開画面の印の設定。HTTP200やfeatureFlagsだけでは合格しない。
 */
export async function checkPublicDisplay(queue, headless, markers) {
  if (!headless || !queue?.public_url || !markers?.[queue.screen_key]?.length) throw new Error('public_check_unconfigured');
  const url = new URL(queue.public_url);
  // UTM以外のqueryは公開仕様が確定するまで受け付けない。
  if (url.origin !== 'https://www.boat-ai.jp' || url.username || url.password ||
    url.hash || [...url.searchParams.keys()].some(k => !['utm_source','utm_medium','utm_campaign','utm_content'].includes(k))) throw new Error('public_url_invalid');
  const selectors = markers[queue.screen_key];
  const result = await headless.inspect({ url: url.href, context: { storageState: null }, requiredSelectors: selectors });
  if (result.finalUrl !== url.href || !selectors.every(s => result.visibleSelectors?.includes(s))) throw new Error('public_component_missing');
}

/** readCurrentは送信時点の欠場・API版を返す注入契約。保存済み欠場なしだけでは通さない。 */
export function createDeadlinePreflight({ headless, markers, readCurrent, now = () => Date.now() }) {
  return async job => {
    const snapshot = JSON.parse(job.snapshot_text), q = snapshot.queue;
    if (!q || !Number.isFinite(Date.parse(q.expires_at)) || now() >= Date.parse(q.expires_at)) throw new Error('deadline_expired');
    if (job.channel === 'x') {
      if (/[{}]|\$\{/.test(snapshot.text)) throw new Error('unresolved_placeholder');
      if (!twitterText.parseTweet(snapshot.text).valid) throw new Error('weighted_text_invalid');
    }
    if (!readCurrent) throw new Error('source_check_unconfigured');
    const current = await readCurrent(job.draft_id);
    if (current?.withdrawn !== false || current.cancelled !== false) throw new Error('race_unconfirmed_or_withdrawn');
    if (!q.source_revision || current.source_revision !== q.source_revision || current.deadline_at !== q.deadline_at) throw new Error('source_changed');
    await checkPublicDisplay(q, headless, markers);
    // headless待ちの間にも締切を越え得る。
    if (now() >= Date.parse(q.expires_at)) throw new Error('deadline_expired');
  };
}

export function createMockHeadless({ visibleSelectors = [], finalUrl, fail = false } = {}) {
  const calls = [];
  return { calls, async inspect(request) {
    calls.push(request);
    if (fail) throw new Error('public_check_failed');
    return { finalUrl: finalUrl ?? request.url, visibleSelectors };
  } };
}

/** 外部照合は照合済みIDと実公開時刻がある場合だけcompleteへ。未確認ならreconcile維持。 */
export async function reconcileSendJob(job, { store, lookup }) {
  if (job.channel === 'youtube') return reconcileYoutubeJob(job, { store, lookup });
  if (job.state !== 'reconcile' || !lookup) throw new Error('照合対象ではありません');
  const result = await lookup(job);
  if (!result?.confirmed || !result.id || !result.posted_at) return job;
  return store.transition(job.id, 'complete', result);
}

/** 既存YouTube uploadの非公開adapterを差し込む契約だけ。実API・cronは提供しない。
 * 予約はローカルjobのscheduled_at待ち。時刻到達後、再検査して即時公開する。
 * YouTube publishAtによる外部の自動公開は最終検査を保証できないため今回提供しない。
 * uploadはprivateのみ。processingとmakePublicは別段階。全て自動retry禁止。
 * 142のクォータ予約・呼出し前記録・公開確認契約はsns-hub-shorts-send/contract.md参照。
 */
export async function runYoutubeQueueJob(id, { store, youtube, preflight, loadMedia }) {
  if (!youtube || !preflight) throw new Error('YouTube adapterは未接続です');
  const job = await store.transition(id, 'claim');
  if (job.state !== 'sending') return job;
  let started = false, uploadedKnown = false, publicationPhaseStarted = false;
  try {
    if (job.channel !== 'youtube') throw new Error('チャネルが違います');
    const { sha256 } = await import('./snsXSend.js');
    if (await sha256(new TextEncoder().encode(job.snapshot_text)) !== job.approved_hash) throw new Error('承認版が違います');
    const snapshot = JSON.parse(job.snapshot_text);
    const cover = snapshot.source?.cover_image_path;
    if (!snapshot.source?.video_storage_path || !Array.isArray(snapshot.media) ||
      snapshot.media.length !== (cover ? 2 : 1) || snapshot.media[0].type !== 'video/mp4' ||
      snapshot.media[0].path !== snapshot.source.video_storage_path ||
      (cover && (snapshot.media[1].path !== cover || !['image/jpeg','image/png'].includes(snapshot.media[1].type)))) {
      throw new Error('動画・カバーの再承認が必要です');
    }
    if (!['scheduled','immediate'].includes(snapshot.queue?.youtube_mode)) throw new Error('公開方法が未指定です');
    const verifiedMedia = [];
    for (const media of snapshot.media) {
      if (!loadMedia) throw new Error('媒体検査が未接続です');
      const bytes = await loadMedia(media.path);
      if (bytes.byteLength !== media.size || await sha256(bytes) !== media.sha256) throw new Error('媒体が変更されています');
      verifiedMedia.push({ ...media, bytes });
    }
    await preflight(job);
    const beginning = await store.transition(id, 'begin_post');
    if (beginning.state !== 'reconcile') return beginning;
    started = true;
    // 実adapterは未提供。各Data API呼出しの直前に必ず台帳へ記録する契約。
    const beforeCall = async method => {
      await preflight(job);
      await store.transition(id, 'youtube_call', { method });
    };
    const uploaded = async videoId => {
      const saved = await store.transition(id, 'youtube_uploaded', { id: videoId });
      uploadedKnown = true;
      return saved;
    };
    const uploadedJob = await youtube.upload({ snapshot, media: verifiedMedia, privacyStatus: 'private', publishAt: null, beforeCall, uploaded });
    publicationPhaseStarted = true;
    return await runYoutubePublishJob(uploadedJob, { store, youtube, preflight });
  } catch (error) {
    if (started && uploadedKnown && !publicationPhaseStarted) { try { await store.transition(id, 'youtube_retain'); } catch { /* update開始後は残置扱いに戻さない */ } }
    if (!started) { try { await store.transition(id, 'hold', { reason: 'youtube_preflight_failed' }); } catch { /* reconcileを戻さない */ } }
    throw error;
  }
}
/** 処理pollは1回/呼出し、試行全体で最大3回。自動タイマー・再uploadなし。 */
export async function runYoutubePublishJob(job, { store, youtube, preflight }) {
  let publishStarted = false, retainPrivate = true;
  try {
    await store.transition(job.id, 'youtube_poll');
    const processing = await youtube.processing(job);
    if (processing?.confirmed !== true || processing.id !== job.external_post_id || processing.privacyStatus !== 'private') {
      retainPrivate = false;
      throw new Error('youtube_processing_unconfirmed');
    }
    if (processing.processingStatus === 'processing') return job;
    if (processing.processingStatus !== 'succeeded') throw new Error('youtube_processing_failed');
    job = await store.transition(job.id, 'youtube_ready');
    await preflight(job);
    job = await store.transition(job.id, 'youtube_publish_begin');
    const beforeCall = async method => {
      await preflight(job);
      await store.transition(job.id, 'youtube_call', { method });
      if (method === 'videos.update') publishStarted = true;
    };
    const result = await youtube.makePublic({ job, privacyStatus: 'public', publishAt: null, beforeCall });
    if (result?.confirmed !== true || result.privacyStatus !== 'public' || result.id !== job.external_post_id ||
      !Number.isFinite(Date.parse(result.posted_at))) throw new Error('youtube_publication_unconfirmed');
    return await store.transition(job.id, 'complete', result);
  } catch (error) {
    // update開始後は公開済みかもしれない。非公開と決めつけず読取照合に残す。
    if (!publishStarted && retainPrivate) {
      try { await store.transition(job.id, 'youtube_retain'); } catch { /* DB不明なら要照合を維持 */ }
    }
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
    if (payload.media.length > 1) await call('thumbnails.set', 'thumbnail');
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
