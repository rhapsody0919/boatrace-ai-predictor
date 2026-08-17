/**
 * useAiCopyText - race-ai-copy機能（BOA-194）用フック
 * データ出走表と同じデータソース（useRaceAnalysisData + prediction.allPlayers）から
 * Markdown表＋選択中の分析依頼プロンプトを組み立てて返す。
 * 値の整形はraceIndicators.jsxのbuildIndicatorRowsのrender()と同じロジックを
 * プレーンテキスト向けに書き直したもの（JSXを返すbuildIndicatorRowsはそのまま流用できないため）。
 */
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "./useRaceAnalysisData";
import {
  toNumber,
  courseRateOf,
  translateTechnique,
} from "../components/race/raceIndicators";
import { getAiCopyPromptText } from "../utils/aiCopyPrompts";

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
    label: t("dataTable.rowMotor"),
    values: values.map((v) => {
      if (allZero || v === null) return DASH;
      return `${v.toFixed(1)}%`;
    }),
  };
}

function buildRows(t, players, analysis) {
  const motorByBoat = byBoat(analysis.motor);
  const formByBoat = byBoat(analysis.racerForm);
  const stByBoat = byBoat(analysis.stPredictability);
  const exByBoat = byBoat(analysis.exhibitionTime);
  const techByBoat = byBoat(analysis.techniqueProfile);
  const rateByBoat = byBoat(analysis.returnRate);
  const statsByBoat = new Map(
    (analysis.racerStats ?? []).map((s) => [s.boatNumber, s]),
  );

  return [
    {
      label: t("aiCopy.playerNameLabel"),
      values: players.map((p) => p.name ?? DASH),
    },
    {
      label: t("dataTable.rowWinRate"),
      values: players.map((p) => {
        const v = toNumber(p.winRate);
        if (v === null) return DASH;
        return p.grade ? `${p.grade} ${v.toFixed(2)}` : v.toFixed(2);
      }),
    },
    {
      label: t("dataTable.rowLocalWinRate"),
      values: players.map((p) => {
        const v = toNumber(p.localWinRate);
        return v !== null ? v.toFixed(2) : DASH;
      }),
    },
    buildMotorRow(t, players, motorByBoat),
    {
      label: t("dataTable.rowForm"),
      values: players.map((p) => {
        const row = formByBoat.get(p.number);
        if (!row || row.delta === null || row.delta === undefined) return DASH;
        const sign = row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : "→";
        return `${sign}${Math.abs(row.delta).toFixed(2)}`;
      }),
    },
    {
      label: t("dataTable.rowAvgSt"),
      values: players.map((p) => {
        const v = toNumber(statsByBoat.get(p.number)?.avgST);
        return v !== null ? v.toFixed(2) : DASH;
      }),
    },
    {
      label: t("dataTable.rowSt"),
      values: players.map((p) => {
        const row = stByBoat.get(p.number);
        return row && row.sample_count
          ? `±${row.avg_deviation.toFixed(2)}`
          : DASH;
      }),
    },
    {
      label: t("dataTable.rowExSt"),
      values: players.map((p) => {
        const v = toNumber(stByBoat.get(p.number)?.exhibition_st);
        return v !== null ? v.toFixed(2) : DASH;
      }),
    },
    {
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
    {
      label: t("dataTable.rowCourseRate"),
      values: players.map((p) => {
        const cr = courseRateOf(statsByBoat, p.number);
        return cr ? `${cr.rate.toFixed(0)}% (${cr.wins}/${cr.total})` : DASH;
      }),
    },
    {
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

function toMarkdownTable(t, players, rows) {
  const header = [
    t("aiCopy.tableItemHeader"),
    ...players.map((p) => t("analysis.boatN", { n: p.number })),
  ];
  const separator = header.map(() => "---");
  const lines = rows.map((row) => [row.label, ...row.values]);

  const toLine = (cells) => `| ${cells.join(" | ")} |`;

  return [toLine(header), toLine(separator), ...lines.map(toLine)].join("\n");
}

export function useAiCopyText({ raceId, prediction, race, venueCode }) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId);

  const players = [...(prediction?.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  const buildText = (promptType) => {
    if (players.length === 0) return "";

    const rows = buildRows(t, players, analysis);
    const table = toMarkdownTable(t, players, rows);
    // 会場名はvenues.*i18nキー経由で翻訳する（他箇所と同じ既存パターン。
    // race?.venueは日本語の生値のため、非ja言語では直接使えない）
    const venueLabel = venueCode
      ? t(`venues.${venueCode}`, race?.venue ?? "")
      : (race?.venue ?? "");
    const heading = t("aiCopy.markdownHeading", {
      venue: venueLabel,
      race: race?.raceNumber ?? "",
    });
    const prompt = getAiCopyPromptText(t, promptType);

    return `## ${heading}\n\n${table}\n\n${prompt}`;
  };

  // analysisは複数クエリの並列取得（30分TTLキャッシュ）で、DataRaceTableと
  // 同じソースを共有する。読み込み未完了のままコピーすると本来値が有る行まで
  // 「—」として出力されうるため、読み込み完了までボタン自体を出さない
  return { buildText, isReady: players.length > 0 && !analysis.loading };
}
