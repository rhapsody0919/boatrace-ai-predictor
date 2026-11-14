/**
 * raceIndicators の行定義（基本の指標）と、行定義の共通の文脈（buildRowContext）。
 * buildRowDefs が各 build*Rows を順に並べる
 */
import { Link } from "react-router-dom";
import { bestOf } from "../../utils/bestOf";
import { isUnusedMotor, motorUsageCount } from "../../utils/motorUsage";
import {
  byBoat,
  toNumber,
  translateTechnique,
  wakuRateOf,
} from "./raceIndicatorsHelpers";

export function buildRowContext({
  t,
  players,
  analysis,
  pending = {},
  motorDeepLink = null,
  entryWeights = null,
  gradeBadge = null,
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
    meetPrevRun,
    officialAvgSt,
    st30,
  } = analysis;

  const motorByBoat = byBoat(motor);
  const formByBoat = byBoat(racerForm);
  const stByBoat = byBoat(stPredictability);
  const exByBoat = byBoat(exhibitionTime);
  const maintenanceByBoat = byBoat(motorMaintenance);
  const techByBoat = byBoat(techniqueProfile);
  const rateByBoat = byBoat(returnRate);
  const statsByBoat = new Map((racerStats ?? []).map((s) => [s.boatNumber, s]));
  const meetPrevByBoat = byBoat(meetPrevRun);
  // 平均ST の2行（BOA-815）。公式は公式の出走表と同じ期、30走は v16 の st_mean30
  const officialStByBoat = new Map(
    (officialAvgSt?.rows ?? []).map((r) => [r.boatNumber, r.avgSt]),
  );
  const st30ByBoat = new Map((st30 ?? []).map((r) => [r.boatNumber, r.st30]));
  const officialPeriod = officialAvgSt?.period ?? null;

  // ソース別プレースホルダ: ロード中はスケルトン、取得済みでデータ無しは「—」
  const ph = (source) =>
    pending[source] ? (
      <span className="drt-skeleton" aria-hidden="true" />
    ) : (
      "—"
    );

  const localizedTechnique = (name) => translateTechnique(t, name);

  const c = {
    t,
    ph,
    localizedTechnique,
    motorDeepLink,
    entryWeights,
    gradeBadge,
    racerForm,
    motorByBoat,
    formByBoat,
    stByBoat,
    exByBoat,
    maintenanceByBoat,
    techByBoat,
    rateByBoat,
    statsByBoat,
    meetPrevByBoat,
    officialStByBoat,
    st30ByBoat,
    officialPeriod,
  };
  c.cand = buildCandidates(players, c, analysis);
  return c;
}

// 指標ごとの候補値リスト（best共用）
function buildCandidates(players, c, analysis) {
  const { stPredictability, exhibitionTime, returnRate } = analysis;
  const { motorByBoat, officialStByBoat, st30ByBoat, statsByBoat } = c;
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
    avgSt: players.map((p) => ({
      boat: p.number,
      value: toNumber(officialStByBoat.get(p.number)),
    })),
    avgSt30: players.map((p) => ({
      boat: p.number,
      value: toNumber(st30ByBoat.get(p.number)),
    })),
    st: (stPredictability ?? []).map((r) => ({
      boat: r.boat_number,
      value: r.sample_count > 0 ? toNumber(r.avg_deviation) : null,
    })),
    // 展示でフライング・出遅れした艇（F.01 等）は最良の候補から外す。値は印を外した正の数で、
    // そのままだと F の艇が一番早く見えて金枠が付いた（BOA-759）
    exSt: (stPredictability ?? []).map((r) => ({
      boat: r.boat_number,
      value: r.exhibition_start_flag ? null : toNumber(r.exhibition_st),
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
    value: wakuRateOf(statsByBoat, p.number)?.rate ?? null,
  }));
  return cand;
}

export function buildBasicRatioRows(c) {
  const { t, cand, gradeBadge } = c;
  return [
    {
      key: "winRate",
      label: t("dataTable.rowWinRate"),
      shortLabel: t("review.cols.winRate"),
      tab: null,
      best: bestOf(cand.winRate, "max", { digits: 2 }),
      render: (p) => (
        <span className="drt-value">
          <span className="drt-grade">
            {p.grade}
            {gradeBadge?.(p)}
          </span>
          {toNumber(p.winRate)?.toFixed(2) ?? "—"}
        </span>
      ),
    },
    {
      key: "localWinRate",
      label: t("dataTable.rowLocalWinRate"),
      shortLabel: t("review.cols.localWinRate"),
      tab: "racecard",
      best: bestOf(cand.localWinRate, "max", { digits: 2 }),
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
      best: bestOf(cand.twoRate, "max", { digits: 1 }),
      render: (p) => {
        const rate = toNumber(p.global2Rate);
        return rate !== null ? (
          <span className="drt-value">
            <span>
              {rate.toFixed(1)}
              <span className="drt-unit">%</span>
            </span>
          </span>
        ) : (
          "—"
        );
      },
    },
  ];
}

export function buildMotorRow(c) {
  const { t, ph, cand, motorByBoat, motorDeepLink } = c;
  return [
    {
      key: "motor",
      label: t("dataTable.rowMotor"),
      shortLabel: t("review.cols.motor"),
      // 未使用の新モーター（2連率0・使用回数0）があれば、その「—」の意味を注記する（BOA-702）。
      // 使用回数が分からず全艇0%（モーター交換直後）のときは、従来どおり「交換直後」
      note: (() => {
        const unused = cand.motor.some((c) =>
          isUnusedMotor(c.value, motorByBoat.get(c.boat)),
        );
        if (unused) return t("dataTable.motorUnusedNote");
        const values = cand.motor.map((c) => c.value).filter((v) => v !== null);
        return values.length > 0 && values.every((v) => v === 0)
          ? t("dataTable.motorResetNote")
          : null;
      })(),
      tab: "motor",
      best: bestOf(cand.motor, "max", { digits: 1 }),
      render: (p) => {
        const row = motorByBoat.get(p.number);
        const rate = toNumber(row?.motor_2rate ?? p.motor2Rate);
        if (rate === null) return ph("motor");
        // 一度も使われていない新モーター（2連率0・使用回数0）は、0.0% だと「2着以内0回」と読まれるため「—」（BOA-702）。
        // 使用回数が1以上なら本物の0%なので 0.0% のまま
        if (isUnusedMotor(rate, row)) return "—";
        // 使用回数が分からず全艇0%（モーター交換直後で実績なし）も「—」（従来の扱い）
        const values = cand.motor.map((c) => c.value).filter((v) => v !== null);
        const allZero = values.length > 0 && values.every((v) => v === 0);
        if (allZero && motorUsageCount(row) === null) return "—";
        const powerIndex = toNumber(row?.power_index);
        return (
          <span className="drt-value">
            {/* 単位は別の要素にし、狭い一覧カードでは一回り小さくする（RaceCardDataTable.css、BOA-586） */}
            <span>
              {rate.toFixed(1)}
              <span className="drt-unit">%</span>
            </span>
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
  ];
}

export function buildFormRow(c) {
  const { t, ph, formByBoat, racerForm } = c;
  return [
    {
      key: "form",
      label: t("dataTable.rowForm"),
      shortLabel: t("review.cols.form"),
      tab: "racer",
      // 上がった艇（Δ > 0）の中の最良だけを強調する。全員が下がっているときに「下がり方が
      // 最も小さい艇」へ金枠を付けると、赤（悪い）の値に金（最良）が重なる（R1・R2。
      // 埋め込み分析の選手調子と同じ条件）
      best: (() => {
        const rows = racerForm ?? [];
        const best = bestOf(
          rows.map((r) => ({ boat: r.boat_number, value: r.delta })),
          "max",
          { digits: 2 },
        );
        const up = new Set(
          rows.filter((r) => r.delta > 0).map((r) => r.boat_number),
        );
        return new Set([...best].filter((boat) => up.has(boat)));
      })(),
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
  ];
}
