/**
 * RaceOddsListTab - レース詳細ページ「オッズ一覧」タブ（BOA-311）
 *
 * 日和の「オッズ一覧」タブ相当。race_odds.trifecta_all/trio_all/exacta_all/
 * quinella_all/wide_all（jsonb、ADR-0054/0057、FR-4で全券種が本番稼働済み）を
 * 使い、券種タブ切替×6x6ヒートマップグリッド×セルタップでのオッズ推移
 * ドリルダウンを提供する。
 *
 * 3連単(trifecta)・3連複(trio)は3艇の組み合わせのため、2次元(6x6)グリッドに
 * そのまま収まらない。1着×2着(trioは艇番の小さい2艇)のペアをグリッドの軸にし、
 * セルの値は残り4艇のうち最もオッズが低い（人気の高い）組み合わせを表示、
 * タップすると3着候補の内訳（全通り）を出してから個別の推移を見る2段階の
 * ドリルダウンにしている。2連単/2連複/拡連複はペア自体が最終的な買い目のため
 * タップで直接推移を表示する（1段階）。
 *
 * 免責文言（BOA-311指示#1）: スクレイピング取得値のため、実際の投票内容は
 * 主催者発行のものと照合するよう明記する。
 */
import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";
import "./RaceOddsListTab.css";

const BOAT_NUMBERS = [1, 2, 3, 4, 5, 6];

// 券種定義。dataKeyはgetRaceOddsSnapshotsが返すスナップショット行のキーに対応。
// ordered=false（trio/quinella/wide）は艇番昇順ソート済みキー（ADR-0054）
const BET_TYPES = [
  { id: "trifecta", dataKey: "trifectaAll", boats: 3, ordered: true },
  { id: "trio", dataKey: "trioAll", boats: 3, ordered: false },
  { id: "exacta", dataKey: "exactaAll", boats: 2, ordered: true },
  { id: "quinella", dataKey: "quinellaAll", boats: 2, ordered: false },
  { id: "wide", dataKey: "wideAll", boats: 2, ordered: false, isRange: true },
];

function sortedKey(nums) {
  return [...nums].sort((a, b) => a - b).join("-");
}

// レンジ値（拡連複）は下限を代表値として使う（人気度＝色分けの基準として
// 下限の方が「最低でもこれだけ付く」という保守的な値のため）
function valueToNumber(value, isRange) {
  if (value == null) return null;
  return isRange ? value.low : value;
}

function formatValue(value, isRange) {
  if (value == null) return null;
  return isRange
    ? `${value.low.toFixed(1)}-${value.high.toFixed(1)}`
    : value.toFixed(1);
}

// 直接ペア（2連単/2連複/拡連複）のオッズを取得
function getPairValue(dataMap, betType, row, col) {
  if (!dataMap) return null;
  const key = betType.ordered ? `${row}-${col}` : sortedKey([row, col]);
  return dataMap[key] ?? null;
}

// 3艇券種（3連単/3連複）: (row, col)ペアに対する残り4艇の候補一覧を
// オッズ昇順（人気順）で返す
function getTripleCandidates(dataMap, betType, row, col) {
  if (!dataMap) return [];
  return BOAT_NUMBERS.filter((n) => n !== row && n !== col)
    .map((third) => {
      const key = betType.ordered
        ? `${row}-${col}-${third}`
        : sortedKey([row, col, third]);
      const value = dataMap[key];
      return value != null ? { third, value, key } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        valueToNumber(a.value, betType.isRange) -
        valueToNumber(b.value, betType.isRange),
    );
}

// オッズ値をヒートマップの濃淡バケット(0〜4、4が最も人気=オッズが低い)に変換
function heatBucket(numericValue) {
  if (numericValue == null || numericValue <= 0) return null;
  const intensity = Math.max(
    0,
    Math.min(1, 1 - Math.log10(numericValue) / 2.4),
  );
  return Math.min(4, Math.floor(intensity * 5));
}

// スナップショット履歴から指定キーの推移（発走までの残り分数付き）を作る
function buildTrend(snapshots, betType, key, deadline) {
  return snapshots
    .map((snap) => {
      const raw = snap[betType.dataKey]?.[key];
      if (raw == null) return null;
      const capturedMs = new Date(snap.capturedAt).getTime();
      const minutesBefore = deadline
        ? Math.max(0, Math.round((deadline.getTime() - capturedMs) / 60000))
        : null;
      return { minutesBefore, value: raw };
    })
    .filter(Boolean);
}

// 小さな折れ線スパークライン（MotorWakuStatsGridと同じ発想のインラインSVG）
function Sparkline({ points }) {
  if (points.length < 2) return null;
  const nums = points.map((p) => valueToNumber(p.value, false));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const width = 200;
  const height = 40;
  const coords = nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="rol-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={coords} fill="none" strokeWidth="2" />
    </svg>
  );
}

function BoatBadge({ n, className }) {
  const color = BOAT_COLORS[n] || {};
  return (
    <span
      className={className || "rol-boat-badge"}
      style={{ background: color.bg, color: color.text }}
    >
      {n}
    </span>
  );
}

function RaceOddsListTab({ raceId, raceStartTime }) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState(null); // null=読み込み中
  const [betTypeId, setBetTypeId] = useState(BET_TYPES[0].id);
  const [selectedPair, setSelectedPair] = useState(null); // {row, col}
  const [selectedTriple, setSelectedTriple] = useState(null); // {key, third}

  // PredictionPanel側でRaceTabsに`key={analysisRaceId}`を付けているため、
  // レースが変わるとこのコンポーネント自体が再マウントされ、stateは自然に
  // 初期化される。そのためこの効果内でraceId変更時の明示的なリセットは不要
  // （react-hooks/set-state-in-effect: 効果本体での同期的なsetState呼び出しを
  // 避け、非同期コールバック内でのみ呼ぶ）
  useEffect(() => {
    let cancelled = false;
    if (!raceId) return undefined;
    supabaseDataService
      .getRaceOddsSnapshots(raceId)
      .then((data) => {
        if (!cancelled) setSnapshots(data);
      })
      .catch((err) => {
        console.error("オッズ一覧取得エラー:", err?.message ?? String(err));
        if (!cancelled) setSnapshots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  const betType = BET_TYPES.find((b) => b.id === betTypeId) ?? BET_TYPES[0];

  const selectBetType = (id) => {
    setBetTypeId(id);
    setSelectedPair(null);
    setSelectedTriple(null);
  };

  const selectPair = (row, col) => {
    if (selectedPair && selectedPair.row === row && selectedPair.col === col) {
      setSelectedPair(null);
      setSelectedTriple(null);
      return;
    }
    setSelectedPair({ row, col });
    setSelectedTriple(null);
  };

  if (snapshots === null) {
    return (
      <div className="race-odds-list-tab">
        <p className="rol-subtitle">{t("oddsList.subtitle")}</p>
        <p className="rol-no-data">{t("oddsList.loading")}</p>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="race-tabs-empty">
        <p>{t("oddsList.emptyTitle")}</p>
        <p className="race-tabs-empty-body">{t("oddsList.emptyBody")}</p>
      </div>
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const latestMap = latest[betType.dataKey];
  const deadline = getDeadlineDate(raceId, raceStartTime);

  // グリッドセルの表示値・タップ時の遷移先を券種の艇数に応じて計算
  const cellInfo = (row, col) => {
    if (row === col) return null;
    if (betType.boats === 2) {
      const value = getPairValue(latestMap, betType, row, col);
      return { value, candidates: null };
    }
    const candidates = getTripleCandidates(latestMap, betType, row, col);
    return { value: candidates[0]?.value ?? null, candidates };
  };

  // 推移表示対象の確定キー（2艇券種は選択ペア、3艇券種は選択ペア+3着選択）
  let trendKey = null;
  let trendCombo = null;
  if (betType.boats === 2 && selectedPair) {
    trendKey = betType.ordered
      ? `${selectedPair.row}-${selectedPair.col}`
      : sortedKey([selectedPair.row, selectedPair.col]);
    trendCombo = `${selectedPair.row}-${selectedPair.col}`;
  } else if (betType.boats === 3 && selectedTriple) {
    trendKey = selectedTriple.key;
    trendCombo = betType.ordered
      ? `${selectedPair.row}-${selectedPair.col}-${selectedTriple.third}`
      : trendKey;
  }
  const trend = trendKey
    ? buildTrend(snapshots, betType, trendKey, deadline)
    : [];

  const pairCandidates =
    betType.boats === 3 && selectedPair && !selectedTriple
      ? getTripleCandidates(
          latestMap,
          betType,
          selectedPair.row,
          selectedPair.col,
        )
      : null;

  return (
    <div className="race-odds-list-tab">
      <p className="rol-subtitle">{t("oddsList.subtitle")}</p>
      <p className="rol-disclaimer">⚠️ {t("oddsList.disclaimer")}</p>

      <div className="rol-bet-type-tabs" role="tablist">
        {BET_TYPES.map((bt) => (
          <button
            key={bt.id}
            type="button"
            role="tab"
            aria-selected={bt.id === betTypeId}
            className={`rol-chip${bt.id === betTypeId ? " is-active" : ""}`}
            onClick={() => selectBetType(bt.id)}
          >
            {t(`result.payoutType.${bt.id}`)}
          </button>
        ))}
      </div>

      <div className="rol-grid" role="table">
        <div className="rol-grid-corner">
          {t(
            betType.ordered
              ? "oddsList.orderedCornerLabel"
              : "oddsList.unorderedCornerLabel",
          )}
        </div>
        {BOAT_NUMBERS.map((n) => (
          <div className="rol-grid-head" key={`h-${n}`}>
            <BoatBadge n={n} />
          </div>
        ))}
        {BOAT_NUMBERS.map((row) => (
          <Fragment key={`row-${row}`}>
            <div className="rol-grid-head">
              <BoatBadge n={row} />
            </div>
            {BOAT_NUMBERS.map((col) => {
              if (row === col) {
                return (
                  <div className="rol-cell rol-cell-na" key={`${row}-${col}`}>
                    —
                  </div>
                );
              }
              const info = cellInfo(row, col);
              const numeric = valueToNumber(info.value, betType.isRange);
              const bucket = heatBucket(numeric);
              const isSelected =
                selectedPair &&
                selectedPair.row === row &&
                selectedPair.col === col;
              return (
                <button
                  type="button"
                  key={`${row}-${col}`}
                  className={`rol-cell${bucket !== null ? ` rol-heat-${bucket}` : " rol-cell-empty"}${isSelected ? " is-selected" : ""}`}
                  onClick={() => selectPair(row, col)}
                  disabled={info.value == null}
                >
                  {info.value != null
                    ? formatValue(info.value, betType.isRange)
                    : "-"}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="rol-legend">💡 {t("oddsList.legend")}</p>

      {pairCandidates && (
        <div className="rol-candidates">
          <div className="rol-candidates-title">
            {t("oddsList.pickThirdLabel")}
          </div>
          <div className="rol-candidates-row">
            {pairCandidates.length === 0 ? (
              <span className="rol-no-data">{t("oddsList.noData")}</span>
            ) : (
              pairCandidates.map((c) => (
                <button
                  type="button"
                  key={c.third}
                  className="rol-candidate-chip"
                  onClick={() => setSelectedTriple(c)}
                >
                  <BoatBadge n={c.third} className="rol-boat-badge-sm" />
                  <span>{formatValue(c.value, betType.isRange)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {trendKey && (
        <div className="rol-trend">
          <div className="rol-trend-title">
            {t("oddsList.trendTitle", { combo: trendCombo })}
          </div>
          {trend.length === 0 ? (
            <p className="rol-no-data">{t("oddsList.noData")}</p>
          ) : (
            <>
              <Sparkline points={trend} />
              <div className="rol-trend-values">
                {trend.map((p, i) => (
                  <div className="rol-trend-item" key={i}>
                    <div className="rol-trend-value">
                      {formatValue(p.value, betType.isRange)}
                    </div>
                    <div className="rol-trend-label">
                      {p.minutesBefore === null
                        ? "-"
                        : p.minutesBefore === 0
                          ? t("oddsList.deadlineLabel")
                          : t("oddsList.minutesBeforeLabel", {
                              n: p.minutesBefore,
                            })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default RaceOddsListTab;
