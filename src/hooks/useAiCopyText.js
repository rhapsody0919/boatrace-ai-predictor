/**
 * useAiCopyText - race-ai-copy機能（BOA-194）用フック
 * データ出走表と同じデータソース（useRaceAnalysisData + prediction.allPlayers）から
 * Markdown表＋選択中の分析依頼プロンプトを組み立てて返す。
 * 値の整形はraceIndicators.jsxのbuildIndicatorRowsのrender()と同じロジックを
 * プレーンテキスト向けに書き直したもの（JSXを返すbuildIndicatorRowsはそのまま流用できないため）。
 * 行を作るところまでがこのフックで、文面の組み立て（前提の行・注記・出典など）は
 * 純関数の utils/aiCopyText.js が行う（BOA-770）。
 */
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "./useRaceAnalysisData";
import { useRaceEntryFlyingRows } from "./useRaceEntryFlyingRows";
import { useCurrentMeetFlyingBoats } from "./useCurrentMeetFlyingBoats";
import {
  toNumber,
  wakuRateOf,
  translateTechnique,
  translatePartName,
  isExhibitionCourseOutOfRange,
} from "../components/race/raceIndicators";
import { formatExhibitionSt } from "../utils/formatters";
import { getAiCopyPromptText } from "../utils/aiCopyPrompts";
import { aiCopyPageUrl, buildAiCopyText } from "../utils/aiCopyText";
import { isRaceCancelled } from "../utils/raceCancellation";
import { meetPrevRunState, meetPrevRunWhenParams } from "../utils/prevResult";
import { splitRacerName } from "../utils/racerName";

const DASH = "—";

function byBoat(rows, key = "boat_number") {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row[key], row));
  return map;
}

// モーター交換直後は全艇motor_2rateが0になり「0.0%」が誤解を招くため、
// raceIndicators.jsxのrowMotorと同じくその場合は全艇「—」にする
function buildMotorRow(t, players, motorByBoat) {
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

function buildRows(t, players, analysis, flying, raceId) {
  const motorByBoat = byBoat(analysis.motor);
  const formByBoat = byBoat(analysis.racerForm);
  const stByBoat = byBoat(analysis.stPredictability);
  const exByBoat = byBoat(analysis.exhibitionTime);
  const maintenanceByBoat = byBoat(analysis.motorMaintenance);
  const techByBoat = byBoat(analysis.techniqueProfile);
  const rateByBoat = byBoat(analysis.returnRate);
  const statsByBoat = new Map(
    (analysis.racerStats ?? []).map((s) => [s.boatNumber, s]),
  );
  const meetPrevByBoat = byBoat(analysis.meetPrevRun);

  return [
    {
      key: "name",
      label: t("aiCopy.playerNameLabel"),
      values: players.map((p) => p.name ?? DASH),
    },
    {
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
    },
    {
      key: "localWinRate",
      label: t("dataTable.rowLocalWinRate"),
      values: players.map((p) => {
        const v = toNumber(p.localWinRate);
        return v !== null ? v.toFixed(2) : DASH;
      }),
    },
    {
      key: "twoRate",
      label: t("dataTable.rowTwoRate"),
      values: players.map((p) => {
        const v = toNumber(p.global2Rate);
        return v !== null ? `${v.toFixed(1)}%` : DASH;
      }),
    },
    buildMotorRow(t, players, motorByBoat),
    {
      key: "form",
      label: t("dataTable.rowForm"),
      values: players.map((p) => {
        const row = formByBoat.get(p.number);
        if (!row || row.delta === null || row.delta === undefined) return DASH;
        const sign = row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : "→";
        return `${sign}${Math.abs(row.delta).toFixed(2)}`;
      }),
    },
    {
      key: "avgSt",
      label: t("dataTable.rowAvgSt"),
      values: players.map((p) => {
        // データ出走表と同じ小数3桁（raceIndicators.jsx の平均ST行）
        const v = toNumber(statsByBoat.get(p.number)?.avgST);
        return v !== null ? v.toFixed(3) : DASH;
      }),
    },
    {
      key: "st",
      label: t("dataTable.rowSt"),
      values: players.map((p) => {
        const row = stByBoat.get(p.number);
        return row && row.sample_count
          ? `±${row.avg_deviation.toFixed(2)}`
          : DASH;
      }),
    },
    {
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
    },
    {
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
    },
    // 展示進入（スタート展示のコース、直前情報タブの行と同じ値）。前づけで進入が変わると
    // 1マークの展開の前提が変わるため入れる。取得開始前のレースでは行ごと出さない（BOA-770 ファン評価）
    ...(isExhibitionCourseOutOfRange(raceId, analysis.motorMaintenance)
      ? []
      : [
          {
            key: "exhibitionCourse",
            label: t("beforeInfo.rowExhibitionCourse"),
            values: players.map((p) => {
              const row = maintenanceByBoat.get(p.number);
              if (!row) return DASH;
              if (row.is_absent === true)
                return t("beforeInfo.exhibitionAbsent");
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
          },
        ]),
    {
      key: "todayWeight",
      label: t("dataTable.rowTodayWeight"),
      values: players.map((p) => {
        const weight = toNumber(maintenanceByBoat.get(p.number)?.today_weight);
        return weight !== null ? `${weight.toFixed(1)}kg` : DASH;
      }),
    },
    {
      key: "tilt",
      label: t("dataTable.rowTilt"),
      values: players.map((p) => {
        const tilt = toNumber(maintenanceByBoat.get(p.number)?.tilt);
        if (tilt === null) return DASH;
        return tilt > 0 ? `+${tilt.toFixed(1)}` : tilt.toFixed(1);
      }),
    },
    {
      key: "adjustmentWeight",
      label: t("dataTable.rowAdjustmentWeight"),
      values: players.map((p) => {
        const weight = toNumber(
          maintenanceByBoat.get(p.number)?.adjustment_weight,
        );
        return weight !== null ? `${weight.toFixed(1)}kg` : DASH;
      }),
    },
    {
      // 部品交換・プロペラ交換（データ出走表の「部品交換」と同じ値、BOA-770 推奨7）
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
    },
    {
      key: "prevResult",
      label: t("dataTable.rowPrevResult"),
      values: players.map((p) => {
        // データ出走表と同じ読み方にそろえる（prevResult.js、BOA-569 / BOA-610）
        const row = meetPrevByBoat.get(p.number);
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
      }),
    },
    {
      key: "courseRate",
      label: t("dataTable.rowCourseRate"),
      values: players.map((p) => {
        const cr = wakuRateOf(statsByBoat, p.number);
        return cr ? `${cr.rate.toFixed(0)}% (${cr.wins}/${cr.total})` : DASH;
      }),
    },
    {
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
    },
    {
      key: "returnRate",
      label: t("dataTable.rowReturnRate"),
      values: players.map((p) => {
        const row = rateByBoat.get(p.number);
        return row && row.sample_count
          ? `${row.win_return_rate.toFixed(0)}%`
          : DASH;
      }),
    },
  ];
}

// 展示タイム・展示STのどれかが出ていれば「展示後」とみなす。
// どちらかの取得に失敗したときは分からないので null（「未反映」の行を出さない。取得失敗を
// 展示前と言い切らないため）
function isExhibitionPublished(analysis) {
  const hasValue = (v) => v !== null && v !== undefined;
  const published =
    (analysis.exhibitionTime ?? []).some((r) => hasValue(r.exhibition_time)) ||
    (analysis.stPredictability ?? []).some((r) => hasValue(r.exhibition_st));
  if (published) return true;
  if (analysis.failed?.exhibitionTime || analysis.failed?.stPredictability)
    return null;
  return false;
}

export function useAiCopyText({ raceId, prediction, race, venueCode }) {
  const { t, i18n } = useTranslation();
  // venueCodeを渡さないとDataRaceTable側のuseRaceAnalysisData呼び出しと
  // キャッシュキー・in-flightデデュープが分岐し、同じレースのモーター内訳を
  // 二重に取得してしまう（BOA-265でDataRaceTable側にvenueCodeを追加した際に発覚）
  const analysis = useRaceAnalysisData(raceId, { venueCode });
  const flyingRows = useRaceEntryFlyingRows(raceId);
  const currentMeetFlying = useCurrentMeetFlyingBoats(raceId);

  // 公式の全角空白の桁揃え（全角空白の連続）は外し、姓と名を半角空白1つで区切る。
  // 表と展開予測の両方で同じ名前にするため、ここで1回だけ整える
  const players = [...(prediction?.allPlayers ?? [])]
    .sort((a, b) => a.number - b.number)
    .map((p) => (p.name ? { ...p, name: splitRacerName(p.name).join(" ") } : p));

  const buildText = (promptType) => {
    if (players.length === 0) return "";
    const lang = i18n.resolvedLanguage;
    const raw = race?.rawData ?? {};
    // 会場名はvenues.*i18nキー経由で翻訳する（他箇所と同じ既存パターン。
    // race?.venueは日本語の生値のため、非ja言語では直接使えない）
    const venueLabel = venueCode
      ? t(`venues.${venueCode}`, race?.venue ?? "")
      : (race?.venue ?? "");

    return buildAiCopyText({
      t,
      heading: t("aiCopy.markdownHeading", {
        venue: venueLabel,
        race: race?.raceNumber ?? "",
      }),
      context: {
        date: (raceId ?? "").slice(0, 10),
        startTime: race?.startTime || null,
        raceGrade: prediction?.raceGrade ?? raw.raceGrade ?? null,
        seriesTitle: race?.seriesTitle ?? null,
        seriesDayLabel: race?.seriesDayLabel ?? null,
        raceStage: prediction?.raceStage ?? raw.raceStage ?? null,
        weather: prediction?.weather ?? raw.weather ?? null,
      },
      players,
      rows: buildRows(
        t,
        players,
        analysis,
        { rows: flyingRows, currentMeet: currentMeetFlying },
        raceId,
      ),
      turnPrediction: prediction?.turnPrediction,
      prompt: getAiCopyPromptText(t, promptType),
      pageUrl: aiCopyPageUrl(raceId, lang),
      now: new Date(),
      exhibitionPublished: isExhibitionPublished(analysis),
    });
  };

  // analysisは複数クエリの並列取得（30分TTLキャッシュ）で、DataRaceTableと
  // 同じソースを共有する。読み込み未完了のままコピーすると本来値が有る行まで
  // 「—」として出力されうるため、読み込み完了までボタン自体を出さない。
  // 中止確定のレースは分析する対象が無いので出さない（BOA-424。呼び出し側の
  // PredictionPanel でも隠しているが、別の画面から使われたときの保険）
  return {
    buildText,
    isReady:
      players.length > 0 && !analysis.loading && !isRaceCancelled(prediction),
  };
}
