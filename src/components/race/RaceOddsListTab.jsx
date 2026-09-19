/**
 * RaceOddsListTab - レース詳細ページ「オッズ一覧」タブ（BOA-311）
 *
 * 日和の「オッズ一覧」タブ相当。race_odds.trifecta_all/trio_all/exacta_all/
 * quinella_all/wide_all（jsonb、ADR-0054/0057、FR-4で全券種が本番稼働済み）を
 * 使い、券種タブ切替×全組み合わせの常時表示×オッズ推移のドリルダウンを提供する。
 *
 * 表示は日和に合わせ、タップ不要で全通りの数字が見える構造にしている:
 * - 3連単: 1着ごとのブロック → 2着ごとの列 → 3着ごとの行（6艇なら全120通り）。
 *   列の下に、その2着の合成オッズと1着-2着の2連単オッズを表示する
 * - 3連複: 艇番3つの組み合わせを一覧（6艇なら全20通り）
 * - 2連単: 1着ごとのブロック → 2着ごとの行（6艇なら全30通り）
 * - 2連複/拡連複: 小さい方の艇番ごとのブロック → 相手艇ごとの行（全15通り）
 * 欠場艇はオッズが付かないため、表からも除く（「-」だけのブロック・列・行を出さない）。
 * オッズをタップするとその組み合わせのオッズ推移（スナップショット履歴）を表示する。
 *
 * 免責文言（BOA-311指示#1）: スクレイピング取得値のため、実際の投票内容は
 * 主催者発行のものと照合するよう明記する。
 */
import { useState, useEffect } from "react";
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
// 全部買ったときの実質オッズ）。欠場艇や票の入っていない組み合わせはオッズが
// 付かない（=逆数が0）ため、存在する組み合わせだけで計算するのが正しい
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
function latestSnapshotWith(snapshots, dataKey) {
  return [...snapshots].reverse().find((s) => s[dataKey]) ?? null;
}

// 出走艇（どこかの券種でオッズが付いている艇番）。欠場艇を表から除くために
// 全券種の最新値のキーから導出する
function activeBoatsOf(snapshots) {
  const active = new Set();
  for (const bt of BET_TYPES) {
    const map = latestSnapshotWith(snapshots, bt.dataKey)?.[bt.dataKey];
    for (const [key, value] of Object.entries(map ?? {})) {
      if (valueToNumber(value, bt.isRange) > 0) {
        key.split("-").forEach((n) => active.add(Number(n)));
      }
    }
  }
  return BOAT_NUMBERS.filter((n) => active.has(n));
}

// 3艇の組み合わせ（艇番昇順）
function triosOf(boats) {
  return boats.flatMap((a) =>
    boats
      .filter((b) => b > a)
      .flatMap((b) => boats.filter((c) => c > b).map((c) => [a, b, c])),
  );
}

// 2列グリッドで、選択中の要素と同じ行の直後に推移パネルを挿入する
function withPanelAfterRow(items, selectedIdx, panel) {
  if (selectedIdx < 0 || !panel) return items;
  const rowEnd = Math.min(selectedIdx | 1, items.length - 1);
  return [...items.slice(0, rowEnd + 1), panel, ...items.slice(rowEnd + 1)];
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
function OddsButton({ comboKey, value, isRange, selected, onSelect, badges }) {
  const bucket = heatBucket(valueToNumber(value, isRange));
  const text = formatValue(value, isRange) ?? "-";
  return (
    <button
      type="button"
      className={`rol-odds${bucket !== null ? ` rol-heat-${bucket}` : ""}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(comboKey)}
      disabled={value == null}
      aria-label={`${comboKey} ${text}`}
      aria-pressed={selected}
    >
      <span className="rol-odds-badges">{badges}</span>
      <span className="rol-odds-value">{text}</span>
    </button>
  );
}

function TrendPanel({ combo, trend, isRange, spanAll }) {
  const { t } = useTranslation();
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
  // 推移を表示中の組み合わせキー（券種内で一意。例: "1-2-3"）
  const [selectedKey, setSelectedKey] = useState(null);

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
    setSelectedKey(null);
  };

  // 同じ組み合わせを再タップすると推移を閉じる
  const toggleSelected = (key) =>
    setSelectedKey((prev) => (prev === key ? null : key));

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

  const latestSnapshot = latestSnapshotWith(snapshots, betType.dataKey);
  const latestMap = latestSnapshot?.[betType.dataKey] ?? null;
  const deadline = getDeadlineDate(raceId, raceStartTime);
  const isRange = !!betType.isRange;
  const boats = activeBoatsOf(snapshots);

  const nameByBoat = new Map(
    (players ?? []).map((p) => [p.number, p.name?.replace(/\s+/g, "")]),
  );

  const valueOf = (key) => latestMap?.[key] ?? null;

  const oddsButton = (comboKey, badges, value = valueOf(comboKey)) => (
    <OddsButton
      key={comboKey}
      comboKey={comboKey}
      value={value}
      isRange={isRange}
      selected={comboKey === selectedKey}
      onSelect={toggleSelected}
      badges={badges}
    />
  );

  const trendPanel = (spanAll) =>
    selectedKey ? (
      <TrendPanel
        key="trend"
        combo={selectedKey}
        trend={buildTrend(snapshots, betType, selectedKey, deadline)}
        isRange={isRange}
        spanAll={spanAll}
      />
    ) : null;

  // 3連単: 1着ブロック → 2着列 → 3着行（＋合成オッズ・2連単オッズ）
  const renderTrifecta = () => {
    // 2連単オッズは3連単と同じスナップショットのものを使う（別時刻の値が
    // 同じ列に並ばないように）
    const exactaMap = latestSnapshot?.exactaAll ?? null;
    return boats.map((first) => {
      const seconds = boats.filter((n) => n !== first);
      return (
        <section className="rol-block" key={first}>
          <BlockHead n={first} name={nameByBoat.get(first)} />
          <div
            className="rol-cols"
            style={{ "--rol-col-count": seconds.length }}
          >
            {seconds.map((second) => {
              const thirds = boats.filter((n) => n !== first && n !== second);
              const composite = compositeOdds(
                thirds.map((third) => valueOf(`${first}-${second}-${third}`)),
              );
              const exacta = exactaMap?.[`${first}-${second}`] ?? null;
              return (
                <div className="rol-col" key={second}>
                  <div className="rol-col-head">
                    <BoatBadge n={second} size="sm" />
                  </div>
                  {thirds.map((third) =>
                    oddsButton(
                      `${first}-${second}-${third}`,
                      <BoatBadge n={third} size="xs" />,
                    ),
                  )}
                  <div className="rol-col-foot">
                    <span>{t("oddsList.compositeLabel")}</span>
                    <span>{formatValue(composite) ?? "-"}</span>
                  </div>
                  <div className="rol-col-foot">
                    <span>{t("oddsList.exactaShortLabel")}</span>
                    <span>{formatValue(exacta) ?? "-"}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {selectedKey?.startsWith(`${first}-`) && trendPanel(false)}
        </section>
      );
    });
  };

  // 3連複: 艇番3つの組み合わせを2列で一覧
  const renderTrio = () => {
    const combos = triosOf(boats).map((combo) => combo.join("-"));
    const items = combos.map((key) =>
      oddsButton(
        key,
        key
          .split("-")
          .map((n) => <BoatBadge key={n} n={Number(n)} size="xs" />),
      ),
    );
    return (
      <div className="rol-two-col-grid">
        {withPanelAfterRow(
          items,
          combos.indexOf(selectedKey),
          trendPanel(true),
        )}
      </div>
    );
  };

  // 2連単/2連複/拡連複: 艇番ごとのブロック → 相手艇ごとの行。
  // 2連単は1着ブロック×2着行、順不同の券種は小さい艇番のブロック×大きい艇番の行
  const renderPairs = () => {
    const partnersOf = (head) =>
      betType.ordered
        ? boats.filter((n) => n !== head)
        : boats.filter((n) => n > head);
    // 順不同の券種では、最大の艇番は相手が残らないためブロックを作らない
    const heads = boats.filter((head) => partnersOf(head).length > 0);
    const items = heads.map((head) => {
      const partners = partnersOf(head);
      return (
        <section className="rol-block" key={head}>
          <BlockHead n={head} name={nameByBoat.get(head)} />
          <div className="rol-rows">
            {partners.map((partner) =>
              oddsButton(
                `${head}-${partner}`,
                <BoatBadge n={partner} size="sm" />,
              ),
            )}
          </div>
        </section>
      );
    });
    const selectedHead = selectedKey ? Number(selectedKey.split("-")[0]) : null;
    return (
      <div className="rol-two-col-grid">
        {withPanelAfterRow(
          items,
          heads.indexOf(selectedHead),
          trendPanel(true),
        )}
      </div>
    );
  };

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
