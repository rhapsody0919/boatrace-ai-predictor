/**
 * RaceOddsListTab - レース詳細ページ「オッズ一覧」タブ（BOA-311）
 *
 * 日和の「オッズ一覧」タブ相当。race_odds.trifecta_all/trio_all/exacta_all/
 * quinella_all/wide_all（jsonb、ADR-0054/0057、FR-4で全券種が本番稼働済み）を
 * 使い、券種タブ切替×全組み合わせの常時表示×オッズ推移のドリルダウンを提供する。
 *
 * 表示は日和に合わせ、タップ不要で全通りの数字が見える構造にしている:
 * - 3連単: 1着ごとのブロック → 2着ごとの列 → 3着ごとの行（全120通り）。
 *   列の下に、その2着の合成オッズと1着-2着の2連単オッズを表示する
 * - 3連複: 艇番3つの組み合わせを一覧（全20通り）
 * - 2連単: 1着ごとのブロック → 2着ごとの行（全30通り）
 * - 2連複/拡連複: 小さい方の艇番ごとのブロック → 相手艇ごとの行（全15通り）
 * オッズをタップするとその組み合わせのオッズ推移（スナップショット履歴）を表示する。
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
  { id: "trifecta", dataKey: "trifectaAll", ordered: true },
  { id: "trio", dataKey: "trioAll", ordered: false },
  { id: "exacta", dataKey: "exactaAll", ordered: true },
  { id: "quinella", dataKey: "quinellaAll", ordered: false },
  { id: "wide", dataKey: "wideAll", ordered: false, isRange: true },
];

// 3連複の全20通り（艇番昇順）
const TRIO_COMBOS = BOAT_NUMBERS.flatMap((a) =>
  BOAT_NUMBERS.filter((b) => b > a).flatMap((b) =>
    BOAT_NUMBERS.filter((c) => c > b).map((c) => [a, b, c]),
  ),
);

const othersOf = (n) => BOAT_NUMBERS.filter((x) => x !== n);

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

// 合成オッズ: 各組み合わせのオッズの逆数の和の逆数（「そのうちどれか」を
// 全部買ったときの実質オッズ）。欠場艇等で組み合わせが欠けている場合は
// 存在する組み合わせだけで計算する
function compositeOdds(values) {
  const nums = values.filter((v) => v != null && v > 0);
  if (nums.length === 0) return null;
  return 1 / nums.reduce((sum, v) => sum + 1 / v, 0);
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

// 券種ごとに最新の「その券種の値を持つ」スナップショットを使う。全通り系5列は
// 個別取得で、最新行に選択中の券種だけnullのことがある（一部券種の取得失敗や
// FR-4以前のレース）ため、単純に末尾行を使うと表全体が空になる
function latestMapOf(snapshots, dataKey) {
  return [...snapshots].reverse().find((s) => s[dataKey])?.[dataKey] ?? null;
}

// 小さな折れ線スパークライン（MotorWakuStatsGridと同じ発想のインラインSVG）
function Sparkline({ points, isRange }) {
  if (points.length < 2) return null;
  const nums = points.map((p) => valueToNumber(p.value, isRange));
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

function BoatBadge({ n, size }) {
  const color = BOAT_COLORS[n] || {};
  return (
    <span
      className={`rol-boat-badge${size ? ` rol-boat-badge-${size}` : ""}`}
      style={{ background: color.bg, color: color.text }}
    >
      {n}
    </span>
  );
}

// ブロック見出し（艇番バッジ＋選手名）
function BlockHead({ n, name }) {
  return (
    <div className="rol-block-head">
      <BoatBadge n={n} />
      {name && (
        <span className="rol-block-name" translate="no">
          {name}
        </span>
      )}
    </div>
  );
}

// オッズ1件のタップ領域（左に艇番バッジ群、右にオッズ。人気度で色分け）
function OddsButton({ value, isRange, selected, onClick, ariaLabel, badges }) {
  const bucket = heatBucket(valueToNumber(value, isRange));
  return (
    <button
      type="button"
      className={`rol-odds${bucket !== null ? ` rol-heat-${bucket}` : " rol-cell-empty"}${selected ? " is-selected" : ""}`}
      onClick={onClick}
      disabled={value == null}
      aria-label={ariaLabel}
      aria-pressed={selected}
    >
      <span className="rol-odds-badges">{badges}</span>
      <span className="rol-odds-value">
        {value != null ? formatValue(value, isRange) : "-"}
      </span>
    </button>
  );
}

function TrendPanel({ combo, trend, isRange, t, spanAll }) {
  return (
    <div className={`rol-trend${spanAll ? " rol-span-all" : ""}`}>
      <div className="rol-trend-title">
        {t("oddsList.trendTitle", { combo })}
      </div>
      {trend.length === 0 ? (
        <p className="rol-no-data">{t("oddsList.noData")}</p>
      ) : (
        <>
          <Sparkline points={trend} isRange={isRange} />
          <div className="rol-trend-values">
            {trend.map((p, i) => (
              <div className="rol-trend-item" key={i}>
                <div className="rol-trend-value">
                  {formatValue(p.value, isRange)}
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
  );
}

function RaceOddsListTab({ raceId, raceStartTime, players }) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState(null); // null=読み込み中
  const [betTypeId, setBetTypeId] = useState(BET_TYPES[0].id);
  const [selected, setSelected] = useState(null); // {blockId, key}

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
    setSelected(null);
  };

  // 同じ組み合わせを再タップすると推移を閉じる
  const toggleSelected = (blockId, key) => {
    setSelected((prev) =>
      prev && prev.blockId === blockId && prev.key === key
        ? null
        : { blockId, key },
    );
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

  const latestMap = latestMapOf(snapshots, betType.dataKey);
  const deadline = getDeadlineDate(raceId, raceStartTime);
  const isRange = !!betType.isRange;

  const nameByBoat = new Map(
    (players ?? []).map((p) => [p.number, p.name?.replace(/\s+/g, "")]),
  );

  const valueOf = (key) => latestMap?.[key] ?? null;

  const trendPanelFor = (blockId, spanAll) => {
    if (!selected || selected.blockId !== blockId) return null;
    return (
      <TrendPanel
        combo={selected.key}
        trend={buildTrend(snapshots, betType, selected.key, deadline)}
        isRange={isRange}
        t={t}
        spanAll={spanAll}
      />
    );
  };

  const isSelected = (blockId, key) =>
    !!selected && selected.blockId === blockId && selected.key === key;

  // 3連単: 1着ブロック → 2着列 → 3着行（＋合成オッズ・2連単オッズ）
  const renderTrifecta = () => {
    const exactaMap = latestMapOf(snapshots, "exactaAll");
    return BOAT_NUMBERS.map((first) => (
      <section className="rol-block" key={first}>
        <BlockHead n={first} name={nameByBoat.get(first)} />
        <div className="rol-cols">
          {othersOf(first).map((second) => {
            const thirds = BOAT_NUMBERS.filter(
              (n) => n !== first && n !== second,
            );
            const values = thirds.map((third) =>
              valueOf(`${first}-${second}-${third}`),
            );
            const composite = compositeOdds(values);
            const exacta = exactaMap?.[`${first}-${second}`] ?? null;
            return (
              <div className="rol-col" key={second}>
                <div className="rol-col-head">
                  <BoatBadge n={second} size="sm" />
                </div>
                {thirds.map((third, i) => {
                  const key = `${first}-${second}-${third}`;
                  return (
                    <OddsButton
                      key={third}
                      value={values[i]}
                      selected={isSelected(first, key)}
                      onClick={() => toggleSelected(first, key)}
                      ariaLabel={`${key} ${values[i] != null ? formatValue(values[i]) : "-"}`}
                      badges={<BoatBadge n={third} size="xs" />}
                    />
                  );
                })}
                <div className="rol-col-foot">
                  <span>{t("oddsList.compositeLabel")}</span>
                  <span>{composite != null ? composite.toFixed(1) : "-"}</span>
                </div>
                <div className="rol-col-foot">
                  <span>{t("oddsList.exactaShortLabel")}</span>
                  <span>{exacta != null ? exacta.toFixed(1) : "-"}</span>
                </div>
              </div>
            );
          })}
        </div>
        {trendPanelFor(first)}
      </section>
    ));
  };

  // 3連複: 艇番3つの組み合わせを2列で一覧。推移パネルは選択した行の直後に全幅で挿入
  const renderTrio = () => {
    const selectedIdx = selected
      ? TRIO_COMBOS.findIndex((c) => c.join("-") === selected.key)
      : -1;
    const rowEndIdx =
      selectedIdx >= 0
        ? Math.min(selectedIdx - (selectedIdx % 2) + 1, TRIO_COMBOS.length - 1)
        : -1;
    return (
      <div className="rol-trio-list">
        {TRIO_COMBOS.map((combo, idx) => {
          const key = combo.join("-");
          const value = valueOf(key);
          return (
            <Fragment key={key}>
              <OddsButton
                value={value}
                selected={isSelected("trio", key)}
                onClick={() => toggleSelected("trio", key)}
                ariaLabel={`${key} ${value != null ? formatValue(value) : "-"}`}
                badges={combo.map((n) => (
                  <BoatBadge key={n} n={n} size="xs" />
                ))}
              />
              {idx === rowEndIdx && trendPanelFor("trio", true)}
            </Fragment>
          );
        })}
      </div>
    );
  };

  // 2連単/2連複/拡連複: 艇番ごとのブロック → 相手艇ごとの行。
  // 2連単は1着ブロック×2着行、順不同の券種は小さい艇番のブロック×大きい艇番の行
  const renderPairs = () => (
    <div className="rol-pair-grid">
      {BOAT_NUMBERS.map((head) => {
        const partners = betType.ordered
          ? othersOf(head)
          : BOAT_NUMBERS.filter((n) => n > head);
        if (partners.length === 0) return null;
        return (
          <section className="rol-block" key={head}>
            <BlockHead n={head} name={nameByBoat.get(head)} />
            <div className="rol-rows">
              {partners.map((partner) => {
                const key = `${head}-${partner}`;
                const value = valueOf(key);
                return (
                  <OddsButton
                    key={partner}
                    value={value}
                    isRange={isRange}
                    selected={isSelected(head, key)}
                    onClick={() => toggleSelected(head, key)}
                    ariaLabel={`${key} ${value != null ? formatValue(value, isRange) : "-"}`}
                    badges={<BoatBadge n={partner} size="sm" />}
                  />
                );
              })}
            </div>
            {trendPanelFor(head)}
          </section>
        );
      })}
    </div>
  );

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

      {!latestMap && (
        <p className="rol-no-data">{t("oddsList.noBetTypeData")}</p>
      )}
      {latestMap && (
        <>
          <p className="rol-guide">{t(`oddsList.guide.${betType.id}`)}</p>
          {betType.id === "trifecta" && renderTrifecta()}
          {betType.id === "trio" && renderTrio()}
          {betType.id !== "trifecta" && betType.id !== "trio" && renderPairs()}
          <p className="rol-legend">💡 {t("oddsList.legend")}</p>
        </>
      )}
    </div>
  );
}

export default RaceOddsListTab;
