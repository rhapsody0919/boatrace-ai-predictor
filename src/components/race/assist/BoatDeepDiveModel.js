import { factsScopeLabel } from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

/** 深掘りの先頭に出す▲の付いた材料の数（ユーザー決定 A） */
const TOP_FACTS = 3;

/** 先頭に出す結論: ▲（今日6艇で一番・一番下）の付いた材料を最大3件（2026-10-09 ユーザー決定 A） */
export const topFactChips = (chips) =>
  chips.filter((c) => c.hit).slice(0, TOP_FACTS);

/** 軸の大きい数字と同じ小数1桁（69.7% と 70% が別の値に見えないように。BOA-831 ファン評価 1周目 指摘1、承認モック v2） */
export const baseText = (u) => (u ? ((u.k / u.n) * 100).toFixed(1) : "0.0");

/** 範囲の札 */
export const scopeLabelOf = (scope, venue, boat, cls) =>
  scope ? C.scopeChip(factsScopeLabel(scope, venue, boat, cls), scope.n) : null;
