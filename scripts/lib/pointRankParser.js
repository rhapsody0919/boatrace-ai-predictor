/**
 * boatrace.jp 得点率一覧ページ（pointrank）の共通パーサー
 *
 * SG・G1（通常の記念競走、予選勝ち上がり制）の実データでのみテーブルが
 * 描画されることを確認済み。一般戦・特別選抜競走（オールレディース・
 * マスターズ等）ではテーブル自体が存在せず「データはありません」と
 * 表示される（ADR-0053追記参照）。対象グレードを事前に決め打ちせず、
 * テーブルの有無で判定する。
 *
 * SG・G1でも節の序盤（実測: 徳山G1 1〜3日目）はテーブルが無く、ヘッダーとフッターのみの
 * ページ（<title>が「得点率一覧」でない）が返る。4日目以降はテーブルが出て、5日目以降の
 * 日付でも「４日目１２R終了時点」の内容が表示され続ける（2026-09-19確認）。
 *
 * 減点の正確な発生条件・得点率が「-」になる条件は一次情報に明記が無く
 * 完全解明できていない。公式が計算済みの値をそのまま保存する方針のため、
 * 自社でこれらのルールを再現する必要は無い。
 *
 * 利用元: scripts/daily/scrape-point-rank.js
 */

/**
 * 得点率一覧テーブルをパースして選手ごとの行データ配列を返す
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Array<Object>|null} テーブルが存在しないページ（一般戦・特別選抜競走・
 *   節の1〜3日目等）は null。テーブルはあるが行を1件も解析できなかった場合は
 *   空配列（HTML構造変更の疑い。呼び出し側で null と区別して異常扱いにする）
 */
export function parsePointRankTable($) {
  const table = $("table").filter((_, t) =>
    $(t).find("th").text().includes("得点率"),
  );
  if (table.length === 0) return null;

  const rows = [];
  table.find("tr.is-p10-0").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 11) return;

    const racerId = parseInt($(tds[1]).text().trim(), 10);
    if (isNaN(racerId)) return;

    const rankText = $(tds[0]).text().trim();
    const scoreRateText = $(tds[4]).text().trim();
    const totalPoints = parseInt($(tds[6]).text().trim(), 10);
    const penaltyPoints = parseInt($(tds[7]).text().trim(), 10);
    const remarks = $(tds[10]).text().trim();

    rows.push({
      rank: rankText === "-" ? null : parseInt(rankText, 10),
      racerId,
      playerName: $(tds[2]).text().trim() || null,
      grade: $(tds[3]).text().trim() || null,
      scoreRate: scoreRateText === "-" ? null : parseFloat(scoreRateText),
      // 着順の生文字列（1走ごとに1文字、未消化分は全角空白で埋められる）。
      // 空白を詰めると「何走目か」という位置情報を失うためそのまま保存する
      placements: $(tds[5]).text().trim() || null,
      totalPoints: isNaN(totalPoints) ? null : totalPoints,
      penaltyPoints: isNaN(penaltyPoints) ? null : penaltyPoints,
      remarks: remarks || null,
    });
  });

  return rows;
}
