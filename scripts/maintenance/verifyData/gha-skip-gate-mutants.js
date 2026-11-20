/**
 * verify-gha-skip-gate.js のMUTANTS（変異検証の表: 壊す対象の字と置き換え）。verify ではない。
 * 字は分ける前の verify-gha-skip-gate.js と同じ。loadMutant と判定は verify 側に残る。
 */
export const MUTANTS = [
  ["modeの確認を外す", 'if (row.mode !== "live") {', "if (false) {"],
  [
    "窓型: 起動の鮮度の確認を外す（起動中でも肩代わり）",
    "    if (tickFresh) {\n      return noTakeover(",
    "    if (false) {\n      return noTakeover(",
  ],
  [
    "時計の異常（未来の起動）を許す",
    "if (tickAge !== null && tickAge < -1) {",
    "if (false) {",
  ],
  [
    "直近の失敗（403・接続の失敗）の確認を外す（P0）",
    "isFetchFailureError(row.last_error) &&\n    isRecentFailure(row, failureFloorMs)",
    "false",
  ],
  [
    "403 のパスのブレーカーの確認を外す（BOA-1145）",
    "openBreakerKey(pathKeysOf(def), rowsByJob, nowMs) ??",
    "null ??",
  ],
  [
    "ホストのブレーカーの確認を外す（P0）",
    "openBreakerKey(hostKeysOf(def), rowsByJob, nowMs);",
    "null;",
  ],
  [
    "連続失敗で肩代わりを戻す（P0）",
    "    if (tickFresh) {\n      return noTakeover(",
    "    if (tickFresh && !(row.consecutive_failures >= 3)) {\n      return noTakeover(",
  ],
  [
    "失敗の期間の下限（当日の指定時刻・24時間）を外す",
    "if (failedAt < floorMs) return false;",
    "",
  ],
  [
    "日次: 前日の失敗も daily_failures に数える",
    "failedAt >= targetInstant &&",
    "true &&",
  ],
  [
    "展示も肩代わりの対象にする",
    "if (NEVER_TAKEOVER_VARS.includes(varName)) {",
    "if (false) {",
  ],
  [
    "古い失敗も肩代わりを止める理由にする",
    "return failedAt >= tick - TICK_WRITE_INTERVAL_MS;",
    "return true;",
  ],
  [
    "同じ変数の別のジョブの取得先の失敗で、変数ごと止めない",
    "if (veto && unhealthy.length > 0) {",
    "if (false) {",
  ],
  [
    "日次: 取得先と関係ない失敗が続いても肩代わりしない",
    "failures >= policy.maxDailyFailures",
    "false",
  ],
  [
    "last_error の形を広げる（DB の失敗も取得先の失敗に数える）",
    "|fetch failed|",
    "|に失敗しました|network|aborted|fetch failed|",
  ],
  [
    "日次: 指定時刻以降の起動を見ない（Vercel の失敗を肩代わりする）",
    "if (tickFresh || startedSinceTarget) {",
    "if (tickFresh) {",
  ],
  [
    "日次: 対象日でなく、何か処理済みならよいことにする",
    "if (done && done >= target) {",
    "if (done) {",
  ],
  [
    "日次: 前日分までを健全とみなす（対象日を1日戻す）",
    "const target = resolveTargetDate(now, def.targetTimeJst);",
    "const target = resolveTargetDate(new Date(now.getTime() - 86400000), def.targetTimeJst);",
  ],
  [
    "日次: 指定時刻より前の起動を、当日の起動と認める",
    "tick >= targetInstant - policy.dailyStartSkewMin * 60000;",
    "true;",
  ],
  [
    "読み取り失敗を「実行」にする（P0 の前のフェイルオープン）",
    /return skipUnconfirmed\(\s*"read_failed",\s*`Vercelの状態を読み取れない[^`]*`,?\s*\);/,
    'return finish({ skip: false, reason: "read_failed", message: "実行", retryable: false, results: [] });',
  ],
  [
    "タイムアウトを外す",
    "return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));",
    "clearTimeout(timer); return promise;",
  ],
  [
    "全ジョブでなく、1つでも健全ならスキップする",
    "if (unhealthy.length === 0) {",
    "if (unhealthy.length < results.length) {",
  ],
  [
    "変数が false でもDBを読む（既定でDBを読まない、を外す）",
    "if (!isTrue(env[varName])) {",
    "if (false) {",
  ],
  [
    "行なしを肩代わりにする（確かめられないのに叩く）",
    'return noTakeover(\n      "no_row",',
    'return takeover(\n      "no_row",',
  ],
  [
    "mode が live でないとき肩代わりする（人が止めた間に GitHub が取る）",
    'return noTakeover(\n      "mode_not_live",',
    'return takeover(\n      "mode_not_live",',
  ],
  [
    "待機の上限を外す（常に retryable）",
    "sinceTargetMin >= 0 &&\n      sinceTargetMin < policy.dailyWaitGraceMin;",
    "true;",
  ],
];
