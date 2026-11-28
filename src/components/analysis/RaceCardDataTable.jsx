/**
 * RaceCardDataTable - 出走表データ分析タブ（BOA-168）
 * レースAI予想内にあったAIデータ予想テーブル（PredictionTable）の
 * データ項目をデータ分析ツールへ外出ししたもの。
 * AI由来の項目（総合力スコア・AI予想順ソート）は含めず、枠番順の純粋な
 * 出走表データ（race_entries + racerStats + 展示データ）を表示する。
 * 行＝指標・列＝艇番の表にし、値の下に6艇の中の位置の灰の棒（長いほど上位、平均ST・展示タイムは速いほど長い）を出す。
 * 13列の横長の表はスマホで5列しか見えず、上位3位の色は CSS の詳細度で効いていなかった
 * （部品化 G4 T-29、2026-11-28 オーナーが before/after で承認。plan.md §14: 上位の印を色にしない）。
 */
import { useState, useEffect } from "react";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { useTranslation } from "react-i18next";
import {
  getRaceOfficialAvgSt,
  getRaceRacerStats,
} from "../../services/raceQueries2.js";
import { getRaceEntriesDetail } from "../../services/raceQueries3.js";
import { getRaceSt30 } from "../../services/analogyService";
import InlineFetchError from "../InlineFetchError";
import { formatExhibitionSt } from "../../utils/formatters";
import BoatBadge from "../race/BoatBadge";
import "./MotorConditionChart.css";
import "./RaceCardDataTable.css";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

// 6艇の中の位置（0〜1、1 が上位）。dir は max（大きいほど上位）か min（小さいほど上位）。
// 値の無い艇は null。全艇同値（例: モーター交換直後で全艇2連率0%）は位置の意味が無いので null（棒を出さない）
const positionsOf = (values, dir) => {
  const ok = values.filter((v) => v !== null);
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  return values.map((v) =>
    v === null || ok.length === 0 || lo === hi
      ? null
      : dir === "max"
        ? (v - lo) / (hi - lo)
        : (hi - v) / (hi - lo),
  );
};

// 全国勝率・当地勝率の 0.00 は「走っていない」（6着でも点が付くので、走れば 0 にならない）。値も棒も出さない
const rateOrNone = (value) => {
  const n = toNumber(value);
  return n === 0 ? null : n;
};

function RaceCardVenueRaceControls({
  venues,
  loading,
  selectedVenue,
  setSelectedVenue,
  races,
  selectedRace,
  setSelectedRace,
  t,
}) {
  return venues.length === 0 && !loading ? (
    <div className="empty-state">{t("analysis.noRacesToday")}</div>
  ) : (
    <div className="controls-section">
      <label htmlFor="race-card-venue-select">
        {t("analysis.venueSelectTodayLabel")}
      </label>
      <select
        id="race-card-venue-select"
        value={selectedVenue ?? ""}
        onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
        className="venue-select"
      >
        {venues.map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>

      {races.length > 0 && (
        <>
          <label htmlFor="race-card-race-select">
            {t("analysis.raceSelectLabel")}
          </label>
          <select
            id="race-card-race-select"
            value={selectedRace ?? ""}
            onChange={(e) => setSelectedRace(e.target.value)}
            className="venue-select"
          >
            {races.map((r) => (
              <option key={r.race_id} value={r.race_id}>
                {t("analysis.raceOption", {
                  number: r.race_number,
                  time: r.start_time?.slice(0, 5),
                })}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

// 行 = 指標。dir があれば値の下に6艇の中の位置の棒（長いほど上位）。行の名前は既存の表と同じ訳
const METRICS = [
  { key: "table.class", value: (r) => r.grade ?? "—" },
  { key: "table.age", value: (r) => r.age ?? "—" },
  {
    key: "table.nationalWinRate",
    num: (r) => rateOrNone(r.win_rate),
    digits: 2,
    dir: "max",
  },
  {
    key: "table.nationalTop2Rate",
    num: (r) => toNumber(r.global_2rate),
    digits: 1,
    pct: true,
    dir: "max",
  },
  {
    key: "table.localWinRate",
    num: (r) => rateOrNone(r.local_win_rate),
    digits: 2,
    dir: "max",
  },
  {
    key: "table.motorTop2Rate",
    num: (r) => toNumber(r.motor_2rate),
    digits: 1,
    pct: true,
    dir: "max",
  },
  {
    key: "dataTable.rowAvgStOfficial",
    num: (r, ctx) => toNumber(ctx.avgSt.official.get(r.boat_number)),
    digits: 2,
    dir: "min",
  },
  {
    key: "dataTable.rowAvgSt30",
    num: (r, ctx) => toNumber(ctx.avgSt.st30.get(r.boat_number)),
    digits: 3,
    dir: "min",
  },
  {
    key: "table.exhibitionTime",
    num: (r) => toNumber(r.exhibition_time),
    digits: 2,
    dir: "min",
  },
  // 展示のフライング・出遅れは公式の表記（F.01 等）で出す（BOA-759）
  {
    key: "table.exhibitionST",
    value: (r) =>
      formatExhibitionSt(r.exhibition_st, r.exhibition_start_flag) ?? "—",
  },
  { key: "table.wakuWinRate", waku: true },
];

// 名前はスマホでは姓だけ（列が約40px。公式の名は「姓 名」の空白区切り）、PC は全部
function NameCell({ name }) {
  const full = name?.replace(/\s+/g, "") ?? "";
  const family = name?.trim().split(/\s+/)[0] ?? "";
  return (
    <span className="rcd-col-name" translate="no">
      <span className="rcd-name-full">{full}</span>
      <span className="rcd-name-short">{family}</span>
    </span>
  );
}

function MetricCell({ metric, row, pos, ctx }) {
  if (metric.waku) {
    const counts = ctx.statsByBoat.get(row.boat_number)?.wakuRaceCounts?.[
      String(row.boat_number)
    ];
    if (!counts || counts.total <= 0) return <td>—</td>;
    const wins = counts.wins ?? 0;
    return (
      <td>
        {((wins / counts.total) * 100).toFixed(0)}%
        <span className="rcd-sub">
          {wins}/{counts.total}
        </span>
      </td>
    );
  }
  if (!metric.num) return <td>{metric.value(row)}</td>;
  const n = metric.num(row, ctx);
  return (
    <td>
      {n === null ? "—" : n.toFixed(metric.digits)}
      {n !== null && metric.pct && <span className="rcd-pct">%</span>}
      {pos !== null && (
        <span className="rcd-pos" aria-hidden="true">
          <span
            className="rcd-pos-fill"
            style={{ width: `${12 + pos * 88}%` }}
          />
        </span>
      )}
    </td>
  );
}

function RaceCardTable({ entries, statsByBoat, avgSt, t }) {
  const ctx = { avgSt, statsByBoat };
  return (
    <div className="rcd-table-wrapper">
      <table className="rcd-table">
        <thead>
          <tr>
            <th scope="col" className="rcd-corner">
              {t("table.boatNumber")}
            </th>
            {entries.map((row) => (
              <th key={row.boat_number} scope="col" className="rcd-boat-head">
                <BoatBadge n={row.boat_number} size="sm" />
                <NameCell name={row.player_name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const pos = metric.dir
              ? positionsOf(
                  entries.map((r) => metric.num(r, ctx)),
                  metric.dir,
                )
              : entries.map(() => null);
            return (
              <tr key={metric.key}>
                <th scope="row" className="rcd-metric">
                  {t(metric.key)}
                </th>
                {entries.map((row, i) => (
                  <MetricCell
                    key={row.boat_number}
                    metric={metric}
                    row={row}
                    pos={pos[i]}
                    ctx={ctx}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RaceCardDataTable({ initialVenueCode = null, initialRaceId = null }) {
  const { t } = useTranslation();
  const {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  } = useVenueRaceSelector({ initialVenueCode, initialRaceId, t });
  const [entries, setEntries] = useState([]);
  const [racerStats, setRacerStats] = useState(null);
  const [avgSt, setAvgSt] = useState({ official: new Map(), st30: new Map() });
  const [st30Failed, setSt30Failed] = useState(false);
  const [st30Retry, setSt30Retry] = useState(0);
  useEffect(() => {
    if (selectedRace === null) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        // 平均ST はデータ出走表と同じ2列（公式／直近30走、BOA-815）
        // 30走は v16 の API から取る。その失敗で表全体を消さず、列の下に取得失敗を出す
        setSt30Failed(false);
        const [entryRows, stats, official, st30] = await Promise.all([
          getRaceEntriesDetail(selectedRace),
          getRaceRacerStats(selectedRace),
          getRaceOfficialAvgSt(selectedRace),
          getRaceSt30(selectedRace).catch((err) => {
            console.error("平均ST(30走)の取得に失敗:", err?.message ?? err);
            setSt30Failed(true);
            return [];
          }),
        ]);
        setEntries(entryRows ?? []);
        setRacerStats(stats);
        setAvgSt({
          official: new Map(official.rows.map((r) => [r.boatNumber, r.avgSt])),
          st30: new Map(st30.map((r) => [r.boatNumber, r.st30])),
        });
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race card data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedRace, st30Retry]);

  const statsByBoat = new Map((racerStats ?? []).map((s) => [s.boatNumber, s]));

  return (
    <div className="motor-condition-container">
      <h2>{t("analysis.raceCard.title")}</h2>
      <p className="section-description">
        {t("analysis.raceCard.descriptionRows")}
      </p>

      <RaceCardVenueRaceControls
        venues={venues}
        loading={loading}
        selectedVenue={selectedVenue}
        setSelectedVenue={setSelectedVenue}
        races={races}
        selectedRace={selectedRace}
        setSelectedRace={setSelectedRace}
        t={t}
      />

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <RaceCardTable
          entries={entries}
          statsByBoat={statsByBoat}
          avgSt={avgSt}
          t={t}
        />
      )}
      {!loading && !error && st30Failed && (
        <InlineFetchError onRetry={() => setSt30Retry((n) => n + 1)} />
      )}

      <p className="table-note">{t("analysis.raceCard.note")}</p>
    </div>
  );
}

export default RaceCardDataTable;
