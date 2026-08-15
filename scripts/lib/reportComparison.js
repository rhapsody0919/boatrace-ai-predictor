/**
 * 定点観測レポート（search-console-report.js / i18n-demand-report.js）の
 * 前回レポート比較を共通化するユーティリティ
 *
 * 両スクリプトとも data/analysis/{category}/report-YYYY-MM-DD.json という
 * 同じ命名規則で保存しているため、「直近の前回レポートを探して読む」ロジックを
 * 共通化する。/growth-report・/growth-pdcaスキルが毎回手動で行っていた
 * 「前回レポートとの比較」をスクリプト側で自動化する（2026-08-16）。
 */
import fs from "fs";
import path from "path";

/**
 * 指定ディレクトリ内の report-YYYY-MM-DD.json のうち、今回生成分を除いた
 * 直近の1件を読み込んで返す
 * @param {string} dir - レポート保存ディレクトリ（例: data/analysis/search-console）
 * @param {string} excludeDate - 今回のレポート日付（YYYY-MM-DD）、比較対象から除外する
 * @returns {{ file: string, date: string, data: object } | null}
 */
export function findPreviousReport(dir, excludeDate) {
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^report-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter((f) => !f.includes(excludeDate))
    .sort(); // ファイル名に日付が入っているため文字列ソートで日付昇順になる

  if (files.length === 0) return null;

  const latestFile = files[files.length - 1];
  const date = latestFile.match(/report-(\d{4}-\d{2}-\d{2})\.json/)[1];
  const data = JSON.parse(fs.readFileSync(path.join(dir, latestFile), "utf8"));

  return { file: latestFile, date, data };
}

/**
 * 日数の異なるレポート同士を比較できるよう「1日あたり」に正規化する
 * @param {number} total - 合計値
 * @param {number} days - 集計日数
 * @returns {number}
 */
export function perDay(total, days) {
  return days > 0 ? total / days : 0;
}

/**
 * 差分を符号付き文字列にフォーマットする（例: +2.3, -1.5, ±0.0）
 * @param {number} delta
 * @param {number} digits - 小数点以下桁数
 */
export function formatDelta(delta, digits = 1) {
  const rounded = parseFloat(delta.toFixed(digits));
  if (rounded === 0) return "±0";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
