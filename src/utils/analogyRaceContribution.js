/**
 * アナロジー・ファインダーのレースごとの寄与度（BOA-271 FR-1b、ADR-0083）: 6艇の TreeSHAP をテーマに集計する純粋関数。
 * 集計はこの1か所だけで行う（Python 側には持たない。ADR-0083 決定3）。
 *
 * - テーマのシェア: 特徴量ごとにレース内で中心化した SHAP（6艇の平均を引いた値）の絶対値を6艇ぶん足し、
 *   テーマごとに合計して全体で割る（合計1）。「このレースの6艇の差の内訳」で、条件ごとの寄与度
 *   （中心化しない集計。analogyContribution.js）とは定義が違う（ADR-0083 決定10）
 * - 艇ごとの値: 中心化した SHAP の符号つきの合計（テーマごと・グループごと）。テーマの中で符号が打ち消すので、
 *   シェアと同じ数字にはならない（画面は「押し上げ／押し下げ」で書く）
 */

/**
 * @param {object} p
 * @param {string[]} p.featureNames モデルの列の並び（contributions の並びと同じ）
 * @param {ArrayLike<number>[]} p.contribs 艇ごとの contributions（長さ featureNames+1、最後の期待値は使わない）
 * @param {number[]} p.boatNumbers contribs と同じ並びの艇番
 * @param {{key:string, groups:{key:string, features:string[]}[]}[]} p.themes per_race_meta.json の themes
 * @returns {{theme_shares: Record<string, number>, boats: {boat_number:number, themes: Record<string, number>, groups: Record<string, number>}[]}}
 */
export function aggregateRaceContribution({
  featureNames,
  contribs,
  boatNumbers,
  themes,
}) {
  if (contribs.length !== boatNumbers.length || contribs.length === 0) {
    throw new Error(
      `aggregateRaceContribution: 艇の数が合いません（contribs ${contribs.length}、boatNumbers ${boatNumbers.length}）`,
    );
  }
  const col = new Map(featureNames.map((n, i) => [n, i]));
  const owner = new Map();
  for (const t of themes) {
    for (const g of t.groups) {
      for (const f of g.features) owner.set(f, { theme: t.key, group: g.key });
    }
  }
  const orphan = featureNames.filter((f) => !owner.has(f));
  if (orphan.length > 0) {
    throw new Error(
      `aggregateRaceContribution: どのテーマにも入っていない列があります: ${orphan.join(", ")}`,
    );
  }

  const nBoats = contribs.length;
  const centered = featureNames.map((_, j) => {
    const mean = contribs.reduce((s, c) => s + c[j], 0) / nBoats;
    return contribs.map((c) => c[j] - mean);
  });

  const absByTheme = Object.fromEntries(themes.map((t) => [t.key, 0]));
  featureNames.forEach((f, j) => {
    absByTheme[owner.get(f).theme] += centered[j].reduce(
      (s, v) => s + Math.abs(v),
      0,
    );
  });
  const total = Object.values(absByTheme).reduce((s, v) => s + v, 0);
  if (!(total > 0)) {
    throw new Error(
      "aggregateRaceContribution: 6艇の寄与度に差がありません（全艇同じ値）",
    );
  }
  const theme_shares = Object.fromEntries(
    Object.entries(absByTheme).map(([k, v]) => [k, v / total]),
  );

  // モデルに列が1つも無いグループ（出走表時点のモデルの展示タイム等）は出さない
  const modelGroups = themes.flatMap((t) =>
    t.groups
      .filter((g) => g.features.some((f) => col.has(f)))
      .map((g) => g.key),
  );
  const boats = boatNumbers.map((boat_number, i) => {
    const byTheme = Object.fromEntries(themes.map((t) => [t.key, 0]));
    const byGroup = Object.fromEntries(modelGroups.map((k) => [k, 0]));
    featureNames.forEach((f, j) => {
      const o = owner.get(f);
      byTheme[o.theme] += centered[j][i];
      byGroup[o.group] += centered[j][i];
    });
    return { boat_number, themes: byTheme, groups: byGroup };
  });
  return { theme_shares, boats };
}

/**
 * そのグループが最も押し上げた艇（中心化した値が最大で正のもの）。どの艇も押し上げていなければ null。
 * 画面の「変化」の1行（例「展示タイムが押し上げたのは4号艇」）に使う（ADR-0083 決定9）
 */
export function boatMostRaisedBy(boats, groupKey) {
  let best = null;
  for (const b of boats) {
    const v = b.groups[groupKey];
    if (v === undefined || !(v > 0)) continue;
    if (best === null || v > best.value)
      best = { boat_number: b.boat_number, value: v };
  }
  return best;
}
