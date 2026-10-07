/**
 * オッズの計算（BOA-430 で RaceOddsListTab.jsx から移した。計算は変えていない）。
 * オッズ一覧タブと思考アシストの買い目で使う
 */

// オッズ1つの表記。公式は1000倍以上を小数なしで出す（「1364」。実際の値は 1364.4 等で、公式の表示で
// 切り捨てられている）。こちらも同じ桁で出し、「1364.0」と無い精度を示さない（BOA-577）
// 合成オッズのような計算値は、小数1桁に丸めてから判定する（999.96 を「1000.0」と出さない）
export function formatOdds(n) {
  const rounded = Math.round(n * 10) / 10;
  return rounded >= 1000 ? String(Math.floor(rounded)) : rounded.toFixed(1);
}

// 合成オッズ: 各組み合わせのオッズの逆数の和の逆数（「そのうちどれか」を
// 全部買ったときの実質オッズ）。欠場艇や票の入っていない組み合わせはオッズが
// 付かない（=逆数が0）ため、存在する組み合わせだけで計算するのが正しい
export function compositeOdds(values) {
  const nums = values.filter((v) => v != null && v > 0);
  if (nums.length === 0) return null;
  return 1 / nums.reduce((sum, v) => sum + 1 / v, 0);
}

// 券種ごとに最新の「その券種の値を持つ」スナップショットを使う。全通り系5列は
// 個別取得で、最新行に選択中の券種だけnullのことがある（一部券種の取得失敗や
// FR-4以前のレース）ため、単純に末尾行を使うと表全体が空になる
// 単勝（win）はどの行でも艇番→値のオブジェクトが入る（全艇 null でも truthy）ため、値を1艇でも持つ最新行を
// 選ぶ。全ての行で全艇 null なら最新行（「票なし（または未取得）」の注記を出すため）
export function latestSnapshotWith(snapshots, dataKey) {
  const reversed = [...snapshots].reverse();
  if (dataKey === "win") {
    return (
      reversed.find((s) => Object.values(s.win ?? {}).some((v) => v != null)) ??
      reversed[0] ??
      null
    );
  }
  return reversed.find((s) => s[dataKey]) ?? null;
}
