export const PENDING_MARKER = "データは、この場の全レース終了後に登録されます";

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

/** 全角英数・記号を半角にし、全ての空白（全角含む）を除去する */
const squash = (s) => s.normalize("NFKC").replace(/\s+/g, "");
/** 全角数字を半角にする（空白はそのまま） */
const half = (s) => s.normalize("NFKC");
const toInt = (s) =>
  s === undefined || s === null || s === "" ? null : Number.parseInt(s, 10);
const toNum = (s) =>
  s === undefined || s === null || s === "" ? null : Number.parseFloat(s);

/**
 * 会場ブロックへ分割する。 NNKBGN ... NNKEND / NNBBGN ... NNBEND
 * @param {string} text
 * @param {"K"|"B"} kind
 * @returns {Array<{venue_code: number, lines: string[]}>}
 */
function splitVenueBlocks(text, kind) {
  const begin = new RegExp(`^(\\d{2})${kind}BGN\\s*$`);
  const end = new RegExp(`^(\\d{2})${kind}END\\s*$`);
  const blocks = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const b = begin.exec(line);
    if (b) {
      cur = { venue_code: Number.parseInt(b[1], 10), lines: [] };
      continue;
    }
    if (end.test(line)) {
      if (cur) blocks.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur); // ENDが無いまま終わった場合も捨てない
  return blocks;
}

/** 節の日目の解釈（K・B 共通）。out.day_label から series_day・is_final_day を決める */
function applyDayLabel(out) {
  if (out.day_label) {
    const dm = /第(\d+)日/.exec(out.day_label);
    if (dm) out.series_day = Number.parseInt(dm[1], 10);
    // 実際の K/B は最終日も「第N日」と書き、「最終日」とは書かない（2019-04〜2026-09 の全ファイルで「最終日」0件。
    // BOA-696）。is_final_day は K/B からは決まらないので、使う側は race_series の終了日で判定する
    if (out.day_label === "最終日") out.is_final_day = true;
  }
}

export { squash, half, toInt, toNum, splitVenueBlocks, applyDayLabel };
