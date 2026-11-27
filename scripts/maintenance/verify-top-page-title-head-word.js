// トップ（/）の title が頭の語「ボートレース予想」を続けた字で持ち、AI の語・名前の語を落とさないことを守る（BOA-1722）
/**
 * 「ボートレースAI予想」は「ボートレース予想」を続けた字で含まないので、頭の語は別に書く（seo-marketer 2026-11-27）。
 * - title: 「ボートレース予想」「ボートレースAI予想」「龍神レーダー」を持つ
 * - 「競艇」は1回だけで、「競艇予想」と語を広げない（title・meta の暫定の例外の範囲）
 * 語・字数のほかの条件は verify-top-page-meta.js が見る。ファイルを読むだけで、ネットワークにも DB にも接続しない。
 */
import assert from "node:assert/strict";
import { getJaT } from "../../api/_lib/botPage.js";
import { getTopPageMeta } from "../../src/utils/pageMeta.js";

const { title } = getTopPageMeta(await getJaT(), "ja");

for (const word of ["ボートレース予想", "ボートレースAI予想", "龍神レーダー"]) {
  assert.ok(title.includes(word), `title に「${word}」が無い: ${title}`);
}
assert.ok(!title.includes("競艇予想"), `title に「競艇予想」がある: ${title}`);
assert.equal(title.split("競艇").length - 1, 1, `title の「競艇」は1回だけ: ${title}`);

console.log(`verify-top-page-title-head-word: OK（${title}）`);
