/**
 * 出走表の選手名（「丹下」「将」の間を全角スペース3つで詰めた表記）を姓と名に分ける。
 *
 * race_entries.player_name は公式の固定幅表記で、姓と名の間を全角スペースで詰めてある。
 * 狭い列で名前を折り返すとき、姓と名の境目で折るために使う（1つの文字列のままだと
 * 「西山貴／浩」のように名前の途中で折れ、姓名の区切りを読み違える）。
 * 6文字の名前（「安河内鈴之介」）は空白が無く境目が分からないため、1つのまま返す。
 * JavaScript の `\s` は U+3000（全角スペース）を含む。
 *
 * @param {string|null|undefined} name
 * @returns {string[]} 姓・名（空白が無ければ要素1つ、名前が無ければ空配列）
 */
export function splitRacerName(name) {
  return (name ?? "").trim().split(/\s+/).filter(Boolean);
}
