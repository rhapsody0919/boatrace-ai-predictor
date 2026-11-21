/**
 * predictionAssistPower - 思考アシストの機力の部品（項目ごとの一番・部品交換・チルトの違う艇・オリジナル展示の種別）。
 * src/utils/assistSummary.js から字のまま移した（外へ出す名は assistSummary が再 export する）
 */

// ---- 機力（screens「レンズごとの図 C」機力、FR-3a）----

/** オリジナル展示の種別 → 最良の判定のキー（raceIndicators の ORIGINAL_EXHIBITION_ROW_META と同じく全種別 min） */
export const OX_RULE = {
  一周: "ox_lap",
  まわり足: "ox_turn",
  直線: "ox_straight",
  半周ラップ: "ox_half_lap",
};

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 機力の結論に出す「項目ごとの一番」。順は展示タイム → オリジナル展示（種目の順）→ モーター2連率で固定。
 * 展示タイムだけで結論を決めない（BOA-808 2: 徳山の一周・まわり足は1号艇が一番なのに出なかった）
 * @param {{table: ReturnType<typeof exhibitionTable>|null, motor: {best: Set<number>, valueOf: (boat: number) => number|null}}} args
 * @returns {Array<{label: string, boats: number[], text: string}>} text は単位つきの値（同着は先頭の艇の値）
 */
export function powerWinners({ table, motor }) {
  const sorted = (set) => [...set].sort((a, b) => a - b);
  const rowOf = (boat) => table.rows.find((r) => r.boat === boat);
  const items = [];
  const push = (label, set, valueOf, fmt) => {
    if (!set?.size) return;
    const boats = sorted(set);
    const v = valueOf(boats[0]);
    if (v == null) return;
    items.push({ label, boats, text: fmt(v) });
  };
  const sec = (v) => `${v.toFixed(2)}秒`;
  if (table) {
    push("展示タイム", table.best.exh, (b) => rowOf(b)?.exh ?? null, sec);
    table.kinds.forEach((k, i) =>
      push(k, table.best.ox[i], (b) => rowOf(b)?.ox[i] ?? null, sec),
    );
  }
  push("モーター2連率", motor.best, motor.valueOf, (v) => `${v.toFixed(1)}%`);
  return items;
}

/** 部品交換・プロペラ交換のあった艇（raceIndicators の部品交換の行と同じ判定。parts_changed は部品名の配列） */
export function partsChangedBoats(maintenance) {
  return (maintenance ?? [])
    .filter(
      (r) =>
        (Array.isArray(r.parts_changed) && r.parts_changed.length > 0) ||
        Boolean(r.propeller_change),
    )
    .map((r) => r.boat_number)
    .sort((a, b) => a - b);
}

/**
 * チルトが6艇の中で違う艇（一番多い値と違う艇）。多い値が1艇だけ（全艇ばらばら）なら印を付けない
 * @returns {Map<number, number>} 艇番 → チルト
 */
export function tiltOutliers(racers) {
  const vals = racers
    .filter((r) => !r.absent && r.tilt != null)
    .map((r) => [r.boat, r.tilt]);
  const freq = new Map();
  for (const [, t] of vals) freq.set(t, (freq.get(t) ?? 0) + 1);
  const [mode, count] = [...freq].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (count < 2) return new Map();
  return new Map(vals.filter(([, t]) => t !== mode));
}

export { num };
