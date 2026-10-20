/**
 * 「制作仕様の変更要望」の送信結果を、通知の文と「入力欄を閉じてよいか」に変える。
 * 起票できなかったときは closePanel=false にし、入力した本文を欄に残す
 * （以前は Linear の無料枠の上限でも汎用の通知だけが出て、本文も消えた。2026-10-18 調査）。
 *
 * @param {{result?: unknown, error?: {code?: string, message?: string}}} outcome
 * @returns {{type: "success" | "error", message: string, closePanel: boolean}}
 */
export function specChangeFeedback({ result, error }) {
  const keep = "入力した本文は欄に残しています。";
  if (error) {
    // 未アーカイブ件数が閾値以上で、起票の前に止めた（文に件数と閾値が入っている）
    if (error.code === "LINEAR_ISSUE_GATE_BLOCKED") {
      return {
        type: "error",
        message: `${error.message ?? "Linear の起票を止めました"}。${keep}`,
        closePanel: false,
      };
    }
    if (error.code === "LINEAR_USAGE_LIMIT_EXCEEDED") {
      return {
        type: "error",
        message: `Linear の無料枠の上限で起票できませんでした。${keep}`,
        closePanel: false,
      };
    }
    return {
      type: "error",
      message: `起票に失敗しました（${error.code ?? error.message ?? "理由不明"}）。${keep}`,
      closePanel: false,
    };
  }
  if (result?.issue?.created === false) {
    return {
      type: "error",
      message: `Linear起票がスキップされました（${result.issue.reason}）。${keep}`,
      closePanel: false,
    };
  }
  return { type: "success", message: "Linearに起票しました", closePanel: true };
}
