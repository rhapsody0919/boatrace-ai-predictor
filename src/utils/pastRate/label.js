/**
 * BOA-635 の定番／レアのラベル（docs/design/past-rate-check/spec.md FR-3）。純粋関数。
 *
 * 線は T0-1 の検証で採った (15, 5)（docs/design/past-rate-check/analysis/label-threshold-result.md）。
 * ラベルを出すのは、T0-1 で合格し、2026-10-13 のオーナー決定 B で情報が薄くないとした小分けだけ
 * （着順の流し・展開・スリットの形・進入）。着順1点・1号艇・配当の帯・自分で作るでは出さない。
 */
const LINES = { standard: 15, rare: 5 };

const BOTH = { standard: true, rare: true };
const NONE = { standard: false, rare: false };
const SHOWN = {
  single: NONE,
  nagashi: BOTH,
  boat1: NONE,
  tenkai: BOTH,
  pattern: BOTH,
  custom: NONE,
  entry: BOTH,
  payout: NONE,
};

/** 小分け: 着順は流すか（nagashi）、スリットは形か自分で作るか（mode）。ほかは型そのもの */
export function subtypeOf(type, input) {
  if (type === "order") return input?.nagashi ? "nagashi" : "single";
  if (type === "slit") return input?.mode === "custom" ? "custom" : "pattern";
  return type;
}

/**
 * 丸める前の c ÷ N で判定する（整数で比べて境界の浮動小数のずれを避ける）。N=0 はラベルなし
 * @returns {"standard"|"rare"|null}
 */
export function rateLabel({ n, count }, type, input) {
  if (!n) return null;
  const shown = SHOWN[subtypeOf(type, input)];
  if (shown.standard && count * 100 >= LINES.standard * n) return "standard";
  if (shown.rare && count * 100 < LINES.rare * n) return "rare";
  return null;
}

/** 注記に出す線（出すラベルの分だけ）。どちらも出さない小分けは null */
export function thresholdNote(type, input) {
  const shown = SHOWN[subtypeOf(type, input)];
  if (!shown.standard && !shown.rare) return null;
  return {
    standard: shown.standard ? LINES.standard : null,
    rare: shown.rare ? LINES.rare : null,
  };
}
