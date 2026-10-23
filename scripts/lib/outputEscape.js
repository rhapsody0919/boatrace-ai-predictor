/** XML のテキスト・引用符付き属性に使う。URL の連結後に呼ぶ。 */
export function escapeXml(text) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return String(text).replace(/[&<>"']/g, (character) => entities[character]);
}

/** Markdown のリンク文字列と説明を1行に保つ。HTML・リンクの注入も防ぐ。 */
export function sanitizeLlmsLinkText(text) {
  return String(text)
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\\/g, "\\\\")
    .replace(/[\[\]]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
