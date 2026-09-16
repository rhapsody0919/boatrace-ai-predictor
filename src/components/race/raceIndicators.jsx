/**
 * raceIndicators - レース分析指標の共通定義（BOA-168）
 * データ出走表（DataRaceTable）の行定義（ラベル・値レンダリング・最良艇）を集約する
 *
 * ロード中の未取得セルはソース別pendingに基づきスケルトン表示する
 * （プログレッシブ表示: 取得できた行から順次値が入る）
 */
import { Link } from "react-router-dom";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";

export const TECHNIQUE_KEY_BY_NAME = Object.fromEntries(
  Object.entries(TECHNIQUE_NAMES).map(([key, name]) => [name, key]),
);

// 決まり手（DB値・日本語）を表示用に翻訳する。未知の値はそのまま返す
export const translateTechnique = (t, name) => {
  const key = TECHNIQUE_KEY_BY_NAME[name];
  return key ? t(`techniques.${key}`, name) : name;
};

export const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

// 艇の枠番別勝率（枠番での1着数/出走数）。racerStatsから算出する
// 注: race_results.course_1〜6は艇番と常に一致しており、実際の進入変化
// （前づけ）を区別できていない既知の制約がある（BOA-257）。表示ラベルは
// 「枠番」に統一しているが、内部の変数名・関数名はcourse系のまま残している
export function courseRateOf(statsByBoat, boat) {
  const stats = statsByBoat.get(boat);
  if (!stats) return null;
  const course = stats.course ?? boat;
  const counts = stats.courseRaceCounts?.[String(course)];
  if (!counts || !counts.total) return null;
  return {
    wins: counts.wins ?? 0,
    total: counts.total,
    rate: ((counts.wins ?? 0) / counts.total) * 100,
  };
}

const byBoat = (rows) => {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row.boat_number, row));
  return map;
};

function bestOf(candidates, dir = "max") {
  const values = candidates.filter(
    (c) => c.value !== null && c.value !== undefined,
  );
  if (values.length === 0) return null;
  const vs = values.map((c) => c.value);
  if (Math.min(...vs) === Math.max(...vs)) return null;
  const best = values.reduce((a, b) => {
    if (dir === "min") return b.value < a.value ? b : a;
    return b.value > a.value ? b : a;
  });
  return best.boat;
}

/**
 * 指標行の定義を構築する（内部関数、buildIndicatorRows/buildBeforeInfoRowsの共通実装）
 * 各行にcategoryを付与し、DataRaceTable（category: "basic"、デフォルト）と
 * RaceBeforeInfoTab（category: "beforeInfo"）で同じ定義・同じレンダリング
 * ロジックを共有しつつ表示先を分ける（BOA-304）
 * @param {Function} t - i18n
 * @param {Array} players - prediction.allPlayers（枠番順ソート済み）
 * @param {Object} analysis - useRaceAnalysisDataの戻り値
 * @param {Object} pending - ソース別ロード中フラグ（useRaceAnalysisDataのpending）
 */
function buildRowDefs({
  t,
  players,
  analysis,
  pending = {},
  motorDeepLink = null,
}) {
  const {
    motor,
    racerForm,
    stPredictability,
    exhibitionTime,
    motorMaintenance,
    techniqueProfile,
    returnRate,
    racerStats,
  } = analysis;

  const motorByBoat = byBoat(motor);
  const formByBoat = byBoat(racerForm);
  const stByBoat = byBoat(stPredictability);
  const exByBoat = byBoat(exhibitionTime);
  const maintenanceByBoat = byBoat(motorMaintenance);
  const techByBoat = byBoat(techniqueProfile);
  const rateByBoat = byBoat(returnRate);
  const statsByBoat = new Map((racerStats ?? []).map((s) => [s.boatNumber, s]));

  // ソース別プレースホルダ: ロード中はスケルトン、取得済みでデータ無しは「—」
  const ph = (source) =>
    pending[source] ? (
      <span className="drt-skeleton" aria-hidden="true" />
    ) : (
      "—"
    );

  const localizedTechnique = (name) => translateTechnique(t, name);

  // 指標ごとの候補値リスト（best共用）
  const cand = {
    winRate: players.map((p) => ({
      boat: p.number,
      value: toNumber(p.winRate),
    })),
    localWinRate: players.map((p) => ({
      boat: p.number,
      value: toNumber(p.localWinRate),
    })),
    twoRate: players.map((p) => ({
      boat: p.number,
      value: toNumber(p.global2Rate),
    })),
    // 詳細分析データ(analysis.motor)が無い場合はentries(players)のmotor2Rateに
    // フォールバックする（一覧カードでの常時表示など、analysisを取得しない文脈でも
    // 最良艇ハイライトが機能するようにするため）
    motor: players.map((p) => {
      const row = motorByBoat.get(p.number);
      return {
        boat: p.number,
        value: toNumber(row?.motor_2rate ?? p.motor2Rate),
      };
    }),
    avgSt: (racerStats ?? []).map((s) => ({
      boat: s.boatNumber,
      value: toNumber(s.avgST),
    })),
    st: (stPredictability ?? []).map((r) => ({
      boat: r.boat_number,
      value: r.sample_count > 0 ? toNumber(r.avg_deviation) : null,
    })),
    exSt: (stPredictability ?? []).map((r) => ({
      boat: r.boat_number,
      value: toNumber(r.exhibition_st),
    })),
    exhibition: (exhibitionTime ?? []).map((r) => ({
      boat: r.boat_number,
      value: toNumber(r.exhibition_time),
    })),
    returnRate: (returnRate ?? []).map((r) => ({
      boat: r.boat_number,
      value: r.sample_count > 0 ? toNumber(r.win_return_rate) : null,
    })),
  };

  cand.courseRate = players.map((p) => ({
    boat: p.number,
    value: courseRateOf(statsByBoat, p.number)?.rate ?? null,
  }));

  return [
    {
      key: "winRate",
      label: t("dataTable.rowWinRate"),
      shortLabel: t("review.cols.winRate"),
      tab: null,
      best: bestOf(cand.winRate),
      render: (p) => (
        <span className="drt-value">
          <span className="drt-grade">{p.grade}</span>
          {toNumber(p.winRate)?.toFixed(2) ?? "—"}
        </span>
      ),
    },
    {
      key: "localWinRate",
      label: t("dataTable.rowLocalWinRate"),
      shortLabel: t("review.cols.localWinRate"),
      tab: "racecard",
      best: bestOf(cand.localWinRate),
      render: (p) => {
        const rate = toNumber(p.localWinRate);
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(2)}</span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "twoRate",
      label: t("dataTable.rowTwoRate"),
      shortLabel: t("review.cols.twoRate"),
      tab: "racecard",
      best: bestOf(cand.twoRate),
      render: (p) => {
        const rate = toNumber(p.global2Rate);
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(1)}%</span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "motor",
      label: t("dataTable.rowMotor"),
      shortLabel: t("review.cols.motor"),
      // モーター交換直後（全艇2連率0%）は理由をラベル横に注記する
      note: (() => {
        const values = cand.motor.map((c) => c.value).filter((v) => v !== null);
        return values.length > 0 && values.every((v) => v === 0)
          ? t("dataTable.motorResetNote")
          : null;
      })(),
      tab: "motor",
      best: bestOf(cand.motor),
      render: (p) => {
        const row = motorByBoat.get(p.number);
        const rate = toNumber(row?.motor_2rate ?? p.motor2Rate);
        if (rate === null) return ph("motor");
        // 全艇0%（モーター交換直後で実績なし）は0.0%表示が誤解を招くため「—」
        const values = cand.motor.map((c) => c.value).filter((v) => v !== null);
        const allZero = values.length > 0 && values.every((v) => v === 0);
        if (allZero) return "—";
        const powerIndex = toNumber(row?.power_index);
        return (
          <span className="drt-value">
            {rate.toFixed(1)}%
            {motorDeepLink && powerIndex !== null && powerIndex !== 0 && (
              <Link
                to={motorDeepLink(row.motor_number)}
                className={`drt-motor-badge ${
                  powerIndex > 0 ? "drt-motor-badge-up" : "drt-motor-badge-down"
                }`}
              >
                {powerIndex > 0
                  ? t("dataTable.motorBadgeUp")
                  : t("dataTable.motorBadgeDown")}
              </Link>
            )}
          </span>
        );
      },
    },
    {
      key: "form",
      label: t("dataTable.rowForm"),
      shortLabel: t("review.cols.form"),
      tab: "racer",
      best: bestOf(
        (racerForm ?? []).map((r) => ({ boat: r.boat_number, value: r.delta })),
      ),
      render: (p) => {
        const row = formByBoat.get(p.number);
        if (!row || row.delta === null || row.delta === undefined)
          return ph("racerForm");
        const up = row.delta > 0;
        const flat = row.delta === 0;
        return (
          <span
            className={`drt-value ${up ? "drt-up" : flat ? "" : "drt-down"}`}
          >
            {up ? "↑" : flat ? "→" : "↓"}
            {Math.abs(row.delta).toFixed(2)}
          </span>
        );
      },
    },
    {
      key: "avgSt",
      label: t("dataTable.rowAvgSt"),
      shortLabel: t("review.cols.avgSt"),
      tab: "racecard",
      best: bestOf(cand.avgSt, "min"),
      render: (p) => {
        const rate = toNumber(statsByBoat.get(p.number)?.avgST);
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(2)}</span>
        ) : (
          ph("racerStats")
        );
      },
    },
    {
      key: "st",
      label: t("dataTable.rowSt"),
      shortLabel: t("review.cols.st"),
      tab: "st",
      best: bestOf(cand.st, "min"),
      render: (p) => {
        const row = stByBoat.get(p.number);
        if (!row || !row.sample_count) return ph("stPredictability");
        return (
          <span className="drt-value">±{row.avg_deviation.toFixed(2)}</span>
        );
      },
    },
    {
      key: "exSt",
      label: t("dataTable.rowExSt"),
      shortLabel: t("review.cols.exSt"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: "st",
      best: bestOf(cand.exSt, "min"),
      render: (p) => {
        const rate = toNumber(stByBoat.get(p.number)?.exhibition_st);
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(2)}</span>
        ) : (
          ph("stPredictability")
        );
      },
    },
    {
      key: "exhibition",
      label: t("dataTable.rowExhibition"),
      shortLabel: t("review.cols.exhibition"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: "extrend",
      best: bestOf(cand.exhibition, "min"),
      render: (p) => {
        const row = exByBoat.get(p.number);
        if (!row) return ph("exhibitionTime");
        if (row.exhibition_time !== null && row.exhibition_time !== undefined) {
          return (
            <span className="drt-value">{row.exhibition_time.toFixed(2)}</span>
          );
        }
        if (
          row.avg_exhibition_time !== null &&
          row.avg_exhibition_time !== undefined
        ) {
          return (
            <span className="drt-value drt-sub">
              ({row.avg_exhibition_time.toFixed(2)})
            </span>
          );
        }
        return "—";
      },
    },
    {
      // 当日体重は計量時点の実測値であり、値の高低が好走/凡走を示唆する指標では
      // ないため、他行と違いbestは持たせない（BOA-289、tilt/adjustmentWeightと同じ扱い）
      key: "todayWeight",
      label: t("dataTable.rowTodayWeight"),
      shortLabel: t("review.cols.todayWeight"),
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const weight = toNumber(row.today_weight);
        return weight !== null ? (
          <span className="drt-value">{weight.toFixed(1)}kg</span>
        ) : (
          "—"
        );
      },
    },
    {
      // チルト・調整重量は選手が選んだ「設定値」であり、値の高低が好走/凡走を
      // 示唆する指標ではないため、他行と違いbestは持たせない（BOA-221）
      key: "tilt",
      label: t("dataTable.rowTilt"),
      shortLabel: t("review.cols.tilt"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const tilt = toNumber(row.tilt);
        if (tilt === null) return "—";
        return (
          <span className="drt-value">
            {tilt > 0 ? `+${tilt.toFixed(1)}` : tilt.toFixed(1)}
          </span>
        );
      },
    },
    {
      key: "adjustmentWeight",
      label: t("dataTable.rowAdjustmentWeight"),
      shortLabel: t("review.cols.adjustmentWeight"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const weight = toNumber(row.adjustment_weight);
        return weight !== null ? (
          <span className="drt-value">{weight.toFixed(1)}kg</span>
        ) : (
          "—"
        );
      },
    },
    {
      // 部品交換・プロペラ交換（当該レースの展示時点、BOA-221の列を流用）。
      // モーター調子ドリルダウン（BOA-221）の「交換履歴」とは異なり、
      // 今回のレース1回分の交換有無のみを示す。値の高低が好走/凡走を
      // 示唆する指標ではないため、他行と違いbestは持たせない
      key: "partsChanged",
      label: t("dataTable.rowPartsChanged"),
      shortLabel: t("review.cols.partsChanged"),
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const parts = row.parts_changed ?? null;
        const propellerChanged = !!row.propeller_change;
        if ((!parts || parts.length === 0) && !propellerChanged) return "—";
        return (
          <span className="drt-value drt-parts-changed">
            {parts && parts.length > 0 && (
              <span className="drt-badge">{parts.join("・")}</span>
            )}
            {propellerChanged && (
              <span className="drt-badge">
                {t("analysis.motor.propellerChanged")}
              </span>
            )}
          </span>
        );
      },
    },
    {
      // 前走成績（今節内の直近レースの着順・進入コース）は事実の記録であり、
      // bestは持たせない（BOA-289、tilt/adjustmentWeightと同じ扱い）
      key: "prevResult",
      label: t("dataTable.rowPrevResult"),
      shortLabel: t("review.cols.prevResult"),
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const rank = toNumber(row.prev_finish_rank);
        if (rank === null) {
          return (
            <span className="drt-sub">{t("dataTable.prevResultNoRace")}</span>
          );
        }
        const course = toNumber(row.prev_entry_course);
        return (
          <span className="drt-value">
            {t("review.finishPosition", { position: rank })}
            {course !== null && (
              <span className="drt-sub">
                {" "}
                {t("dataTable.prevResultCourse", { course })}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "courseRate",
      label: t("dataTable.rowCourseRate"),
      shortLabel: t("review.cols.courseRate"),
      tab: "attackdefense",
      best: bestOf(cand.courseRate),
      render: (p) => {
        const cr = courseRateOf(statsByBoat, p.number);
        if (!cr) return ph("racerStats");
        return (
          <span className="drt-value">
            {cr.rate.toFixed(0)}%
            <span className="drt-sub">
              {cr.wins}/{cr.total}
            </span>
          </span>
        );
      },
    },
    {
      key: "technique",
      label: t("dataTable.rowTechnique"),
      shortLabel: t("review.cols.technique"),
      tab: "techprofile",
      best: null,
      render: (p) => {
        const row = techByBoat.get(p.number);
        if (!row) return ph("techniqueProfile");
        if (!row.win_count || row.techniques.length === 0)
          return <span className="drt-sub">{t("dataTable.noWins")}</span>;
        const top = row.techniques[0];
        return (
          <span className="drt-value drt-technique">
            {localizedTechnique(top.technique)}
            <span className="drt-sub">
              {t("dataTable.winCount", { n: row.win_count })}
            </span>
          </span>
        );
      },
    },
    {
      key: "returnRate",
      label: t("dataTable.rowReturnRate"),
      shortLabel: t("review.cols.returnRate"),
      tab: "returnrate",
      best: bestOf(cand.returnRate),
      render: (p) => {
        const row = rateByBoat.get(p.number);
        if (!row || !row.sample_count) return ph("returnRate");
        return (
          <span
            className={`drt-value ${row.win_return_rate >= 100 ? "drt-plus" : ""}`}
          >
            {row.win_return_rate.toFixed(0)}%
          </span>
        );
      },
    },
  ];
}

// 全指標（従来通りの挙動、後方互換のため名前は維持）。RaceCardDataTable
// （開催場一覧ページのカード内出走表）が引き続き全指標をまとめて表示するために使う
export function buildIndicatorRows(args) {
  return buildRowDefs(args);
}

// データ出走表（基本情報、DataRaceTable）向け: 直前情報系
// （category: "beforeInfo"）を除いた行（BOA-304）
export function buildBasicIndicatorRows(args) {
  return buildRowDefs(args).filter((row) => row.category !== "beforeInfo");
}

// 直前情報タブ（RaceBeforeInfoTab）向け: 展示ST・展示タイム・チルト・
// 調整重量・部品交換の5行のみ（BOA-304）
export function buildBeforeInfoRows(args) {
  return buildRowDefs(args).filter((row) => row.category === "beforeInfo");
}
