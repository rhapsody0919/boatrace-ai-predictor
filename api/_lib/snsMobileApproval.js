import { isBundlePublicationBlocked } from './snsBundleValidation.js';
import { createXSnapshot, sha256 } from './snsXSend.js';

/** 不足情報を合格と推測しない。v0の恒久保留は維持する。 */
export function mobileHolds(d) {
  const s = d.source_data || {}, claims = s.bundle?.claims, manifest = s.source_manifest;
  const holds = [...(d.publication_hold_reasons || [])];
  if (isBundlePublicationBlocked(d)) holds.push('公開保留素材');
  if (!['pending_review', 'approved'].includes(d.status)) holds.push('承認対象の状態ではありません');
  if (d.platform === 'youtube' && !d.video_storage_path) holds.push('動画未完成');
  if (s.qa?.pass !== true || s.qa?.numeric_claims_match !== true || s.qa?.L0_hits?.length) holds.push('QA未確認・失敗');
  if (!Array.isArray(d.risk_flags) || d.risk_flags.length) holds.push('risk未確認・要修正');
  if (s.release_evidence?.status !== 'released' || !/^https:\/\//.test(s.release_evidence?.url || '')) holds.push('正式公開証拠なし');
  if (!Array.isArray(claims) || !claims.length || !Array.isArray(manifest) || !manifest.length || claims.some(c =>
    !Array.isArray(c.path) || !c.path.length || !Object.hasOwn(c, 'value') ||
    !manifest.some(m => m.name === `${c.source}.json` && m.hash_verified === true && m.sha256 && m.stage && m.source_url && m.fetched_at) ||
    !Number.isInteger(c.count) || c.count < 1 || typeof c.scope !== 'string' || !c.scope.trim())) holds.push('出典・件数・範囲・stage欠落');
  if (!s.deadline_queue?.expires_at || !s.deadline_queue?.deadline_at) holds.push('投稿期限未設定');
  else if (Date.parse(s.deadline_queue.expires_at) <= Date.now() || !Number.isFinite(Date.parse(s.deadline_queue.expires_at))) holds.push('期限失効');
  return [...new Set(holds)];
}
export async function mobileVersion(revision, snapshot) {
  return sha256(new TextEncoder().encode(JSON.stringify([revision, snapshot])));
}
export async function prepareMobileReview(row, loadMedia) {
  const holds = mobileHolds(row.draft);
  let snapshot = null, versionHash = null;
  try { snapshot = await createXSnapshot(row.draft, loadMedia); versionHash = await mobileVersion(row.revision, snapshot); }
  catch { holds.push('媒体未完成・取得失敗'); }
  return { ...row, snapshot, versionHash, holds };
}
/** read後の本文/根拠/QA/実媒体の変更は拒否。DBでも行ロック下でrevision再比較。 */
export async function approveMobileReview(row, body, { loadMedia, approve }) {
  const review = await prepareMobileReview(row, loadMedia);
  if (review.holds.length || !body.versionHash || body.versionHash !== review.versionHash) throw new Error('確認した版が変わったか、承認条件を満たしていません');
  if (!Number.isInteger(body.reviewSeconds) || body.reviewSeconds < 0 || body.reviewSeconds > 86400) throw new Error('レビュー時間が不正です');
  return approve(row.draft.id, body.approverId, row.revision, review.snapshot, row.draft.scheduled_at || null, body.reviewSeconds);
}
