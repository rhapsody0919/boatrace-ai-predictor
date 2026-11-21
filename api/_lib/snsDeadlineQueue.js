import { xPostValid } from './snsXLength.js';
import { hasLink } from './snsResearchImage.js';
import { checkPublicDisplay } from "../../scripts/lib/sns/publicDisplayCheck.js";
import { FULL_URL_PLACEHOLDER, reconcileYoutubeJob } from "../../scripts/lib/sns/youtubeQueue.js";

// 推奨値は運用承認ではない。DB timing_approved=falseが初期値。
export const QUEUE_TIMING_PROPOSAL = { scheduleMinutes: 90, expiryMinutes: 30 };
export function deadlineSchedule(deadlineAt, policy = QUEUE_TIMING_PROPOSAL) {
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t) || policy.scheduleMinutes <= policy.expiryMinutes || policy.expiryMinutes <= 0) throw new Error('締切設定が不正です');
  return { scheduled_at: new Date(t - policy.scheduleMinutes * 60000).toISOString(),
    expires_at: new Date(t - policy.expiryMinutes * 60000).toISOString() };
}

/** readCurrentは送信時点の欠場・API版を返す注入契約。保存済み欠場なしだけでは通さない。 */
export function createDeadlinePreflight({ headless, markers, readCurrent, now = () => Date.now() }) {
  return async job => {
    const snapshot = JSON.parse(job.snapshot_text), q = snapshot.queue;
    if (!q || !Number.isFinite(Date.parse(q.expires_at)) || now() >= Date.parse(q.expires_at)) throw new Error('deadline_expired');
    // 全貌の Shorts は、完全版の URL の置き場所を親（完全版の job）の公開後に埋める。親の無い置き場所は送らない（個別承認の道で素通りさせない）
    if (job.channel === 'youtube' && snapshot.text?.includes(FULL_URL_PLACEHOLDER) && !q.parent_job_id) throw new Error('unresolved_placeholder');
    if (job.channel === 'x') {
      if (/[{}]|\$\{/.test(snapshot.text)) throw new Error('unresolved_placeholder');
      // 長文（25,000まで）は、auto-plan が承認の前に「親1件だけのスレッド」と書いたもの（queue.thread_length=1）だけ。ほかは280まで
      if (!xPostValid(snapshot.text, { long: q.thread_length === 1 && !q.parent_job_id })) throw new Error('weighted_text_invalid');
    }
    if (!readCurrent) throw new Error('source_check_unconfigured');
    const current = await readCurrent(job.draft_id);
    if (current?.withdrawn !== false || current.cancelled !== false) throw new Error('race_unconfirmed_or_withdrawn');
    if (!q.source_revision || current.source_revision !== q.source_revision) throw new Error('source_changed');
    // 締切だけが変わった。全貌は締切の時刻を動画・題・説明文に焼き込むので、送る側では通さない（全チャネル。BOA-1201）。
    // 作り手が作り直して push し直し、前の束を差し替える（push-full-picture.js）。X は holdReasonOf がこの文字列のまま error_code に入れる
    if (current.deadline_at !== q.deadline_at) throw new Error('deadline_changed');
    // リンクを置かない型（「数字で見たら」179・180、/today の対象レースの思考投稿 189）だけ、リンク先の表示の確認の代わりに、
    // 送る文にリンクが無いことを確かめる。public_check='none' を返すのは readCurrent が DB の item の kind（research_image・setsu_kiryoku・today_thinking）を確かめた後だけ
    if (current.public_check === 'none') {
      if (hasLink(snapshot.text)) throw new Error('link_not_allowed');
    } else await checkPublicDisplay(q, headless, markers);
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

export { checkPublicDisplay } from "../../scripts/lib/sns/publicDisplayCheck.js";

export {
  FULL_URL_PLACEHOLDER,
  fillFullUrl,
  runYoutubeQueueJob,
  runYoutubePublishJob,
  RESUMABLE_RETAIN_CODES,
  resumeRetainedYoutubeJob,
  createMockYoutubeAdapter,
  reconcileYoutubeJob,
  closeRetainedYoutubeJob,
} from "../../scripts/lib/sns/youtubeQueue.js";
