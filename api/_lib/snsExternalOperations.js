import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from './snsHubHelpers.js';

export async function externalRpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const error = new Error(`外部操作の記録に失敗しました (${response.status})。再送せず照合してください`);
    if (name === 'sns_claim_external' && [400, 409].includes(response.status)) error.status = 409;
    throw error;
  }
  return response.json();
}

// claimの応答消失も外部呼び出しを行わず停止する。自動解除/再送はしない。
export async function claimExternal(draft, approverId) {
  const token = crypto.randomUUID();
  await externalRpc('sns_claim_external', {
    p_id: draft.id, p_expected: draft, p_token: token, p_approver: approverId,
  });
  return token;
}

export async function recordExternal(id, token, result) {
  return externalRpc('sns_record_external', { p_id: id, p_token: token, p_result: result });
}

export async function finishExternal(draft) {
  return externalRpc('sns_finish_external', { p_id: draft.id, p_token: draft.external_operation_token });
}

export function completedResponse(draft) {
  const result = draft.external_operation_result || {};
  return {
    data: draft,
    ...(result.youtubeUrl && { youtubeUrl: result.youtubeUrl }),
    ...(result.merge && { merge: result.merge }),
    ...(result.thumbnailWarning && { thumbnailWarning: ["unconfirmed", "サムネイル設定結果は未確認です"].includes(result.thumbnailWarning) ? "unconfirmed" : "failed" }),
  };
}
