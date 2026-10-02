/**
 * 例外から、画面のエラー状態に入れる文言を取り出す（BOA-668）。
 *
 * setError に err.message をそのまま渡す形だと、message が空の例外でエラー状態が「偽」のままになり、
 * 取得の失敗が「データなし」（例: 24会場すべてが本日開催なし）に化ける。
 * postgrest-js は、本文が `{}` の 500 応答を `new PostgrestError({})` として投げ、その message は undefined になる。
 * 空でない文字列を必ず返し、失敗がエラー表示に届くようにする。
 *
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessageOf(err) {
  const message = typeof err === "string" ? err : err?.message;
  if (typeof message === "string" && message.trim() !== "") return message;
  return "Unknown error";
}
