/**
 * useAiCopyTextRows - useAiCopyText.js の buildRows が並べる、1行ぶんの値を作る関数（BOA-194）。
 * どれも行（{ key, label, values }）を返す純関数で、値の整形はデータ出走表と同じ。
 * 画面側の整形関数（toNumber・translateTechnique・translatePartName・expectedCourseWinRateText）は
 * 引数 ui で受け取る（useAiCopyText.js が src/pure/raceIndicatorText.js から渡す。RA41d で画面の部品から pure へ移した）。
 */
import { formatExhibitionSt } from "../utils/formatters";
import { meetPrevRunState, meetPrevRunWhenParams } from "../utils/prevResult";

export const DASH = "—";

export function byBoat(rows, key = "boat_number") {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row[key], row));
  return map;
}

export function buildNameRow(t, players) {
  return {
    key: "name",
    label: t("aiCopy.playerNameLabel"),
    values: players.map((p) => p.name ?? DASH),
  };
}

export function buildWinRateRow(t, players, flying, ui) {
  const { toNumber } = ui;
  return {
    key: "winRate",
    label: t("dataTable.rowWinRate"),
    values: players.map((p) => {
      // データ出走表の F・L バッジ（FlyingBadge）と同じ値を級別の後ろに書く。
      // F持ちはスタートを控えるので、AI に渡す文面から落とさない（BOA-770 ファン評価）
      const v = toNumber(p.winRate);
      const row = flying.rows?.get(p.number);
      const fCount = row?.f_count > 0 ? row.f_count : 0;
      const lCount = row?.l_count > 0 ? row.l_count : 0;
      const head = [
        p.grade,
        fCount
          ? `F${fCount}${flying.currentMeet.has(p.number) ? `(${t("flyingBadge.currentMeet")})` : ""}`
          : null,
        lCount ? `L${lCount}` : null,
        v !== null ? v.toFixed(2) : null,
      ].filter(Boolean);
      return head.length > 0 ? head.join(" ") : DASH;
    }),
  };
}

export function buildLocalWinRateRow(t, players, ui) {
  const { toNumber } = ui;
  return {
    key: "localWinRate",
    label: t("dataTable.rowLocalWinRate"),
    values: players.map((p) => {
      const v = toNumber(p.localWinRate);
      return v !== null ? v.toFixed(2) : DASH;
    }),
  };
}

export function buildTwoRateRow(t, players, ui) {
  const { toNumber } = ui;
  return {
    key: "twoRate",
    label: t("dataTable.rowTwoRate"),
    values: players.map((p) => {
      const v = toNumber(p.global2Rate);
      return v !== null ? `${v.toFixed(1)}%` : DASH;
    }),
  };
}

// モーター交換直後は全艇motor_2rateが0になり「0.0%」が誤解を招くため、
// raceIndicators.jsxのrowMotorと同じくその場合は全艇「—」にする
export function buildMotorRow(t, players, motorByBoat, ui) {
  const { toNumber } = ui;
  const values = players.map((p) =>
    toNumber(motorByBoat.get(p.number)?.motor_2rate ?? p.motor2Rate),
  );
  const allZero = values.length > 0 && values.every((v) => v === 0);

  return {
    key: "motor",
    label: t("dataTable.rowMotor"),
    values: values.map((v) => {
      if (allZero || v === null) return DASH;
      return `${v.toFixed(1)}%`;
    }),
  };
}

export function buildFormRow(t, players, formByBoat) {
  return {
    key: "form",
    label: t("dataTable.rowForm"),
    values: players.map((p) => {
      const row = formByBoat.get(p.number);
      if (!row || row.delta === null || row.delta === undefined) return DASH;
      const sign = row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : "→";
      return `${sign}${Math.abs(row.delta).toFixed(2)}`;
    }),
  };
}

// データ出走表と同じ2行（raceIndicators.jsx、BOA-815）: 公式は2桁、30走は3桁
export function buildAvgStOfficialRow(t, players, officialStByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "avgSt",
    label: t("dataTable.rowAvgStOfficial"),
    values: players.map((p) => {
      const v = toNumber(officialStByBoat.get(p.number));
      return v !== null ? v.toFixed(2) : DASH;
    }),
  };
}

export function buildAvgSt30Row(t, players, st30ByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "avgSt30",
    label: t("dataTable.rowAvgSt30"),
    values: players.map((p) => {
      const v = toNumber(st30ByBoat.get(p.number));
      return v !== null ? v.toFixed(3) : DASH;
    }),
  };
}

export function buildStRow(t, players, stByBoat) {
  return {
    key: "st",
    label: t("dataTable.rowSt"),
    values: players.map((p) => {
      const row = stByBoat.get(p.number);
      return row && row.sample_count
        ? `±${row.avg_deviation.toFixed(2)}`
        : DASH;
    }),
  };
}

export function buildExhibitionStRow(t, players, stByBoat) {
  return {
    key: "exSt",
    label: t("dataTable.rowExSt"),
    values: players.map((p) => {
      // 展示のフライング・出遅れは公式の表記（F.01 等）で書く（BOA-759）
      const row = stByBoat.get(p.number);
      return (
        formatExhibitionSt(row?.exhibition_st, row?.exhibition_start_flag) ??
        DASH
      );
    }),
  };
}

export function buildExhibitionTimeRow(t, players, exByBoat) {
  return {
    key: "exhibition",
    label: t("dataTable.rowExhibition"),
    values: players.map((p) => {
      const row = exByBoat.get(p.number);
      if (!row) return DASH;
      if (row.exhibition_time !== null && row.exhibition_time !== undefined)
        return row.exhibition_time.toFixed(2);
      if (
        row.avg_exhibition_time !== null &&
        row.avg_exhibition_time !== undefined
      )
        return `(${row.avg_exhibition_time.toFixed(2)})`;
      return DASH;
    }),
  };
}

// 展示進入（スタート展示のコース、直前情報タブの行と同じ値）。前づけで進入が変わると
// 1マークの展開の前提が変わるため入れる。取得開始前のレースでは行ごと出さない（BOA-770 ファン評価）
export function buildExhibitionCourseRow(t, players, maintenanceByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "exhibitionCourse",
    label: t("beforeInfo.rowExhibitionCourse"),
    values: players.map((p) => {
      const row = maintenanceByBoat.get(p.number);
      if (!row) return DASH;
      if (row.is_absent === true) return t("beforeInfo.exhibitionAbsent");
      const course = toNumber(row.exhibition_course);
      if (course === null) return DASH;
      const moved =
        course < p.number
          ? t("beforeInfo.exhibitionCourseMovedIn")
          : course > p.number
            ? t("beforeInfo.exhibitionCourseMovedOut")
            : null;
      const head = t("dataTable.prevResultCourse", { course });
      return moved ? `${head}(${moved})` : head;
    }),
  };
}

export function buildTodayWeightRow(t, players, maintenanceByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "todayWeight",
    label: t("dataTable.rowTodayWeight"),
    values: players.map((p) => {
      const weight = toNumber(maintenanceByBoat.get(p.number)?.today_weight);
      return weight !== null ? `${weight.toFixed(1)}kg` : DASH;
    }),
  };
}

export function buildTiltRow(t, players, maintenanceByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "tilt",
    label: t("dataTable.rowTilt"),
    values: players.map((p) => {
      const tilt = toNumber(maintenanceByBoat.get(p.number)?.tilt);
      if (tilt === null) return DASH;
      return tilt > 0 ? `+${tilt.toFixed(1)}` : tilt.toFixed(1);
    }),
  };
}

export function buildAdjustmentWeightRow(t, players, maintenanceByBoat, ui) {
  const { toNumber } = ui;
  return {
    key: "adjustmentWeight",
    label: t("dataTable.rowAdjustmentWeight"),
    values: players.map((p) => {
      const weight = toNumber(
        maintenanceByBoat.get(p.number)?.adjustment_weight,
      );
      return weight !== null ? `${weight.toFixed(1)}kg` : DASH;
    }),
  };
}

// 部品交換・プロペラ交換（データ出走表の「部品交換」と同じ値、BOA-770 推奨7）
export function buildPartsChangedRow(t, players, maintenanceByBoat, ui) {
  const { translatePartName } = ui;
  return {
    key: "partsChanged",
    label: t("dataTable.rowPartsChanged"),
    values: players.map((p) => {
      const row = maintenanceByBoat.get(p.number);
      if (!row) return DASH;
      const items = [
        ...(row.parts_changed ?? []).map((part) => translatePartName(t, part)),
        ...(row.propeller_change ? [t("analysis.motor.propellerChanged")] : []),
      ];
      return items.length > 0 ? items.join(t("listSeparator")) : DASH;
    }),
  };
}

// データ出走表と同じ読み方にそろえる（prevResult.js、BOA-569 / BOA-610）
function prevResultCell(t, row) {
  if (!row) return DASH;
  const state = meetPrevRunState(row);
  if (state.kind === "firstOfMeet") return t("dataTable.meetFirstRace");
  if (state.kind === "unknown") return DASH;
  const when = meetPrevRunWhenParams(state.raceId);
  if (state.kind === "pending") {
    return when
      ? `${t("dataTable.prevResultPending")} (${t("dataTable.prevResultWhen", when)})`
      : t("dataTable.prevResultPending");
  }
  const head =
    state.kind === "rank"
      ? t("review.finishPosition", { position: state.rank })
      : state.markKey
        ? t(`dataTable.prevMark.${state.markKey}`)
        : state.mark;
  const parts = [head];
  if (state.course !== null)
    parts.push(t("dataTable.prevResultCourse", { course: state.course }));
  if (when) parts.push(`(${t("dataTable.prevResultWhen", when)})`);
  return parts.join(" ");
}

export function buildPrevResultRow(t, players, meetPrevByBoat) {
  return {
    key: "prevResult",
    label: t("dataTable.rowPrevResult"),
    values: players.map((p) => prevResultCell(t, meetPrevByBoat.get(p.number))),
  };
}

export function buildExpectedCourseWinRateRow(t, players, courseByBoat, ui) {
  const { expectedCourseWinRateText } = ui;
  return {
    key: "expectedCourseWinRate",
    label: t("dataTable.rowExpectedCourseWinRate"),
    values: players.map((p) => {
      const cell = expectedCourseWinRateText(t, courseByBoat.get(p.number));
      if (!cell) return DASH;
      return `${cell.rate} (${cell.sub})${cell.warn ? " ⚠" : ""}`;
    }),
  };
}

export function buildTechniqueRow(t, players, techByBoat, ui) {
  const { translateTechnique } = ui;
  return {
    key: "technique",
    label: t("dataTable.rowTechnique"),
    values: players.map((p) => {
      const row = techByBoat.get(p.number);
      if (!row) return DASH;
      if (!row.win_count || row.techniques.length === 0)
        return t("dataTable.noWins");
      const top = row.techniques[0];
      return `${translateTechnique(t, top.technique)}（${t("dataTable.winCount", { n: row.win_count })}）`;
    }),
  };
}

export function buildReturnRateRow(t, players, rateByBoat) {
  return {
    key: "returnRate",
    label: t("dataTable.rowReturnRate"),
    values: players.map((p) => {
      const row = rateByBoat.get(p.number);
      return row && row.sample_count
        ? `${row.win_return_rate.toFixed(0)}%`
        : DASH;
    }),
  };
}
