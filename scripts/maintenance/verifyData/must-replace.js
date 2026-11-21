/**
 * 製品のコードを data:text で読む verify が、import を偽物へ差し替えるときの道具。verify ではない。
 * 置換元が1回も当たらなければ throw する（製品の字が変わったのに差し替えずに黙って通るのを防ぐ）。
 * re は文字列か正規表現。to は String.prototype.replace と同じ（文字列か関数）。
 */
export function mustReplace(src, re, to) {
  const probe =
    typeof re === "string" ? null : new RegExp(re.source, re.flags.replace("g", ""));
  const hit = probe ? probe.test(src) : src.includes(re);
  if (!hit) throw new Error(`置換元が無い（製品の字が変わったら verify の置換を直す）: ${re}`);
  return src.replace(re, to);
}
