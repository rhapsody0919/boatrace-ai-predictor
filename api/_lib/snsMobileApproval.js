import { isBundlePublicationBlocked } from './snsBundleValidation.js';
import { isTodayDraft } from './snsTodayDigest.js';

/**
 * 送る前の保留の理由（自動送信の auto-plan が使う。sns-pdca-loop tasks 11）。
 * 不足情報を合格と推測しない。v0の恒久保留は維持する。
 * 素材 v1 は、claims を公開 API で照合した結果（source_data.claim_check、tasks 9）と、リンク先の表示の確認（release_evidence、tasks 10）を見る。
 * どちらも auto-plan が書く。照合の版が deadline_queue.source_revision と違えば保留（書いた後に値が変わった）
 */
export function sendHolds(d) {
  const s = d.source_data || {};
  const holds = [...(d.publication_hold_reasons || [])];
  // 規則を元の if の順に当てる。各規則は理由の字か null を返す（複雑さを規則ごとに分けた）
  for (const rule of HOLD_RULES) {
    const reason = rule(d, s);
    if (reason) holds.push(reason);
  }
  return [...new Set(holds)];
}

/** 素材の claims が出典の manifest と合うか（欠落があれば true）。元の sendHolds の v0 の some の中身 */
function claimIsBroken(c, manifest) {
  return (
    !Array.isArray(c.path) || !c.path.length || !Object.hasOwn(c, 'value') ||
    !manifest.some(m => m.name === `${c.source}.json` && m.hash_verified === true && m.sha256 && m.stage && m.source_url && m.fetched_at) ||
    !Number.isInteger(c.count) || c.count < 1 || typeof c.scope !== 'string' || !c.scope.trim()
  );
}

/** v0 の素材の出典・件数・範囲・stage の欠落 */
function v0ClaimsHold(s) {
  const claims = s.bundle?.claims, manifest = s.source_manifest;
  return !Array.isArray(claims) || !claims.length || !Array.isArray(manifest) || !manifest.length ||
    claims.some(c => claimIsBroken(c, manifest));
}

/** /today の投稿・v1・v0 の3通りの素材の照合の理由（元の if / else if / else if） */
function sourceCheckHold(d, s) {
  if (isTodayDraft(d)) {
    // /today の投稿（tasks 19b）: 素材の claims の代わりに、一覧の版（auto-plan が書く）が承認の版と同じことを見る
    if (!s.digest.revision || s.digest.revision !== s.deadline_queue?.source_revision) return '一覧の版が未確認・不一致';
  } else if (s.schema_version === 'ryujin-preview/1') {
    if (s.claim_check?.ok !== true || !s.claim_check?.revision ||
      s.claim_check.revision !== s.deadline_queue?.source_revision) return '数値の照合が未完了・不一致';
  } else if (v0ClaimsHold(s)) return '出典・件数・範囲・stage欠落';
  return null;
}

/** 期限の理由（未設定、または失効） */
function deadlineHold(s) {
  if (!s.deadline_queue?.expires_at || !s.deadline_queue?.deadline_at) return '投稿期限未設定';
  if (Date.parse(s.deadline_queue.expires_at) <= Date.now() || !Number.isFinite(Date.parse(s.deadline_queue.expires_at))) return '期限失効';
  return null;
}

/** 保留の規則。元の sendHolds の push の順（この順に当てる） */
const HOLD_RULES = [
  // v1 は bundle 由来でも、検査が通れば DB のトリガーが publish_blocked を外せる（153）。v0 は bundle 由来なら常に保留
  (d, s) => ((s.schema_version === 'ryujin-preview/1' ? d.publish_blocked : isBundlePublicationBlocked(d)) ? '公開保留素材' : null),
  (d) => (!['pending_review', 'approved'].includes(d.status) ? '承認対象の状態ではありません' : null),
  (d) => (d.platform === 'youtube' && !d.video_storage_path ? '動画未完成' : null),
  (d, s) => (s.qa?.pass !== true || s.qa?.numeric_claims_match !== true || s.qa?.L0_hits?.length ? 'QA未確認・失敗' : null),
  (d) => (!Array.isArray(d.risk_flags) || d.risk_flags.length ? 'risk未確認・要修正' : null),
  (d, s) => (s.release_evidence?.status !== 'released' || !/^https:\/\//.test(s.release_evidence?.url || '') ? '正式公開証拠なし' : null),
  sourceCheckHold,
  (d, s) => deadlineHold(s),
];
/** 旧名（個別承認の画面は #1645 で撤去。sendHolds と同じ） */
export const mobileHolds = sendHolds;
export { mobileVersion } from './snsXSend.js';
