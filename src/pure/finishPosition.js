/**
 * レース内順位の判定（純関数）。
 *
 * `src/components/race/basicInfoStats.js` から手を加えずに移した（開発効率の計画 段3、
 * `docs/design/dev-efficiency/plan.md`）。`src/pure/seriesPoints.js` が使い、pure の根の外を
 * 読めない（verify-pure-imports.js）ため。旧の置き場は再 export を残す。
 */

// レース内順位（1〜6）を返す。rank1〜3は必ず取得済み、rank4〜6はBOA-238以降のみ
// バックフィル済みのため、一致しなければ「着外だが正確な順位は不明」として
// nullを返す（"out"というラベル文字列ではなく、呼び出し側で明示的に判定させる）。
// BOA-159（選手ページのレース一覧）でも同じ判定が必要になったためexportした
export function finishPositionOf(r) {
  if (r.rank1 === r.boatNumber) return 1;
  if (r.rank2 === r.boatNumber) return 2;
  if (r.rank3 === r.boatNumber) return 3;
  if (r.rank4 === r.boatNumber) return 4;
  if (r.rank5 === r.boatNumber) return 5;
  if (r.rank6 === r.boatNumber) return 6;
  return null;
}
