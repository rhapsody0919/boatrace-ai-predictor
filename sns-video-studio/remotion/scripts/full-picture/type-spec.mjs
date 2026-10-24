/**
 * 投稿の型（hq PD02、オーナー 10/25「全ての投稿で改善を繰り返す」「大きく違う型を並べて外れ値を探す」）の口。
 * hq の pdca_daily.py が翌日の割り当てを書き、daily.mjs --type-spec <json> で1レースに1型を渡す。
 * 型の attributes（hq の config/content-types.json）は自由な文なので、コードは文を解釈しない。龍神側に「型の id → 実装」の表を持ち、
 * 表に無い型・表の型が実装していない項目は、どれも type_unsupported:<項目> で止める（黙って今の型で作らない）。
 * 表に足すのは、中身を固めて試作をチャネルの評価役（youtube-channel・x-channel）が P0・P1 なしと判定し、オーナーが見たものだけ。
 * approved は実装したときの hq の文（config/content-types.json）。同じ id のまま文が変わったら、その項目を type_unsupported で止める
 * （古い実装で黙って作り続けると、hq の台帳が新しい意味の型として数えて判定が汚れる。system-architect 2026-10-25 P2）。
 * hq との約束: 対の a（今の型）は --type-spec を渡さない。割り当ててよい型は daily.mjs --list-types が返す表だけ（同 P1-2）。
 * content_type は PD02 の投稿の型で、テーブル sns_content_types（043、ネタの型）とは別物。
 */

/** 型が持ちうる項目（hq config/pdca.json の type_attrs と同じ） */
export const TYPE_ATTRS = ["hook", "title", "thumb", "length_s", "structure", "angle", "caption"];

/**
 * 型の id → 実装（{attrs: 受け持つ項目, approved: 実装したときの hq の文, ...部品}）。今は空。
 * 最初の候補（e02 寸止め・e03 要点1つ・e04 選手名・e05 数字1枚）は、試作を youtube-channel・x-channel が見て P1 が出た・オーナーが
 * 「明らかにダメ」「今の投稿の劣化版」とした（2026-10-25）。型は、ファン・チャネルの評価役・強いエージェントと中身を固め、
 * 試作をオーナーが見てから足す（オーナー 10/25）。それまで表に無い型はすべて type_unsupported で止まり、投稿は今の型のまま
 */
export const TYPE_IMPL = {};

/**
 * 型の JSON（{id, attributes}）を読み、実装に結びつける（純粋関数）。
 * @returns {{id: string|null, attributes: object, impl: object|null, reasons: string[]}} reasons が空でなければ作らない
 */
export function resolveType(spec, table = TYPE_IMPL) {
  const id = typeof spec?.id === "string" && spec.id ? spec.id : null;
  const attributes = spec?.attributes && typeof spec.attributes === "object" && !Array.isArray(spec.attributes) ? spec.attributes : null;
  if (!id || !attributes || !Object.keys(attributes).length) return { id, attributes: attributes ?? {}, impl: null, reasons: ["type_spec_invalid: id と attributes（空でない辞書）が要る"] };
  const unknown = Object.keys(attributes).filter((k) => !TYPE_ATTRS.includes(k));
  const impl = table[id] ?? null;
  const unsupported = Object.keys(attributes).filter((k) => !impl || !impl.attrs.includes(k));
  const changed = impl ? Object.keys(attributes).filter((k) => impl.attrs.includes(k) && attributes[k] !== impl.approved?.[k]) : [];
  const reasons = [
    ...unknown.map((k) => `type_unsupported:${k}（知らない項目）`),
    ...unsupported.filter((k) => !unknown.includes(k)).map((k) => `type_unsupported:${k}${impl ? "" : `（型 ${id} は龍神の表に無い）`}`),
    ...changed.map((k) => `type_unsupported:${k}（文が変わった）`),
  ];
  return { id, attributes, impl: reasons.length ? null : impl, reasons };
}

/** 「25〜30」「12〜15」「30」→ [下限, 上限]（秒）。読めなければ null */
export function lengthRange(text) {
  const nums = String(text ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length || nums.length > 2) return null;
  return nums.length === 1 ? [nums[0], nums[0]] : [Math.min(...nums), Math.max(...nums)];
}

/**
 * 作った入口版の尺が型の length_s の範囲に入るか。入らなければ {reason, detail}（作り直さず止める）。
 * reason は固定の文（hq は reasons[0] で起票の重複を判定するので、実測の秒数は detail に分ける。system-architect P1-1）
 */
export function lengthReason(attributes, seconds) {
  if (attributes?.length_s === undefined) return null;
  const r = lengthRange(attributes.length_s);
  if (!r) return { reason: "type_unsupported:length_s", detail: `範囲を読めない: ${attributes.length_s}` };
  return seconds >= r[0] && seconds <= r[1] ? null : { reason: "type_unsupported:length_s", detail: `入口版 ${seconds.toFixed(1)}秒が範囲 ${r[0]}〜${r[1]}秒の外` };
}
/** 型の表（daily.mjs --list-types が返す。hq の pdca_daily.py はここに載る型だけを割り当てる） */
export const listTypes = (table = TYPE_IMPL) => Object.entries(table).map(([id, t]) => ({ id, attributes: t.approved }));

