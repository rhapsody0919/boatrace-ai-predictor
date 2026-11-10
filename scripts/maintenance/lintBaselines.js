/**
 * 依存の向きの関所の判定（純関数だけ。child_process・fs・ネットワークを使わない、BOA-1428）。
 * 辺は { from, to, rule }。基準は { "<rule>": { "<from>": ["<to>", ...] } }。
 */

// データ層の和。後で dataLayerSource.js を読む形にできるよう、一覧はここ1か所の関数に分ける
const DATA_LAYER_PATTERNS = [
  /^src\/services\/supabaseDataService\.js$/,
  /^src\/services\/core[^/]*\.js$/,
  /^src\/services\/[^/]*Queries[^/]*\.js$/,
];
export const dataLayerPatterns = () => DATA_LAYER_PATTERNS;

export const isDataLayer = (file) =>
  dataLayerPatterns().some((re) => re.test(file));

export const FACADE = "src/services/supabaseDataService.js";
export const DATA_LAYER_KEY = "<data-layer>";

/** 基準の key。和の中の from は1つにまとめる（関数が別ファイルへ移っても変わらない） */
const fromKey = (from) => (isDataLayer(from) ? DATA_LAYER_KEY : from);

const toSets = (edges) => {
  const map = new Map();
  for (const { rule, from, to } of edges) {
    const key = `${rule}\t${fromKey(from)}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(to);
  }
  return map;
};

/** 基準の object を Map<"rule\tfrom", Set<to>> にする */
const baselineSets = (baseline) => {
  const map = new Map();
  for (const [rule, froms] of Object.entries(baseline ?? {})) {
    for (const [from, tos] of Object.entries(froms)) {
      map.set(`${rule}\t${from}`, new Set(tos));
    }
  }
  return map;
};

/**
 * 違反の辺を基準と比べる。
 * 基準に無い from、または基準の to の集合を越える to があれば赤（problems に出す）。
 */
export function compareEdgesToBaseline(edges, baseline) {
  const base = baselineSets(baseline);
  const problems = [];
  for (const [key, tos] of toSets(edges)) {
    const allowed = base.get(key);
    const [rule, from] = key.split("\t");
    if (!allowed) {
      problems.push(`${rule}: 基準に無い辺 ${from} → ${[...tos].join(", ")}`);
      continue;
    }
    const extra = [...tos].filter((t) => !allowed.has(t));
    if (extra.length > 0) {
      problems.push(`${rule}: 基準を越える辺 ${from} → ${extra.join(", ")}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

const baselineRows = (baseline) => {
  const rows = new Set();
  for (const [key, tos] of baselineSets(baseline)) {
    for (const to of tos) rows.add(`${key}\t${to}`);
  }
  return rows;
};

/**
 * 基準は減る向きだけ。merge-base の基準より行が増えたら赤、減った分は better に返す。
 */
export function compareBaselines(mergeBaseBaseline, currentBaseline) {
  const before = baselineRows(mergeBaseBaseline);
  const after = baselineRows(currentBaseline);
  const added = [...after].filter((r) => !before.has(r));
  const removed = [...before].filter((r) => !after.has(r));
  return {
    ok: added.length === 0,
    added,
    better: removed.length > 0 ? removed : [],
    problems: added.map((r) => `基準の行が増えた: ${r.replaceAll("\t", " ")}`),
  };
}

/** src/utils/ への新しいファイルの追加は赤。addedPaths は追加のパスの一覧 */
export function newUtilsFileProblems(addedPaths) {
  return (addedPaths ?? [])
    .filter((p) => p.startsWith("src/utils/"))
    .map((p) => `src/utils/ に新しいファイル: ${p}`);
}

/** facade-frozen を error にしてよいか: supabaseDataService.js が殻だけ（関数の本体0） */
export function facadeShouldBeError(functionBodyCount) {
  return functionBodyCount === 0;
}
