/**
 * アナロジー・ファインダーの寄与度（BOA-271 FR-1）の純粋関数。
 * API（api/analogy/contribution.js）と、API が失敗したときの直読み（analogyService.js）で同じ規則を使う。
 * 約束は scripts/maintenance/verify-analogy-contribution.js で固定している。
 */

/** これ未満のレース数のスライスは一段広げる／小標本として出す */
export const MIN_RACES = 30;
/** 隣の順位との差がこの倍数×SD に満たなければ、その順位を強調しない */
export const RANK_SD_MULTIPLE = 2;

export const GRADES = ["ippan", "G3", "G2", "G1", "SG"];
export const ROUNDS = ["yosen", "junyu", "yusho", "other"];
export const FINISH_TARGETS = [1, 2, 3];

const STAGE_CATEGORY_ROUND = {
  qualifier: "yosen",
  qualifierSpecial: "yosen",
  semifinal: "junyu",
  final: "yusho",
};

/**
 * race_conditions.race_stage の分類（getRaceStageCategory のキー）→ 寄与度のラウンド4区分。
 * 学習側（scripts/ml/analogy/features.py の round_from_stage）と同じ対応。分類不能の企画レース名は
 * 「その他」、ステージが無ければ null（呼び出し側で「すべて」にする）
 */
export function roundFromStageCategory(categoryKey, hasStage) {
  if (!hasStage) return null;
  return STAGE_CATEGORY_ROUND[categoryKey] ?? "other";
}

/** 会場→ラウンド→グレードの順に一段ずつ広げた候補（要求そのものが先頭） */
export function sliceCandidates({ venue, grade, round }) {
  const out = [{ venue, grade, round, widened: [] }];
  const push = (next, step) => {
    const last = out[out.length - 1];
    const cand = { ...last, ...next };
    if (
      cand.venue === last.venue &&
      cand.grade === last.grade &&
      cand.round === last.round
    )
      return;
    out.push({ ...cand, widened: [...last.widened, step] });
  };
  push({ venue: 0 }, "venue");
  push({ round: "all" }, "round");
  push({ grade: "all" }, "grade");
  return out;
}

/**
 * @param {Array<object>} rows analogy_contribution_profiles の行（同じ版・同じ着順。候補のスライスを含む）
 * @param {{venue:number, grade:string, round:string}} requested
 * @returns {{resolved, widened:string[], smallSample:boolean, boats:Record<number, object>}|null}
 */
export function resolveContributionSlice(rows, requested) {
  const key = (r) => `${r.venue_code}|${r.grade}|${r.round}`;
  const bySlice = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!bySlice.has(k)) bySlice.set(k, {});
    bySlice.get(k)[r.boat_number] = r;
  }
  const found = sliceCandidates(requested)
    .map((c) => ({
      ...c,
      boats: bySlice.get(`${c.venue}|${c.grade}|${c.round}`),
    }))
    .filter((c) => c.boats?.[0]);
  if (found.length === 0) return null;
  const enough = found.find((c) => c.boats[0].n_races >= MIN_RACES);
  const pick = enough || found[found.length - 1];
  return {
    resolved: { venue: pick.venue, grade: pick.grade, round: pick.round },
    widened: pick.widened,
    smallSample: !enough,
    boats: pick.boats,
  };
}

/**
 * テーマを themes 配列の順・数で並べ、シェアの順位と「順位を強調してよいか」を付ける。
 * @param {Array<{key:string}>} themes analogy_models.themes
 * @param {Record<string, number>} shares
 * @param {Record<string, number>|null} sd seed を変えた再学習のシェアの SD
 */
export function themeEntries(themes, shares, sd) {
  const entries = themes.map((t) => ({
    ...t,
    share: shares?.[t.key] ?? 0,
    sd: sd?.[t.key] ?? null,
  }));
  const order = [...entries].sort((a, b) => b.share - a.share);
  const separated = (a, b) =>
    a.sd != null &&
    b.sd != null &&
    Math.abs(a.share - b.share) >= RANK_SD_MULTIPLE * Math.max(a.sd, b.sd);
  return entries.map((e) => {
    const i = order.indexOf(e);
    const above = order[i - 1];
    const below = order[i + 1];
    const rankDistinct =
      sd != null &&
      (!above || separated(e, above)) &&
      (!below || separated(e, below));
    return { ...e, rank: i + 1, rankDistinct };
  });
}
