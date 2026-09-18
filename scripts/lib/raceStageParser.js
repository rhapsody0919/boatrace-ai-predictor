/**
 * racelist ページの `.title16_titleDetail__add2020` から開催ステージ名
 * （予選/準優勝戦/優勝戦/カタメン１予選等）を取得する（BOA-226）。
 * 実データでは「優勝戦」の後に全角空白と距離表記（1800m）が同じ要素内に
 * 混在している。末尾の距離表記（数字+m）とその前後の空白だけを取り除き、
 * 残りをそのままステージ名として扱う（先頭トークンだけを見る方式だと、
 * 「5日目 準優勝戦」のように複数語のステージ名が将来登場した場合に
 * 最初の1語だけを誤って切り出してしまうため、末尾の距離表記を除去する
 * 方式にしている）。
 *
 * scripts/daily/update-race-info.js（発走60分前ウィンドウ）と
 * scripts/scrape-to-json.js（朝の一括取得、BOA-347）の両方から使う
 * 共通ロジック。racelist ページのHTML構造は取得タイミングによらず同じ。
 *
 * @param {CheerioAPI} $ - cheerio インスタンス（racelist ページ）
 * @returns {string | null}
 */
export function scrapeRaceStage($) {
  const raw = $(".title16_titleDetail__add2020").text();
  const stage = raw.replace(/[\s\u3000]*\d+m[\s\u3000]*$/, "").trim();
  return stage || null;
}
