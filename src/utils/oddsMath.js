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

// ---- 思考アシストの買い目（BOA-430、spec FR-7・FR-8・D-38）----

/** 3連単の最小の購入単位（円） */
export const STAKE_UNIT = 100;

/**
 * 3連単のオッズの表（"1-2-3" → オッズ）から人気順（オッズの昇順、1始まり）を作る。
 * 同じオッズは同じ順位にし、次の順位は飛ばす（1・2・2・4）。オッズの無い組（票なし・欠場）は順位を付けない
 * @param {Record<string, number|null>} trifecta
 * @returns {Map<string, number>}
 */
export function popularityRanks(trifecta) {
  const entries = Object.entries(trifecta ?? {})
    .filter(([, v]) => v != null && v > 0)
    .sort((a, b) => a[1] - b[1]);
  const ranks = new Map();
  entries.forEach(([key, value], i) => {
    const prev = entries[i - 1];
    ranks.set(key, prev && prev[1] === value ? ranks.get(prev[0]) : i + 1);
  });
  return ranks;
}

/**
 * 1着・2着・3着の候補から3連単の組を作る。同じ艇を2回以上含む組と、欠場の艇を含む組は除く（D-38）
 * @param {{1: Iterable<number>, 2: Iterable<number>, 3: Iterable<number>}} bets
 * @param {Iterable<number>} [absentBoats]
 * @returns {string[]} "a-b-c"（1着→2着→3着の艇番の昇順）
 */
export function expandTickets(bets, absentBoats = []) {
  const absent = new Set(absentBoats);
  const sorted = (s) => [...new Set(s ?? [])].sort((a, b) => a - b);
  const tickets = [];
  for (const a of sorted(bets?.[1]))
    for (const b of sorted(bets?.[2]))
      for (const c of sorted(bets?.[3])) {
        if (a === b || a === c || b === c) continue;
        if (absent.has(a) || absent.has(b) || absent.has(c)) continue;
        tickets.push(`${a}-${b}-${c}`);
      }
  return tickets;
}

/**
 * 配分（FR-8）。予算を100円単位（切り捨て）で各組に配る。
 *   equal:       各組に同じ額
 *   equalPayout: どれが当たっても払戻がほぼ同じになるよう、オッズの逆数に比例させる（各組に最低100円）。
 *                切り捨てた後の余りは、払戻が一番少ない組から100円ずつ足す（予算は超えない。spec FR-8・D-43、BOA-801 6）
 * 予算が 100円×点数 に足りないときは配分を出さない（insufficient）。オッズの無い組は配分から外して missing に返す
 * @param {{tickets: string[], trifecta: Record<string, number|null>, budget: number, mode: "equal"|"equalPayout"}} args
 * @returns {{insufficient: true, minimum: number, missing: string[]} | {insufficient: false, rows: Array<{ticket: string, odds: number, stake: number, payout: number}>, total: number, remainder: number, composite: number|null, multiplier: {min: number, max: number}|null, trigami: boolean, missing: string[]}}
 */
export function allocateStakes({ tickets, trifecta, budget, mode }) {
  const priced = tickets.filter(
    (t) => trifecta?.[t] != null && trifecta[t] > 0,
  );
  const missing = tickets.filter((t) => !priced.includes(t));
  const minimum = STAKE_UNIT * priced.length;
  if (priced.length === 0 || !(budget >= minimum))
    return { insufficient: true, minimum, missing };

  const units = Math.floor(budget / STAKE_UNIT);
  let stakesInUnits;
  // 均等払戻で余りを足したか（配分の下に1行で知らせる）
  let topped = false;
  if (mode === "equal") {
    const each = Math.floor(units / priced.length);
    stakesInUnits = priced.map(() => each);
  } else {
    const inv = priced.map((t) => 1 / trifecta[t]);
    const sumInv = inv.reduce((s, v) => s + v, 0);
    stakesInUnits = inv.map((v) =>
      Math.max(1, Math.floor((units * v) / sumInv)),
    );
    // 最低1単位に引き上げた分で予算を超えたら、多い組から1単位ずつ減らす（1単位は残す）
    let over = stakesInUnits.reduce((s, v) => s + v, 0) - units;
    while (over > 0) {
      const i = stakesInUnits.indexOf(Math.max(...stakesInUnits));
      if (stakesInUnits[i] <= 1) break;
      stakesInUnits[i] -= 1;
      over -= 1;
    }
    // 余りは払戻（オッズ×単位数）が一番少ない組に1単位ずつ足す。同じなら先の組（D-43）
    let left = units - stakesInUnits.reduce((s, v) => s + v, 0);
    while (left > 0) {
      let i = 0;
      priced.forEach((t, j) => {
        if (
          trifecta[t] * stakesInUnits[j] <
          trifecta[priced[i]] * stakesInUnits[i]
        )
          i = j;
      });
      stakesInUnits[i] += 1;
      topped = true;
      left -= 1;
    }
  }

  const rows = priced.map((ticket, i) => {
    const stake = stakesInUnits[i] * STAKE_UNIT;
    const odds = trifecta[ticket];
    // 払戻は100円あたりの払戻（オッズ×100、10円未満切り捨て）× 単位数。公式と同じ切り捨て。
    // 4.1×100＝409.99… のような浮動小数の誤差で10円落ちないよう、先に1円単位へ丸める
    const payout =
      Math.floor(Math.round(odds * STAKE_UNIT) / 10) * 10 * stakesInUnits[i];
    return { ticket, odds, stake, payout };
  });
  const total = rows.reduce((s, r) => s + r.stake, 0);
  const payouts = rows.map((r) => r.payout / total);
  const composite = compositeOdds(priced.map((t) => trifecta[t]));
  return {
    insufficient: false,
    rows,
    total,
    remainder: budget - total,
    composite,
    // 丸めた後の倍率（払戻÷合計）の幅（Codex F06）
    multiplier: { min: Math.min(...payouts), max: Math.max(...payouts) },
    // 合成オッズ（理論値）が1.0未満ならトリガミ（FR-8）
    trigami: composite != null && composite < 1,
    missing,
    topped,
  };
}
