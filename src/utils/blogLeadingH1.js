/** 記事ファイル用の先頭 h1 だけを除き、画面の題は JSON の title にまとめる。 */
export function stripBlogLeadingH1(markdown) {
  return markdown.replace(
    /^\uFEFF?(?:[ \t]*\r?\n)*# [^\r\n]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/,
    "",
  );
}
