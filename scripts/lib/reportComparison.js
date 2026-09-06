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
 * 指定ディレクトリ内の report-YYYY-MM-DD.json を直近N件（今回生成分を除く）
 * 古い順に読み込んで返す。2点比較では「前回からの単発のブレ」と「継続的な
 * 悪化/改善傾向」を区別できないため、複数時点のトレンド判定に使う
 * （2026-09-06、/x-growth-report改善で追加。既存の findPreviousReport は
 * 内部的にこの関数を使うようにはせず、後方互換のため据え置く）
 * @param {string} dir
 * @param {string} excludeDate
 * @param {number} n - 取得する最大件数
 * @returns {{ file: string, date: string, data: object }[]} 古い順
 */
export function findRecentReports(dir, excludeDate, n = 5) {
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^report-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter((f) => !f.includes(excludeDate))
    .sort();

  return files.slice(-n).map((file) => {
    const date = file.match(/report-(\d{4}-\d{2}-\d{2})\.json/)[1];
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    return { file, date, data };
  });
}

/**
 * 数値の時系列（古い順）から単純なトレンド判定を行う。
 * 「前回だけ悪い/良い」のか「継続して悪化/改善している」のかを機械的に区別する。
 * @param {number[]} series - 古い順の数値列（例: 直近5回のフォロワー数）
 * @returns {{ direction: 'improving'|'worsening'|'flat'|'insufficient-data', consecutiveMoves: number }}
 */
export function detectTrend(series) {
  const values = series.filter(
    (v) => typeof v === "number" && !Number.isNaN(v),
  );
  if (values.length < 3) {
    return { direction: "insufficient-data", consecutiveMoves: 0 };
  }

  const diffs = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);

  // 末尾から同じ符号が何回続いているかを数える
  const lastSign = Math.sign(diffs[diffs.length - 1]);
  if (lastSign === 0) return { direction: "flat", consecutiveMoves: 0 };

  let consecutiveMoves = 0;
  for (let i = diffs.length - 1; i >= 0; i--) {
    if (Math.sign(diffs[i]) === lastSign) consecutiveMoves++;
    else break;
  }

  return {
    direction: lastSign > 0 ? "improving" : "worsening",
    consecutiveMoves,
  };
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
