/**
 * DataRaceTable - データ出走表（BOA-168）
 * 出走6選手×分析指標の転置マトリクス（行=指標、列=艇番）。
 * レースページの主役としてAI予想ブロック群より上に表示する。
 * 分析指標はuseRaceAnalysisDataで並列取得し、取得済みのものから逐次表示。
 * 色分けはレース内相対順位ベース（行ごとに最良セルをハイライト）で、
 * 恣意的な絶対閾値は使わない（例外: 回収率100%は「購入原資を上回る」客観基準）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import "./DataRaceTable.css";

// 日本語決まり手名 → i18nキー（techniques.*）の逆引き
const TECHNIQUE_KEY_BY_NAME = Object.fromEntries(
  Object.entries(TECHNIQUE_NAMES).map(([key, name]) => [name, key]),
);

// boat_number をキーにした行データのMapを作る
function byBoat(rows) {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row.boat_number, row));
  return map;
}

// レース内で最良の艇番を返す（dir: "max" | "min"）
function bestBoat(rows, accessor, dir = "max") {
  const candidates = (rows ?? [])
    .map((row) => ({ boat: row.boat_number, value: accessor(row) }))
    .filter((c) => c.value !== null && c.value !== undefined);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => {
    if (dir === "min") return b.value < a.value ? b : a;
    return b.value > a.value ? b : a;
  });
  return best.boat;
}

function DataRaceTable({ raceId, prediction, venueCode }) {
  const { t } = useTranslation();
  const {
    motor,
    racerForm,
    stPredictability,
    exhibitionTime,
    techniqueProfile,
    returnRate,
    loading,
  } = useRaceAnalysisData(raceId);

  const players = [...(prediction?.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  if (players.length === 0) return null;

  const motorByBoat = byBoat(motor);
  const formByBoat = byBoat(racerForm);
  const stByBoat = byBoat(stPredictability);
  const exByBoat = byBoat(exhibitionTime);
  const techByBoat = byBoat(techniqueProfile);
  const rateByBoat = byBoat(returnRate);

  // allPlayers の winRate/motor2Rate は文字列のことがあるため数値化して扱う
  const toNumber = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };

  const bestWinRate = bestBoat(
    players.map((p) => ({ boat_number: p.number, v: toNumber(p.winRate) })),
    (r) => r.v,
  );
  const bestMotor = bestBoat(motor, (r) => r.motor_2rate);
  const bestForm = bestBoat(racerForm, (r) => r.delta);
  const bestSt = bestBoat(
    stPredictability,
    (r) => (r.sample_count > 0 ? r.avg_deviation : null),
    "min",
  );
  const bestEx = bestBoat(exhibitionTime, (r) => r.exhibition_time, "min");
  const bestRate = bestBoat(returnRate, (r) =>
    r.sample_count > 0 ? r.win_return_rate : null,
  );

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?tab=${tab}`;

  const placeholder = loading ? "…" : "—";

  const cellClass = (boat, best) =>
    `drt-cell ${best !== null && boat === best ? "drt-best" : ""}`;

  const translateTechnique = (name) => {
    const key = TECHNIQUE_KEY_BY_NAME[name];
    return key ? t(`techniques.${key}`, name) : name;
  };

  // 指標行の定義
  const rows = [
    {
      key: "winRate",
      label: t("dataTable.rowWinRate"),
      link: null,
      render: (p) => (
        <span className="drt-value">
          <span className="drt-grade">{p.grade}</span>
          {toNumber(p.winRate)?.toFixed(2) ?? "—"}
        </span>
      ),
      best: bestWinRate,
    },
    {
      key: "motor",
      label: t("dataTable.rowMotor"),
      link: deepLink("motor"),
      best: bestMotor,
      render: (p) => {
        const row = motorByBoat.get(p.number);
        const rate = toNumber(row?.motor_2rate ?? p.motor2Rate);
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(1)}%</span>
        ) : (
          placeholder
        );
      },
    },
    {
      key: "form",
      label: t("dataTable.rowForm"),
      link: deepLink("racer"),
      best: bestForm,
      render: (p) => {
        const row = formByBoat.get(p.number);
        if (!row || row.delta === null || row.delta === undefined)
          return placeholder;
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
      key: "st",
      label: t("dataTable.rowSt"),
      link: deepLink("st"),
      best: bestSt,
      render: (p) => {
        const row = stByBoat.get(p.number);
        if (!row || !row.sample_count) return placeholder;
        return (
          <span className="drt-value">±{row.avg_deviation.toFixed(2)}</span>
        );
      },
    },
    {
      key: "exhibition",
      label: t("dataTable.rowExhibition"),
      link: deepLink("extrend"),
      best: bestEx,
      render: (p) => {
        const row = exByBoat.get(p.number);
        if (!row) return placeholder;
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
        return placeholder;
      },
    },
    {
      key: "technique",
      label: t("dataTable.rowTechnique"),
      link: deepLink("techprofile"),
      best: null,
      render: (p) => {
        const row = techByBoat.get(p.number);
        if (!row) return placeholder;
        if (!row.win_count || row.techniques.length === 0)
          return <span className="drt-sub">{t("dataTable.noWins")}</span>;
        const top = row.techniques[0];
        return (
          <span className="drt-value drt-technique">
            {translateTechnique(top.technique)}
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
      link: deepLink("returnrate"),
      best: bestRate,
      render: (p) => {
        const row = rateByBoat.get(p.number);
        if (!row || !row.sample_count) return placeholder;
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

  return (
    <div className="data-race-table">
      <h3 className="drt-title">📋 {t("dataTable.title")}</h3>
      <p className="drt-subtitle">{t("dataTable.subtitle")}</p>

      <div className="drt-table-wrapper">
        <table className="drt-table">
          <thead>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => {
                const color = BOAT_COLORS[p.number] || {};
                return (
                  <th
                    key={p.number}
                    className="drt-boat-th"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {p.number}
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => (
                <th key={p.number} className="drt-name-th">
                  {p.name?.replace(/\s+/g, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="drt-label-cell">
                  {row.link ? (
                    <Link to={row.link} className="drt-label-link">
                      {row.label}
                      <span className="drt-link-arrow">›</span>
                    </Link>
                  ) : (
                    row.label
                  )}
                </td>
                {players.map((p) => (
                  <td key={p.number} className={cellClass(p.number, row.best)}>
                    {row.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="drt-note">💡 {t("dataTable.note")}</p>
    </div>
  );
}

export default DataRaceTable;
