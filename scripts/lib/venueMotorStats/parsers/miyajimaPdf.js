/**
 * miyajimaPdf - 宮島専用パーサー（BOA-264）
 *
 * 宮島（boatrace-miyajima.com）は他会場と異なり、モーター成績をHTML表ではなく
 * PDF（「モーター成績集計表」racedata.htmlからリンク）で配布している唯一の会場。
 * PDFは実際にはテキストが埋め込まれた（画像スキャンではない）表組みで、
 * 各セルがx/y座標を持つテキスト断片として抽出できる。行はy座標でグルーピングし、
 * 列はx座標が実データで確認済みの基準値に最も近いものを採用して復元する。
 *
 * 実データで確認済みの列とx座標（PDF内部座標、A4横想定）:
 *   モーター番号=0.7, 節数=10.3, 勝率=11.6, 2連率=13.5, 事故率=15.1,
 *   1着=17.1, 2着=18.4, 3着=19.6, 4着=20.9, 5着=22.2, 6着=23.5,
 *   出走回数=24.9, 優出回数=39.2, 優勝回数=40.6, 最高タイム=42.3
 * 集計期間（節数の左、x=3.9〜7.2の3トークンに分割される日付範囲）も取得する。
 *
 * pdf2json を使用（純粋なJS実装で追加のネイティブ依存が無いため採用。
 * pdf-parseはpdfjs-dist+@napi-rs/canvasを介して590パッケージ・ネイティブ
 * バイナリを要求するため、テキスト抽出だけの用途には過剰と判断し不採用とした）。
 */
import PDFParser from "pdf2json";
import {
  toStrictIntOrNull,
  toFloatOrNull,
  parseBestTime,
  toIsoDate,
} from "../parserUtils.js";

const COLUMN_X = {
  motorNumber: 0.7,
  meetCount: 10.3,
  winRate: 11.6,
  top2Rate: 13.5,
  accidentRate: 15.1,
  firstPlace: 17.1,
  secondPlace: 18.4,
  thirdPlace: 19.6,
  raceCount: 24.9,
  finalCount: 39.2,
  championshipCount: 40.6,
  bestTime: 42.3,
};
const X_TOLERANCE = 0.6;
// 集計期間（開始日・終了日）は3トークン（開始/～/終了）に分かれる。開始日の
// x座標を基準に、終了日はその右側で最も近いトークンとして拾う
const STATS_PERIOD_START_X = 3.9;
const STATS_PERIOD_END_X_MIN = 6.8;

function nearestTokenValue(row, targetX) {
  let best = null;
  let bestDist = Infinity;
  for (const token of row) {
    const dist = Math.abs(token.x - targetX);
    if (dist < bestDist && dist <= X_TOLERANCE) {
      bestDist = dist;
      best = token.text;
    }
  }
  return best;
}

/**
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ data: Array|null, reason: string|null }>}
 */
export function parseMiyajimaMotorPdf(pdfBuffer) {
  return new Promise((resolve) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataError", (err) => {
      resolve({ data: null, reason: `pdf_parse_error: ${err.parserError}` });
    });
    parser.on("pdfParser_dataReady", (pdfData) => {
      const results = [];
      for (const page of pdfData.Pages) {
        const rowsByY = new Map();
        for (const t of page.Texts) {
          const y = Math.round(t.y * 10) / 10;
          if (!rowsByY.has(y)) rowsByY.set(y, []);
          rowsByY.get(y).push({ x: t.x, text: decodeURIComponent(t.R[0].T) });
        }

        for (const row of rowsByY.values()) {
          const motorNumberRaw = nearestTokenValue(row, COLUMN_X.motorNumber);
          const motorNumber = toStrictIntOrNull(motorNumberRaw);
          if (motorNumber === null) continue; // 見出し行・注記行はここで除外される

          const periodStart = row.find(
            (t) => Math.abs(t.x - STATS_PERIOD_START_X) <= X_TOLERANCE,
          );
          const periodEnd = row.find(
            (t) => t.x >= STATS_PERIOD_END_X_MIN && t.x < COLUMN_X.meetCount,
          );

          results.push({
            motorNumber,
            meetCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.meetCount),
            ),
            raceCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.raceCount),
            ),
            finalCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.finalCount),
            ),
            championshipCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.championshipCount),
            ),
            firstPlaceCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.firstPlace),
            ),
            secondPlaceCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.secondPlace),
            ),
            thirdPlaceCount: toStrictIntOrNull(
              nearestTokenValue(row, COLUMN_X.thirdPlace),
            ),
            winRate: toFloatOrNull(nearestTokenValue(row, COLUMN_X.winRate)),
            top2Rate: toFloatOrNull(nearestTokenValue(row, COLUMN_X.top2Rate)),
            top3Rate: null,
            accidentRate: toFloatOrNull(
              nearestTokenValue(row, COLUMN_X.accidentRate),
            ),
            avgExhibitionTime: null,
            bestTime: parseBestTime(nearestTokenValue(row, COLUMN_X.bestTime)),
            statsPeriodStart: toIsoDate(periodStart?.text),
            statsPeriodEnd: toIsoDate(periodEnd?.text),
          });
        }
      }

      if (results.length === 0) {
        resolve({ data: null, reason: "no_data_rows" });
        return;
      }
      resolve({ data: results, reason: null });
    });
    parser.parseBuffer(pdfBuffer);
  });
}
