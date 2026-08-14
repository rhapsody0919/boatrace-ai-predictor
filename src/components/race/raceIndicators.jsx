/**
 * raceIndicators - レース分析指標の共通定義（BOA-168）
 * データ出走表（DataRaceTable）と振り返り（RaceReview）で同じ指標セットを
 * 使うため、行定義（ラベル・値レンダリング・最良艇・強弱シグナル・言語化）を共通化する。
 *
 * signal: その艇のデータが「好走を示唆(strong)/凡走を示唆(weak)/中立(null)」かを
 * レース内順位ベースで機械的に返す。全艇同値の指標は判定不能としてnull
 * （例: モーター交換直後で全艇2連率0%の戸田のようなケース）
 *
 * ロード中の未取得セルはソース別pendingに基づきスケルトン表示する
 * （プログレッシブ表示: 取得できた行から順次値が入る）
 */
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

const byBoat = (rows) => {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row.boat_number, row));
  return map;
};

// レース内順位（competition ranking）。全艇同値ならnull
function rankOf(candidates, boat, dir = "max") {
  const values = candidates.filter(
    (c) => c.value !== null && c.value !== undefined,
  );
  if (values.length === 0) return null;
  const vs = values.map((c) => c.value);
  if (Math.min(...vs) === Math.max(...vs)) return null;
  const target = values.find((c) => c.boat === boat);
  if (!target) return null;
  const better = values.filter((c) =>
    dir === "min" ? c.value < target.value : c.value > target.value,
  ).length;
  return better + 1;
}

function rankSignal(candidates, boat, dir = "max") {
  const rank = rankOf(candidates, boat, dir);
  if (rank === null) return null;
  if (rank <= 2) return "strong";
  if (rank >= 5) return "weak";
  return null;
}

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
 * 指標行の定義を構築する
 * @param {Function} t - i18n
 * @param {Array} players - prediction.allPlayers（枠番順ソート済み）
 * @param {Object} analysis - useRaceAnalysisDataの戻り値
 * @param {Object} pending - ソース別ロード中フラグ（useRaceAnalysisDataのpending）
 */
export function buildIndicatorRows({ t, players, analysis, pending = {} }) {
  const {
    motor,
    racerForm,
    stPredictability,
    exhibitionTime,
    techniqueProfile,
    returnRate,
    racerStats,
    placeOdds,
  } = analysis;

  const motorByBoat = byBoat(motor);
  const formByBoat = byBoat(racerForm);
  const stByBoat = byBoat(stPredictability);
  const exByBoat = byBoat(exhibitionTime);
  const techByBoat = byBoat(techniqueProfile);
  const rateByBoat = byBoat(returnRate);
  const statsByBoat = new Map((racerStats ?? []).map((s) => [s.boatNumber, s]));
  const placeOddsByBoat = byBoat(placeOdds);

  // ソース別プレースホルダ: ロード中はスケルトン、取得済みでデータ無しは「—」
  const ph = (source) =>
    pending[source] ? (
      <span className="drt-skeleton" aria-hidden="true" />
    ) : (
      "—"
    );

  const localizedTechnique = (name) => translateTechnique(t, name);

  // 指標ごとの候補値リスト（signal/best共用）
  const cand = {
    winRate: players.map((p) => ({
      boat: p.number,
      value: toNumber(p.winRate),
    })),
    localWinRate: players.map((p) => ({
      boat: p.number,
      value: toNumber(p.localWinRate),
    })),
    motor: (motor ?? []).map((r) => ({
      boat: r.boat_number,
      value: toNumber(r.motor_2rate),
    })),
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

  const courseRateOf = (boat) => {
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
  };
  cand.courseRate = players.map((p) => ({
    boat: p.number,
    value: courseRateOf(p.number)?.rate ?? null,
  }));

  // 複勝予想（FR1/FR5）: コース別勝率上位2艇。generate-unified-predictions.js の
  // calculatePlaceRecommendation と同じロジック（上位2艇、EV計算は経由しない）
  const placeBoats = [...cand.courseRate]
    .filter((c) => c.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((c) => c.boat);

  return [
    {
      key: "winRate",
      label: t("dataTable.rowWinRate"),
      shortLabel: t("review.cols.winRate"),
      tab: null,
      best: bestOf(cand.winRate),
      signal: (boat) => rankSignal(cand.winRate, boat),
      itemText: (boat) => {
        const rank = rankOf(cand.winRate, boat);
        return rank === null
          ? null
          : t("review.itemRank", { label: t("dataTable.rowWinRate"), rank });
      },
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
      signal: (boat) => rankSignal(cand.localWinRate, boat),
      itemText: (boat) => {
        const rank = rankOf(cand.localWinRate, boat);
        return rank === null
          ? null
          : t("review.itemRank", {
              label: t("dataTable.rowLocalWinRate"),
              rank,
            });
      },
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
      signal: (boat) => rankSignal(cand.motor, boat),
      itemText: (boat) => {
        const rank = rankOf(cand.motor, boat);
        return rank === null
          ? null
          : t("review.itemRank", { label: t("dataTable.rowMotor"), rank });
      },
      render: (p) => {
        const row = motorByBoat.get(p.number);
        const rate = toNumber(row?.motor_2rate ?? p.motor2Rate);
        if (rate === null) return ph("motor");
        // 全艇0%（モーター交換直後で実績なし）は0.0%表示が誤解を招くため「—」
        const values = cand.motor.map((c) => c.value).filter((v) => v !== null);
        const allZero = values.length > 0 && values.every((v) => v === 0);
        if (allZero) return "—";
        return <span className="drt-value">{rate.toFixed(1)}%</span>;
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
      signal: (boat) => {
        const row = formByBoat.get(boat);
        if (!row || row.delta === null || row.delta === undefined) return null;
        if (row.delta > 0) return "strong";
        if (row.delta < 0) return "weak";
        return null;
      },
      itemText: (boat) => {
        const row = formByBoat.get(boat);
        if (!row || row.delta === null || row.delta === undefined) return null;
        if (row.delta > 0)
          return t("review.itemFormUp", { delta: row.delta.toFixed(2) });
        if (row.delta < 0)
          return t("review.itemFormDown", {
            delta: Math.abs(row.delta).toFixed(2),
          });
        return null;
      },
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
      signal: (boat) => rankSignal(cand.avgSt, boat, "min"),
      itemText: (boat) => {
        const rank = rankOf(cand.avgSt, boat, "min");
        return rank === null
          ? null
          : t("review.itemRank", { label: t("dataTable.rowAvgSt"), rank });
      },
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
      signal: (boat) => rankSignal(cand.st, boat, "min"),
      itemText: (boat) => {
        const rank = rankOf(cand.st, boat, "min");
        return rank === null
          ? null
          : t("review.itemRank", { label: t("dataTable.rowSt"), rank });
      },
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
      tab: "st",
      best: bestOf(cand.exSt, "min"),
      signal: (boat) => rankSignal(cand.exSt, boat, "min"),
      itemText: (boat) => {
        const rank = rankOf(cand.exSt, boat, "min");
        return rank === null
          ? null
          : t("review.itemRank", { label: t("dataTable.rowExSt"), rank });
      },
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
      tab: "extrend",
      best: bestOf(cand.exhibition, "min"),
      signal: (boat) => rankSignal(cand.exhibition, boat, "min"),
      itemText: (boat) => {
        const rank = rankOf(cand.exhibition, boat, "min");
        return rank === null
          ? null
          : t("review.itemRank", {
              label: t("dataTable.rowExhibition"),
              rank,
            });
      },
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
      key: "courseRate",
      label: t("dataTable.rowCourseRate"),
      shortLabel: t("review.cols.courseRate"),
      tab: "attackdefense",
      best: bestOf(cand.courseRate),
      signal: (boat) => rankSignal(cand.courseRate, boat),
      itemText: (boat) => {
        const rank = rankOf(cand.courseRate, boat);
        return rank === null
          ? null
          : t("review.itemRank", {
              label: t("dataTable.rowCourseRate"),
              rank,
            });
      },
      render: (p) => {
        const cr = courseRateOf(p.number);
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
      key: "placeRecommendation",
      label: t("dataTable.rowPlaceRecommendation"),
      shortLabel: t("review.cols.placeRecommendation"),
      tab: "attackdefense",
      best: null,
      // 複勝＝上位2着的中（RaceReviewの好走判定は上位3着基準のため流用不可）。
      // RaceReviewでの的中判定は本行のスコープ外（別途top2専用の実装が必要）
      signal: () => null,
      itemText: () => null,
      render: (p) => {
        if (placeBoats.length === 0) return ph("racerStats");
        const rank = placeBoats.indexOf(p.number);
        if (rank === -1) return <span className="drt-sub">—</span>;
        const boatOdds = placeOddsByBoat.get(p.number);
        const oddsLow = toNumber(boatOdds?.odds_place_low);
        const oddsHigh = toNumber(boatOdds?.odds_place_high);
        return (
          <span className="drt-value drt-plus">
            {rank === 0 ? "◎" : "○"}
            <span className="drt-sub">
              {t("dataTable.placeBadgeLabel", { rank: rank + 1 })}
            </span>
            {pending.placeOdds ? (
              <span className="drt-skeleton" aria-hidden="true" />
            ) : oddsLow !== null && oddsHigh !== null ? (
              <span className="drt-sub">
                {t("dataTable.placeOddsLabel", {
                  low: oddsLow.toFixed(1),
                  high: oddsHigh.toFixed(1),
                })}
              </span>
            ) : null}
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
      signal: () => null, // 決まり手型はRaceReview側で勝者の決まり手一致を特別判定する
      itemText: () => null,
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
      signal: (boat) => {
        const row = rateByBoat.get(boat);
        if (!row || !row.sample_count) return null;
        return row.win_return_rate >= 100 ? "strong" : "weak";
      },
      itemText: (boat) => {
        const row = rateByBoat.get(boat);
        if (!row || !row.sample_count) return null;
        return t("review.itemReturn", {
          rate: row.win_return_rate.toFixed(0),
        });
      },
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
