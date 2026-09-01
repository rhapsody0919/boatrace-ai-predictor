/**
 * ネタ供給モジュール: 新機能。
 * missingContentIndex検知（scripts/maintenance/content-ops-checks/）の結果を
 * そのまま候補として使う。機会ベースのため、履歴管理は不要
 * （検知されなくなる＝content-index.jsonが作られた時点で自然に対象から外れる）。
 * 詳細: docs/design/content-multi-channel-pipeline/plan.md
 */

import { checkMissingContentIndex } from "../../maintenance/content-ops-checks/check-missing-content-index.js";

export const id = "new-feature";

export async function getCandidates() {
  const { missingRoutes } = await checkMissingContentIndex();
  return missingRoutes.map((r) => ({
    sourceId: id,
    topicKey: r.route,
    route: r.route,
    addedDate: r.addedDate,
  }));
}
