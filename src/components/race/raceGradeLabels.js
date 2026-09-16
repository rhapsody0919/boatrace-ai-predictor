// races.race_gradeのコード値→表示名（BOA-159）。
// RaceHistoryTable.jsx（テーブルのグレード列）とRacerPerformanceStats.jsx
// （グレード選択UI・vcLabelParts等、テーブル外でも使う）の両方から参照するため
// 定数のみの別ファイルに切り出している（react-refresh/only-export-components:
// コンポーネントファイルから関数・定数以外の値をexportすると
// Fast Refreshが効かなくなるため、コンポーネントとは別ファイルにする必要がある）
export const GRADE_LABELS = {
  ippan: "一般戦",
  G1: "G1",
  G2: "G2",
  G3: "G3",
  SG: "SG",
};
