// 「2026-05-01」→「2026/05/01」（0埋めを保つ。前期欄の日付、公式の期別成績と同じ形。BOA-723）
export const slashDatePadded = (ymd) => ymd.replaceAll("-", "/");

export function formatRate(value) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

// 「勝率」は公式集計値（win_rate/local_win_rate）を使う場合、実際の1着率(%)
// ではなく順位の重み付き平均点（0〜9程度、DataRaceTable等でも%無し表記）。
// グレード・期間で絞り込んだ場合は自社集計の「実際の1着率(%)」に切り替わる
// （公式の点数計算式を自社で再現することはできないため）。この2つは定義が
// 異なる別の指標であるため、表示の出し分け・注記が必須
export function formatWinRate(value, isPercentage) {
  if (value === null || value === undefined) return "—";
  return isPercentage ? `${value.toFixed(1)}%` : value.toFixed(2);
}

// 指標に応じた値のフォーマット（得意会場ランキング等、勝率の公式/自社切替が
// 関係しない箇所で使う汎用フォーマッタ）
export function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  return metric === "avgSt" ? value.toFixed(2) : `${value.toFixed(1)}%`;
}

// 自社集計の「勝率」は1着になった割合（%）で、公式の勝率（点数）とは別物。
// 同じ「勝率」の名前で並ぶと、条件別の 26.9% と前期欄の公式の 6.71 が同じ指標に
// 見えた（BOA-585）。自社集計を出す場所では「1着率」と呼ぶ（枠別情報タブと同じ語）
export function ownMetricLabel(t, m) {
  return m === "winRate"
    ? t("wakuInfo.metrics.winRate")
    : t(`basicInfo.metrics.${m}`);
}
