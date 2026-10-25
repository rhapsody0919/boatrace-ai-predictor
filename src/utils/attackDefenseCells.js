/**
 * 超展開データ（AttackDefenseTable）のセルの値の算出（純関数）。
 *
 * 画面（src/components/race/AttackDefenseTable.jsx）と、全貌動画の材料
 * （sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs）が同じ値を出すため、
 * 表の中にあった計算を手を加えずにここへ移した。
 *
 * 入力は toWakuRacerStats（src/utils/racerStats.js）の1艇分。キーはすべて枠番で、実進入コースではない
 * （BOA-284）。値の作り方（scripts/analysis/aggregate-racer-stats.js）:
 *   - attackDistribution: 全期間の、選手が1着の走の決まり手の内訳（分母は勝ち数）。勝ち5未満は全国の既定の分布
 *   - defenseDistribution: 全期間の、1着でない走の勝者の決まり手の内訳（分母は負け数）
 *   - wakuRaceCounts: 枠番別の出走数・勝数（直近365日、BOA-824）
 * セルの回数は「内訳の割合 × 直近365日の勝ち（負け）数」を丸めたもの。分母は直近365日の出走数。
 *
 * Node からも読むため、import は拡張子付き。
 */
import { COURSE_DEFAULT_DISTRIBUTION } from "../../scripts/lib/winningTechniques.js";

// 全国平均 攻撃分布（14,155レース集計）。集計側の既定の分布と同じもの
const DEFAULT_ATTACK = COURSE_DEFAULT_DISTRIBUTION;

// 全国平均 防御分布
const DEFAULT_DEFENSE = {
  1: {
    sashi: 0.28,
    makuri: 0.25,
    makurizashi: 0.22,
    nuki: 0.15,
    megumare: 0.1,
  },
};

// 表示する行の定義（文言は i18n キーで管理）
export const TECHNIQUE_ROWS = [
  {
    key: "nige",
    label1Key: "attackDefense.nige",
    labelOtherKey: null,
    course1Only: true,
  },
  {
    key: "sashi",
    label1Key: "attackDefense.sashiDefense",
    labelOtherKey: "attackDefense.sashiAttack",
  },
  {
    key: "makuri",
    label1Key: "attackDefense.makuriDefense",
    labelOtherKey: "attackDefense.makuriAttack",
  },
  {
    key: "makurizashi",
    label1Key: "attackDefense.makurizashiDefense",
    labelOtherKey: "attackDefense.makurizashiAttack",
  },
  {
    key: "other",
    label1Key: "attackDefense.other",
    labelOtherKey: "attackDefense.other",
    composite: ["nuki", "megumare"],
  },
];

function calcCount(dist, technique, base) {
  if (!dist || !base) return null;
  const rate = dist[technique];
  if (rate == null || rate === 0) return 0;
  return Math.round(rate * base);
}

function calcCompositeCount(dist, keys, base) {
  if (!dist || !base) return null;
  let sum = 0;
  for (const k of keys) {
    const rate = dist[k];
    if (rate != null) sum += rate;
  }
  return Math.round(sum * base);
}

/** 全枠番合計勝利数（直近365日）。2未満は全国平均、2〜4は参考の表示 */
export function getTotalWins(stats) {
  const counts = stats.wakuRaceCounts;
  if (!counts) return 0;
  let sum = 0;
  for (const c of Object.values(counts)) {
    sum += c.wins || 0;
  }
  return sum;
}

// 全国平均値のデフォルト率を取得
function getDefaultRate(row, waku) {
  if (waku === 1) {
    if (row.key === "nige") return DEFAULT_ATTACK[1]?.nige || 0;
    if (row.composite) {
      let sum = 0;
      for (const k of row.composite) sum += DEFAULT_DEFENSE[1]?.[k] || 0;
      return sum;
    }
    return DEFAULT_DEFENSE[1]?.[row.key] || 0;
  }
  if (row.composite) {
    let sum = 0;
    for (const k of row.composite) sum += DEFAULT_ATTACK[waku]?.[k] || 0;
    return sum;
  }
  return DEFAULT_ATTACK[waku]?.[row.key] || 0;
}

/**
 * attackDistribution が集計側の既定の分布（全期間の勝ち5未満で差し替えたもの）か。
 * 既定の分布から出た回数は、その選手の値ではない
 */
export function isDefaultAttackDistribution(dist) {
  if (!dist) return false;
  const keys = Object.keys(DEFAULT_ATTACK);
  if (Object.keys(dist).length !== keys.length) return false;
  return keys.every((c) => {
    const a = dist[c];
    const b = DEFAULT_ATTACK[c];
    if (!a) return false;
    const ak = Object.keys(a);
    return (
      ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k])
    );
  });
}

/**
 * セルの値: 回数/分母
 * 戻り値: string | { type: 'default'|'reference', value: string }
 *   default は全国平均の%（その選手の値ではない）、reference は勝ち2〜4の参考値
 */
export function getCellValue(row, waku, stats, wakuStr, wins, total) {
  if (row.course1Only && waku !== 1) return "-";
  if (!total) return "-";

  const totalWins = getTotalWins(stats);
  const isInsufficient = totalWins < 2;
  const isReference = totalWins >= 2 && totalWins < 5;

  // データ不足: 全国平均値を%で薄字表示
  if (isInsufficient) {
    const rate = getDefaultRate(row, waku);
    if (rate === 0) return "-";
    return { type: "default", value: `${Math.round(rate * 100)}%` };
  }

  if (waku === 1) {
    if (row.key === "nige") {
      const dist = stats.attackDistribution?.[wakuStr];
      const count = calcCount(dist, "nige", wins);
      const val = count != null ? `${count}/${total}` : "-";
      return isReference ? { type: "reference", value: val } : val;
    }
    // 防御: 負けた回数が分母
    const losses = total - wins;
    const dist = stats.defenseDistribution?.[wakuStr];
    if (!dist || !losses) {
      const val = `0/${total}`;
      return isReference ? { type: "reference", value: val } : val;
    }
    const count = row.composite
      ? calcCompositeCount(dist, row.composite, losses)
      : calcCount(dist, row.key, losses);
    const val = count != null ? `${count}/${total}` : "-";
    return isReference ? { type: "reference", value: val } : val;
  } else {
    const dist = stats.attackDistribution?.[wakuStr];
    if (!dist || !wins) {
      const val = `0/${total}`;
      return isReference ? { type: "reference", value: val } : val;
    }
    const count = row.composite
      ? calcCompositeCount(dist, row.composite, wins)
      : calcCount(dist, row.key, wins);
    const val = count != null ? `${count}/${total}` : "-";
    return isReference ? { type: "reference", value: val } : val;
  }
}

/**
 * 1艇分の表の列（画面の1列と同じ値）。
 * @param {{boatNumber: number, attackDistribution: object|null, defenseDistribution: object|null, wakuRaceCounts: object|null}} stats
 * @returns {{waku: number, wins: number, total: number, cells: Record<string, string|{type: string, value: string}>}}
 */
export function attackDefenseColumn(stats) {
  const waku = stats.boatNumber;
  const wakuStr = String(waku);
  const counts = stats.wakuRaceCounts?.[wakuStr];
  const wins = counts?.wins || 0;
  const total = counts?.total || 0;
  const cells = Object.fromEntries(
    TECHNIQUE_ROWS.map((row) => [
      row.key,
      getCellValue(row, waku, stats, wakuStr, wins, total),
    ]),
  );
  return { waku, wins, total, cells };
}
