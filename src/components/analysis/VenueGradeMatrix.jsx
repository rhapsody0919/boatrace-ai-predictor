/**
 * VenueGradeMatrix - 会場×グレード横断分析（BOA-263）
 * 選択した会場について、グレード（一般戦/G3/G2/G1/SG）×艇番の指標をマトリックス
 * 表示する。全国平均だけでは見えない会場固有の例外（グレードが上がるとインが
 * 弱くなる等）を発見できるようにする。venue_grade_boat_stats
 * （scripts/daily/calculate-venue-grade-stats.jsが日次バッチで事前集計）を読むだけ。
 *
 * 注: 「平均着順」「決まり手内訳/構成比」はPhase 1の対象外。平均着順は
 * race_resultsが1〜3着の艇番しか保持しておらず4〜6着の着順を算出できないため、
 * 決まり手はセルが単一数値ではなく分布になり表示設計を別途詰める必要があるため
 * （BOA-263チケット参照、データ自体はvenue_grade_boat_stats.technique_breakdown
 * に集計済みなので将来追加しやすい）
 * 1着率は表でなく、グレードごとの1着の取り分の積み上げ棒で出す（VenueGradeWinShare、G4 T-09、2026-11-28 オーナー承認）。
 * 連対率・3連対率・万舟率・平均配当は今までの表のまま。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getVenueGradeBoatStats,
  getVenuesWithGradeStats,
} from "../../services/venueQueries3.js";
import VenueGradeWinShare from "./VenueGradeWinShare";
import "./MotorConditionChart.css";

const VENUES = [
  { code: "01", name: "桐生" },
  { code: "02", name: "戸田" },
  { code: "03", name: "江戸川" },
  { code: "04", name: "平和島" },
  { code: "05", name: "多摩川" },
  { code: "06", name: "浜名湖" },
  { code: "07", name: "蒲郡" },
  { code: "08", name: "常滑" },
  { code: "09", name: "津" },
  { code: "10", name: "三国" },
  { code: "11", name: "びわこ" },
  { code: "12", name: "住之江" },
  { code: "13", name: "尼崎" },
  { code: "14", name: "鳴門" },
  { code: "15", name: "丸亀" },
  { code: "16", name: "児島" },
  { code: "17", name: "宮島" },
  { code: "18", name: "徳山" },
  { code: "19", name: "下関" },
  { code: "20", name: "若松" },
  { code: "21", name: "芦屋" },
  { code: "22", name: "福岡" },
  { code: "23", name: "唐津" },
  { code: "24", name: "大村" },
];

const GRADE_ORDER = ["ippan", "G3", "G2", "G1", "SG"];
const MIN_RACE_COUNT = 50;

const METRICS = [
  { key: "winRate", boatSpecific: true },
  { key: "top2Rate", boatSpecific: true },
  { key: "top3Rate", boatSpecific: true },
  { key: "manshuRate", boatSpecific: false },
  { key: "avgPayout", boatSpecific: false },
];

function formatMetric(metricKey, row) {
  if (!row) return "-";
  switch (metricKey) {
    case "winRate":
      if (row.race_count < MIN_RACE_COUNT) return "-";
      return `${((row.wins / row.race_count) * 100).toFixed(1)}%`;
    case "top2Rate":
      if (row.race_count < MIN_RACE_COUNT) return "-";
      return `${((row.top2 / row.race_count) * 100).toFixed(1)}%`;
    case "top3Rate":
      if (row.race_count < MIN_RACE_COUNT) return "-";
      return `${((row.top3 / row.race_count) * 100).toFixed(1)}%`;
    // 万舟率・平均配当は、有効なレースでもスクレイピング取得失敗等でpayout_trioが
    // NULLになりうるため、race_countではなく専用の分母payout_countを使う
    // （calculate-venue-grade-stats.jsのコメント参照）
    case "manshuRate":
      if (row.payout_count < MIN_RACE_COUNT) return "-";
      return `${((row.manshu_count / row.payout_count) * 100).toFixed(1)}%`;
    case "avgPayout":
      if (row.payout_count < MIN_RACE_COUNT) return "-";
      return `¥${Math.round(row.payout_trio_sum / row.payout_count).toLocaleString()}`;
    default:
      return "-";
  }
}

function VenueGradeControls({
  t,
  selectedVenue,
  setSelectedVenue,
  selectedMetric,
  setSelectedMetric,
  availableVenues,
}) {
  return (
    <div className="controls-section">
      <label htmlFor="venue-grade-venue-select">
        {t("analysis.venueSelectLabel")}
      </label>
      <select
        id="venue-grade-venue-select"
        value={selectedVenue}
        onChange={(e) => setSelectedVenue(e.target.value)}
        className="venue-select"
      >
        {availableVenues.map((venue) => (
          <option key={venue.code} value={venue.code}>
            {t(`venues.${parseInt(venue.code, 10)}`, venue.name)}
          </option>
        ))}
      </select>

      <label htmlFor="venue-grade-metric-select">
        {t("analysis.venueGrade.metricSelectLabel")}
      </label>
      <select
        id="venue-grade-metric-select"
        value={selectedMetric}
        onChange={(e) => setSelectedMetric(e.target.value)}
        className="venue-select"
      >
        {METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {/* 中身は1着の割合なので「勝率」（着順点の平均）と呼ばない（用語集の 1着率） */}
            {m.key === "winRate"
              ? t("analysis.venueGrade.metricFirstRate")
              : t(`analysis.venueGrade.metric.${m.key}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function VenueGradeTable({
  t,
  metric,
  selectedMetric,
  gradesPresent,
  byGradeAndBoat,
  boatRows,
}) {
  return (
    <>
      <div className="table-wrapper">
        <table className="motor-ranking-table">
          <thead>
            <tr>
              <th>
                {metric.boatSpecific
                  ? t("analysis.laneHeader")
                  : t("analysis.venueGrade.raceWideHeader")}
              </th>
              {gradesPresent.map((grade) => (
                <th key={grade}>
                  {grade === "ippan"
                    ? t("volatilityAccuracy.gradeIppan")
                    : grade}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boatRows.map((boat) => (
              <tr key={boat}>
                <td className="rank">
                  {metric.boatSpecific
                    ? t("analysis.boatN", { n: boat })
                    : t("analysis.venueGrade.raceWideHeader")}
                </td>
                {gradesPresent.map((grade) => {
                  const row = byGradeAndBoat.get(`${grade}-${boat}`);
                  return (
                    <td key={grade} className="rate">
                      {formatMetric(selectedMetric, row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        {t("analysis.venueGrade.note", { minRaceCount: MIN_RACE_COUNT })}
      </p>
    </>
  );
}

// 指標の説明と、読み込み中・失敗・空・中身の出し分け。1着率は積み上げ棒、ほかは表（G4 T-09）
function VenueGradeBody({ t, loading, error, rows, selectedMetric, ...table }) {
  const isWinRate = selectedMetric === "winRate";
  let content = null;
  if (loading) {
    content = <div className="loading-state">{t("analysis.loading")}</div>;
  } else if (error) {
    content = (
      <div className="error-state">
        {t("analysis.error", { message: error })}
      </div>
    );
  } else if (rows.length === 0) {
    content = (
      <div className="empty-state">{t("analysis.venueGrade.empty")}</div>
    );
  } else if (isWinRate) {
    content = (
      <VenueGradeWinShare
        grades={table.gradesPresent}
        byGradeAndBoat={table.byGradeAndBoat}
        gradeLabel={(g) =>
          g === "ippan" ? t("volatilityAccuracy.gradeIppan") : g
        }
      />
    );
  } else {
    content = (
      <VenueGradeTable t={t} selectedMetric={selectedMetric} {...table} />
    );
  }
  return (
    <>
      {!isWinRate && (
        <p className="section-description">
          {t(`analysis.venueGrade.metricDescription.${selectedMetric}`)}
        </p>
      )}
      {content}
    </>
  );
}

function VenueGradeMatrix() {
  const { t } = useTranslation();
  const [selectedVenue, setSelectedVenue] = useState("14");
  const [selectedMetric, setSelectedMetric] = useState("winRate");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [venuesWithData, setVenuesWithData] = useState(null);

  // データがある会場のみをプルダウンの選択肢にする。未取得（マイグレーション
  // 未適用でテーブルが空の場合を含む）は空配列を返すだけで例外にはしないため、
  // その場合は絞り込まず全24会場を表示するフォールバックにする（0件だと
  // プルダウン自体が空になり操作不能になるため）
  useEffect(() => {
    getVenuesWithGradeStats()
      .then(setVenuesWithData)
      .catch((err) => {
        console.error("Failed to load venues with grade stats:", err);
        setVenuesWithData([]);
      });
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const data = await getVenueGradeBoatStats(venueCode);
        setRows(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load venue grade boat stats:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedVenue, t]);

  const availableVenues =
    venuesWithData && venuesWithData.length > 0
      ? VENUES.filter((v) => venuesWithData.includes(parseInt(v.code, 10)))
      : VENUES;
  const metric = METRICS.find((m) => m.key === selectedMetric) ?? METRICS[0];
  const gradesPresent = GRADE_ORDER.filter((g) =>
    rows.some((r) => r.race_grade === g),
  );
  const byGradeAndBoat = new Map(
    rows.map((r) => [`${r.race_grade}-${r.boat_number}`, r]),
  );
  const boatRows = metric.boatSpecific ? [1, 2, 3, 4, 5, 6] : [0];

  return (
    <div className="motor-condition-container">
      <h2>{t("analysis.venueGrade.title")}</h2>
      <p className="section-description">
        {t("analysis.venueGrade.description")}
      </p>

      <VenueGradeControls
        t={t}
        selectedVenue={selectedVenue}
        setSelectedVenue={setSelectedVenue}
        selectedMetric={selectedMetric}
        setSelectedMetric={setSelectedMetric}
        availableVenues={availableVenues}
      />

      <VenueGradeBody
        t={t}
        loading={loading}
        error={error}
        rows={rows}
        metric={metric}
        selectedMetric={selectedMetric}
        gradesPresent={gradesPresent}
        byGradeAndBoat={byGradeAndBoat}
        boatRows={boatRows}
      />
    </div>
  );
}

export default VenueGradeMatrix;
