/** 成功応答内の失敗・警告も、消えない通知に残す。 */
export function actionFeedback(result) {
  const messages = [];
  if (result?.routine?.fired === false) messages.push(`生成の起動に失敗しました（${result.routine.reason || "理由不明"}）。設定と起動状況を確認してください`);
  for (const warning of result?.riskWarnings || []) {
    messages.push(`リスク警告: ${warning.description || warning.label || warning.matchedPattern || warning.id || warning.pattern || "内容を確認してください"}`);
  }
  if (result?.thumbnailWarning) messages.push(`サムネイル警告: ${result.thumbnailWarning}`);
  return messages;
}
