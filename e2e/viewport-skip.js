/**
 * 画面幅（Playwright のプロジェクト）だけで決まる skip の印（BOA-929）。
 *
 * 録画の撮り直しの採用（scripts/maintenance/e2e-recording.js judge）は「skip が現行の録画より
 * 増えていない」を条件にする。見たいのは、発走前のレースが少ない日に撮ったせいで増える
 * データ依存の skip。画面幅だけで決まる skip（例: 「1440pxで確認」）はどの日に撮っても同じ数で、
 * テストを足すたびに増える。区別しないと、現行の録画（skip 0件）より増えたとして
 * 撮り直しを毎回止める（2026-10-24 の3回とも 28件で不採用）。
 *
 * 画面幅だけで決まる skip の理由はこの関数で包む。judge はこの印の付いた skip を数えない。
 * データ（本番の件数・発走前のレースの有無）で変わる skip には使わない。
 */
export const VIEWPORT_SKIP_PREFIX = "[画面幅] ";

export const viewportSkipReason = (reason) =>
  `${VIEWPORT_SKIP_PREFIX}${reason}`;
