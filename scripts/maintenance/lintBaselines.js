/**
 * 依存の向きの関所の判定（純関数だけ。child_process・fs・ネットワークを使わない、BOA-1428）。
 * 辺は { from, to, rule }。基準は { "<rule>": { "<from>": ["<to>", ...] } }。
 */

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

// 新しい問い合わせの置き場は領域の <領域>Queries*.js だけ（HR62・設計図 §5。殻や別名のサービスを増やさない）
const SERVICES_NEW_FILE_OK = /^[a-z]+Queries[0-9]*\.js$/;

/** src/services/ の直下への新しいファイルは <領域>Queries*.js のほか赤。下のフォルダも赤 */
export function newServicesFileProblems(addedPaths) {
  return (addedPaths ?? [])
    .filter((p) => p.startsWith("src/services/"))
    .filter((p) => !SERVICES_NEW_FILE_OK.test(p.slice("src/services/".length)))
    .map(
      (p) =>
        `src/services/ に <領域>Queries*.js でない新しいファイル: ${p}（新しい問い合わせは領域の Queries へ）`,
    );
}

const edgeRows = (edges) =>
  new Set(edges.map(({ rule, from, to }) => `${rule}\t${from}\t${to}`));

/**
 * 全体で0の関所（2026-11-25）: 違反の辺のうち、例外の表 { rule: { from: [to] } } に無い物を問題に、
 * 表にあって今は違反でない行を stale（消せる行）に返す。和の中の from はまとめない（辺ごと）
 */
export function judgeAgainstExceptions(edges, exceptions) {
  const allowed = baselineRows(exceptions);
  const now = edgeRows(edges);
  const problems = [...now]
    .filter((r) => !allowed.has(r))
    .map((r) => {
      const [rule, from, to] = r.split("\t");
      return `${rule}: 例外の表に無い辺 ${from} → ${to}`;
    });
  const stale = [...allowed].filter((r) => !now.has(r)).map((r) => r.replaceAll("\t", " "));
  return { ok: problems.length === 0, problems, stale };
}
