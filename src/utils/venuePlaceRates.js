/**
 * 会場特徴カードの「もっと詳しく」（BOA-269）の集計。
 * 取得済みの outcome_distribution（3連単パターンごとの90日件数）と
 * winning_technique_stats（枠番×決まり手）だけから作り、新しいクエリは足さない。
 */

export const TECHNIQUE_ORDER = [
  "逃げ",
  "差し",
  "まくり",
  "まくり差し",
  "抜き",
  "恵まれ",
];

/**
 * 枠番ごとの1着率・2連率・3連率（%）。
 * outcome_distribution は「1着・2着・3着の艇」の組ごとの件数なので、
 * ある艇が1着〜2着に入った組の件数の和が2連対の回数になる。
 * 3連単の組の件数の合計は total_races と一致する（住之江・戸田・大村で確認、2026-10-02）
 * @param {{total_races: number, data: Record<string, Array<{second_boat:number, third_boat:number, count:number}>>}} outcomeData
 * @returns {Array<{boat:number, winRate:number, top2Rate:number, top3Rate:number}>|null}
 */
export function placeRatesByBoat(outcomeData) {
  const total = outcomeData?.total_races ?? 0;
  if (!total) return null;
  const counts = new Map(
    [1, 2, 3, 4, 5, 6].map((b) => [b, { first: 0, top2: 0, top3: 0 }]),
  );
  Object.entries(outcomeData.data ?? {}).forEach(([first, patterns]) => {
    (patterns ?? []).forEach((p) => {
      const n = p.count ?? 0;
      const add = (boat, keys) =>
        keys.forEach((k) => {
          const c = counts.get(boat);
          if (c) c[k] += n;
        });
      add(Number(first), ["first", "top2", "top3"]);
      add(p.second_boat, ["top2", "top3"]);
      add(p.third_boat, ["top3"]);
    });
  });
  return [...counts].map(([boat, c]) => ({
    boat,
    winRate: (c.first / total) * 100,
    top2Rate: (c.top2 / total) * 100,
    top3Rate: (c.top3 / total) * 100,
  }));
}

/**
 * 枠番の決まり手の内訳。件数の多い順ではなく、決まり手の固定の順に並べる
 * （帯グラフの色の並びを枠番の間でそろえるため）。未知の決まり手は末尾に付ける
 * @param {{techniques?: Array<{technique:string, count:number}>}|undefined} boatTechniques
 * @returns {{total:number, items:Array<{technique:string, count:number, share:number}>}}
 */
export function techniqueBreakdown(boatTechniques) {
  const list = (boatTechniques?.techniques ?? []).filter(
    (x) => (x.count ?? 0) > 0,
  );
  const total = list.reduce((s, x) => s + x.count, 0);
  const rank = (name) => {
    const i = TECHNIQUE_ORDER.indexOf(name);
    return i < 0 ? TECHNIQUE_ORDER.length : i;
  };
  const items = [...list]
    .sort((a, b) => rank(a.technique) - rank(b.technique))
    .map((x) => ({
      technique: x.technique,
      count: x.count,
      share: total ? (x.count / total) * 100 : 0,
    }));
  return { total, items };
}
