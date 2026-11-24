/**
 * 指標の定義: 大分類「機力（モーター・ボート）」（ADR-0108、設計 docs/design/indicator-parts/plan.md §3、族は catalog.md）。
 * 今の定義は、データ出走表のモーターの行を見た目を変えずに移した物（段1）。
 * 未使用の新モーター・交換直後の「—」と注記は、今は見せ方の層（raceIndicatorsRowDefs.jsx）に残す
 * （判定 src/utils/motorUsage.js を src/pure から読めないため）。
 */
import { toNumber } from "./raceIndicatorText.js";

export const MOTOR_INDICATORS = [
  {
    id: "motor.twoRate.last90d",
    family: "F-042",
    category: "motor",
    kind: "aggregate",
    subject: "motor",
    scenes: ["race"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowMotor",
      short: "review.cols.motor",
      hint: "motor",
    },
    // 自社の過去90日の再計算（getRaceMotorBreakdown）。取れないとき・過去のレースは出走表の公式の値
    // （名前は「過去90日」のまま。段0の A1 で名前を分ける）
    sources: ["race.motor", "players"],
    window: "過去90日（自社の再計算。取れないときは公式の値）",
    format: "rateParts",
    compare: { direction: "max", digits: 1, minN: null },
    select: ({ players, analysis }) => {
      const byBoat = new Map(
        (analysis?.motor ?? []).map((r) => [r.boat_number, r]),
      );
      return new Map(
        (players ?? []).map((p) => [
          p.number,
          {
            value: toNumber(byBoat.get(p.number)?.motor_2rate ?? p.motor2Rate),
            n: null,
            hidden: false,
          },
        ]),
      );
    },
    detailTab: "motor",
    adornment: "motorPowerLink",
  },
];
