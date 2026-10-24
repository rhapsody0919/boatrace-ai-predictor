/**
 * 投稿の型（hq PD02、オーナー 10/25「全ての投稿で改善を繰り返す」「大きく違う型を並べて外れ値を探す」）の口。
 * hq の pdca_daily.py が翌日の割り当てを書き、daily.mjs --type-spec <json> で1レースに1型を渡す。
 * 型の attributes（hq の config/content-types.json）は自由な文なので、コードは文を解釈しない。龍神側に「型の id → 実装」の表を持ち、
 * 表に無い型・表の型が実装していない項目は、どれも type_unsupported:<項目> で止める（黙って今の型で作らない）。
 * 表は、hq の型の文と照らして作れるものから足す（10/25 Orchestrate 了承: 最初は e02・e03・e04・e05）。
 */

/** 型が持ちうる項目（hq config/pdca.json の type_attrs と同じ） */
export const TYPE_ATTRS = ["hook", "title", "thumb", "length_s", "structure", "angle", "caption"];

/**
 * 型の id → 実装。attrs はこの実装が受け持つ項目。
 * entry: 入口版（X・Shorts）の並び（entry.mjs の STRUCTURES）。racerName: 題と冒頭の問いに1号艇の選手名。linkLead: X の本文のリンクの前の文
 */
export const TYPE_IMPL = {
  // 結論を寸止め（冒頭の数字・結論の再掲を出さない）。最後は「続きは完全版で」
  "e02-cliffhanger": { attrs: ["structure", "caption"], entry: "cliffhanger", linkLead: "続きは完全版・龍神レーダーで" },
  // 要点1つ（冒頭の数字と根拠1つ）。6艇の比べ・会場の棒を外す
  "e03-one-point-30s": { attrs: ["structure", "length_s"], entry: "one_point" },
  // 題と冒頭に1号艇の選手名と会場
  "e04-racer-name": { attrs: ["title", "hook"], racerName: true },
  // 数字1枚だけ（冒頭の数字と母数）
  "e05-number-only-15s": { attrs: ["structure", "length_s"], entry: "number_only" },
};

/**
 * 型の JSON（{id, attributes}）を読み、実装に結びつける（純粋関数）。
 * @returns {{id: string|null, attributes: object, impl: object|null, reasons: string[]}} reasons が空でなければ作らない
 */
export function resolveType(spec) {
  const id = typeof spec?.id === "string" && spec.id ? spec.id : null;
  const attributes = spec?.attributes && typeof spec.attributes === "object" && !Array.isArray(spec.attributes) ? spec.attributes : null;
  if (!id || !attributes || !Object.keys(attributes).length) return { id, attributes: attributes ?? {}, impl: null, reasons: ["type_spec_invalid: id と attributes（空でない辞書）が要る"] };
  const unknown = Object.keys(attributes).filter((k) => !TYPE_ATTRS.includes(k));
  const impl = TYPE_IMPL[id] ?? null;
  const unsupported = Object.keys(attributes).filter((k) => !impl || !impl.attrs.includes(k));
  const reasons = [
    ...unknown.map((k) => `type_unsupported:${k}（知らない項目）`),
    ...unsupported.filter((k) => !unknown.includes(k)).map((k) => `type_unsupported:${k}${impl ? "" : `（型 ${id} は龍神の表に無い）`}`),
  ];
  return { id, attributes, impl: reasons.length ? null : impl, reasons };
}

/** 「25〜30」「12〜15」「30」→ [下限, 上限]（秒）。読めなければ null */
export function lengthRange(text) {
  const nums = String(text ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length || nums.length > 2) return null;
  return nums.length === 1 ? [nums[0], nums[0]] : [Math.min(...nums), Math.max(...nums)];
}

/** 作った入口版の尺が型の length_s の範囲に入るか。入らなければ理由（作り直さず止める） */
export function lengthReason(attributes, seconds) {
  if (attributes?.length_s === undefined) return null;
  const r = lengthRange(attributes.length_s);
  if (!r) return `type_unsupported:length_s（範囲を読めない: ${attributes.length_s}）`;
  return seconds >= r[0] && seconds <= r[1] ? null : `type_unsupported:length_s（入口版 ${seconds.toFixed(1)}秒が範囲 ${r[0]}〜${r[1]}秒の外）`;
}

/** 出走表の選手名（全角の空白で字をそろえてある）→ 空白なし */
export const racerNameOf = (name) => String(name ?? "").replace(/[\s　]+/g, "") || null;
