/**
 * raceIndicators の行定義（基本の指標）と、行定義の共通の文脈（buildRowContext）。
 * buildRowDefs が各 build*Rows を順に並べる
 */
import { Link } from "react-router-dom";
import { EMPTY } from "../../pure/dataFormat.js";
import {
  bestOfIndicator,
  formatIndicatorParts,
  getIndicator,
} from "../../pure/indicatorRegistry.js";
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
    players,
    analysis,
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
  const { officialStByBoat, st30ByBoat, statsByBoat } = c;
  const cand = {
    // 勝率・当地勝率・2連率・モーターは登録簿の定義へ移した（src/pure/indicator*.js、ADR-0108）
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

// 登録簿の定義（ADR-0108）から、出走表の行の見出し・詳しいタブ・最良を作る。
// key は今までの行の key（用語の説明 TermHintButton のキーを兼ねる）
function rowFromIndicator(t, data, id, key) {
  const def = getIndicator(id);
  const values = def.select(data);
  return {
    key,
    label: t(def.text.label),
    shortLabel: t(def.text.short),
    tab: def.detailTab,
    best: bestOfIndicator(def, values),
    values,
    text: (p) => formatIndicatorParts(def, values.get(p.number)?.value ?? null),
  };
}

export function buildBasicRatioRows(c) {
  const { t, players, gradeBadge } = c;
  const winRate = rowFromIndicator(
    t,
    { players },
    "racer.winRate.official",
    "winRate",
  );
  const localWinRate = rowFromIndicator(
    t,
    { players },
    "racer.localWinRate.official",
    "localWinRate",
  );
  const twoRate = rowFromIndicator(
    t,
    { players },
    "racer.twoRate.official",
    "twoRate",
  );
  return [
    {
      ...winRate,
      // 札（adornment: gradeBadge）: 級別と F・L の印
      render: (p) => (
        <span className="drt-value">
          <span className="drt-grade">
            {p.grade}
            {gradeBadge?.(p)}
          </span>
          {winRate.text(p).text}
        </span>
      ),
    },
    {
      ...localWinRate,
      render: (p) => {
        const { text } = localWinRate.text(p);
        return text === EMPTY ? (
          text
        ) : (
          <span className="drt-value">{text}</span>
        );
      },
    },
    {
      ...twoRate,
      render: (p) => {
        const { text, unit } = twoRate.text(p);
        return text === EMPTY ? (
          text
        ) : (
          <span className="drt-value">
            <span>
              {text}
              <span className="drt-unit">{unit}</span>
            </span>
          </span>
        );
      },
    },
  ];
}

export function buildMotorRow(c) {
  const { t, ph, players, analysis, motorByBoat, motorDeepLink } = c;
  const motor = rowFromIndicator(
    t,
    { players, analysis },
    "motor.twoRate.last90d",
    "motor",
  );
  const cand = {
    motor: [...motor.values].map(([boat, v]) => ({ boat, value: v.value })),
  };
  return [
    {
      ...motor,
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
      render: (p) => {
        const row = motorByBoat.get(p.number);
        const rate = motor.values.get(p.number)?.value ?? null;
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
              {motor.text(p).text}
              <span className="drt-unit">{motor.text(p).unit}</span>
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
  const { t, ph, players, analysis, formByBoat } = c;
  const form = rowFromIndicator(
    t,
    { players, analysis },
    "racer.form.winRateDelta90d",
    "form",
  );
  return [
    {
      ...form,
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
            {
              formatIndicatorParts(
                getIndicator("racer.form.winRateDelta90d"),
                Math.abs(row.delta),
              ).text
            }
          </span>
        );
      },
    },
  ];
}
