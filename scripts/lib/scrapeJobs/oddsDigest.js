/**
 * オッズ取得（A3）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。
 *
 * 結果取得（resultDigest.js）と違い、オッズの値は数分で変わるため、値のダイジェストは、取得の時刻がずれた
 * 既存基盤（GitHub Actions）の行と一致しない。そこで、**構造のダイジェスト**（値ではなく、何が取れたか）にする:
 *   - 単勝: 艇1〜6のそれぞれが有効な値を持つか
 *   - 複勝: 艇1〜6のそれぞれが下限・上限を持つか
 *   - 3連単人気3位（trifecta_popular_*・trifecta_odds_*）は含めない。以前は本番の全行でNULLだった
 *     （scrape-odds.js の scrapeTrifectaOdds が、存在しない「人気順」の表を探していた不具合。2026-09-21に、odds3t の
 *     120通りのグリッドからオッズの低い順に求める形へ修正）。修正後は非NULLになるが、次の理由で含めない:
 *     ①全通り系の trifecta_all（含めている）から導出できる冗長な情報で、取れたかどうかは trifecta_all の有無と一致する
 *     ②人気の順位・組み合わせはオッズの値で変わり、取得の時刻がずれた既存基盤の行と一致しない
 *     ③修正前に書かれた行は NULL のままで、含めると修正の前後をまたぐ shadow の比較が全て不一致になる
 *   - 全通り系5券種（3連単・3連複・2連単・2連複・拡連複）: 取得できたか、組み合わせの数と、
 *     組み合わせのキー集合のハッシュ（値は含めない）
 * 同じレースなら、どの時刻に取得しても同じダイジェストになる（欠場艇・券種の未販売がある特殊なレースを除く）。
 * shadow の一致率は、「Vercel が取得・解析できた構造が、既存基盤が書いた行と同じか」（解析の取りこぼし・
 * 全通り系の欠落・キーの取り違えが無いか）を測る（scripts/maintenance/check-odds-shadow.js）。
 * 純粋関数（DB・取得先に接続しない）。
 */
import { createHash } from "node:crypto";

/** 全通り系（jsonb）の列。scrape-odds.js の FULL_ODDS_KEYS と同じ（循環importを避けるため、ここで持つ） */
export const ODDS_DIGEST_FULL_KEYS = Object.freeze([
  "trifecta_all",
  "trio_all",
  "exacta_all",
  "quinella_all",
  "wide_all",
]);

const BOATS = [1, 2, 3, 4, 5, 6];
const has = (v) => v !== null && v !== undefined;

/** 全通り系の1列の構造: 取得できなければ null、あれば [組み合わせの数, キー集合のハッシュ] */
function fullShape(value) {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value).sort();
  if (keys.length === 0) return null;
  const keyHash = createHash("sha1")
    .update(keys.join(","))
    .digest("hex")
    .slice(0, 8);
  return [keys.length, keyHash];
}

/**
 * race_odds の行（DBの行でも、解析して組み立てた行でもよい）から、構造のダイジェスト（SHA-1の先頭16桁）を作る。
 *
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
export function computeOddsDigest(row) {
  const canonical = JSON.stringify([
    BOATS.map((b) => has(row?.[`odds_win_${b}`])),
    BOATS.map(
      (b) =>
        has(row?.[`odds_place_${b}_low`]) && has(row?.[`odds_place_${b}_high`]),
    ),
    ODDS_DIGEST_FULL_KEYS.map((k) => fullShape(row?.[k])),
  ]);
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}
