/**
 * 行の配列から、IDフィールド（既定はrace_id）ごとにタイムスタンプフィールド
 * （既定はcaptured_at）が最大の1行だけを選ぶ。
 *
 * race_odds・predictions等、同一race_idで複数スナップショット/複数レコードを
 * 持つテーブルから「最新の1行」を取り出す処理が呼び出し元ごとに独立実装され、
 * plain object/Map・DBのORDER BY依存/JS側での明示比較といった細かい差異が
 * 生じていたための共通化（BOA-341）。
 *
 * 統一後の仕様:
 * - 入力rowsの並び順には依存しない（呼び出し元でORDER BYしていなくても正しく
 *   動作する。DB側で降順ソート済みの入力を渡しても結果は変わらない）
 * - タイムスタンプフィールドはSupabaseのtimestampカラムが返すISO 8601形式の
 *   文字列を想定し、文字列比較（`>`）で新旧を判定する（Dateへの変換は行わない。
 *   時刻表現が行間で揃っている限り文字列比較とDate比較は同じ順序になる）
 * - 同一idField値に対しタイムスタンプが同値の行が複数ある場合は、rows内で
 *   先に出現した行を残す（後続の同値行では上書きしない）
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {{idField?: string, tsField?: string}} [options]
 * @param {string} [options.idField="race_id"] - グルーピングに使うIDフィールド名
 * @param {string} [options.tsField="captured_at"] - 新旧比較に使うタイムスタンプフィールド名
 * @returns {Map<unknown, Record<string, unknown>>} idFieldの値 -> 最新の行
 */
export function latestByRaceId(
  rows,
  { idField = "race_id", tsField = "captured_at" } = {},
) {
  const latest = new Map();
  for (const row of rows) {
    const id = row[idField];
    const existing = latest.get(id);
    if (!existing || row[tsField] > existing[tsField]) {
      latest.set(id, row);
    }
  }
  return latest;
}
