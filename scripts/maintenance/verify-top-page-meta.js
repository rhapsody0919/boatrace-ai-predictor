// トップ（/）の title・meta description が検索の語（ボートレースAI予想・競艇・無料）を含み、機能名・的中の語を持たないことを守る（BOA-1722）
/**
 * 人のトップ（VenueGridPage）とボット向け HTML（ADR 0089）が同じ getTopPageMeta を使うので、その戻りを ja で見る。
 * - title: 「ボートレースAI予想」を続けた字で持つ（Search Console で表示の多い語。2026-10-26〜11-22 の28日）。
 *   「競艇」（title・meta の暫定の例外、verify-kyotei-wording.js の例外1）・「無料」・名前「龍神レーダー」を持つ
 * - description: 「AI予想」「無料」「会員登録なし」「成績」を持つ
 * - どちらも、機能の旗 IN_CAUTION_PUBLIC で画面から消える機能名（展開予測・イン崩れ指数）を持たない（古びるため）。
 *   的中・精度・回収率・保証・% を持たない（BOA-617）
 * 字数の上限（title 35字・description 120字）は目安（根拠なし。検索結果で切れにくい長さ）
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。
 */
import assert from "node:assert/strict";
import { getJaT } from "../../api/_lib/botPage.js";
import { getTopPageMeta } from "../../src/utils/pageMeta.js";

const { title, description, canonical } = getTopPageMeta(await getJaT(), "ja");
const len = (s) => [...s].length;

for (const word of ["ボートレースAI予想", "競艇", "無料", "龍神レーダー"]) {
  assert.ok(title.includes(word), `title に「${word}」が無い: ${title}`);
}
for (const word of ["AI予想", "無料", "会員登録なし", "成績"]) {
  assert.ok(description.includes(word), `description に「${word}」が無い: ${description}`);
}
for (const word of ["展開予測", "イン崩れ指数", "的中", "精度", "回収率", "保証", "%", "％"]) {
  assert.ok(!title.includes(word), `title に「${word}」がある: ${title}`);
  assert.ok(!description.includes(word), `description に「${word}」がある: ${description}`);
}
assert.ok(len(title) <= 35, `title が ${len(title)} 字（目安 35 字以内）`);
assert.ok(len(description) <= 120, `description が ${len(description)} 字（目安 120 字以内）`);
assert.equal(canonical, "https://www.boat-ai.jp/");

console.log(`verify-top-page-meta: OK（title ${len(title)}字・description ${len(description)}字）`);
