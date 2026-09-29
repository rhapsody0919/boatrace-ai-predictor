/**
 * RaceOddsListTab - レース詳細ページ「オッズ一覧」タブ（BOA-311）
 *
 * 日和の「オッズ一覧」タブ相当。race_odds.trifecta_all/trio_all/exacta_all/
 * quinella_all/wide_all（jsonb、ADR-0054/0057、FR-4で全券種が本番稼働済み）と
 * 単勝・複勝（odds_win_N・odds_place_N_low/high）を使い、券種タブ切替×全組み合わせの
 * 常時表示×オッズ推移のドリルダウンを提供する。
 *
 * 表示は日和に合わせ、タップ不要で全通りの数字が見える構造にしている:
 * - 3連単: 1着ごとのブロック → 2着ごとの列 → 3着ごとの行（6艇なら全120通り）。
 *   列の下に、その2着の合成オッズと1着-2着の2連単オッズを表示する
 * - 3連複: 艇番3つの組み合わせを一覧（6艇なら全20通り）
 * - 2連単: 1着ごとのブロック → 2着ごとの行（6艇なら全30通り）
 * - 2連複/拡連複: 小さい方の艇番ごとのブロック → 相手艇ごとの行（全15通り）
 * - 単勝・複勝: 艇ごとの表（BOA-487）
 * 欠場艇は表から除く（「-」だけのブロック・列・行を出さない）。
 * オッズをタップするとその組み合わせのオッズ推移（スナップショット履歴）を表示する。
 *
 * ライブ取得（BOA-487）: 当日かつ締切90分前以内のレースは、タブを開いたときに公式の最新オッズを
 * /api/odds/live から取る（単勝・複勝と3連単を並列に。他の券種はチップを切り替えたときに）。以降は
 * 「更新」ボタンで取り直す（自動更新しない）。公式の応答は1ページ8〜10秒かかるため、先にスナップショットを
 * 出して「取得中… いまは○:○○取得の値」と示し、届いたら差し替える。失敗したらスナップショットのまま
 * 取得時刻を明示する。締切後・過去のレースはライブ取得しない。
 *
 * 票0（公式の「0.0」）は「票なし」と出す。締切前は票が少なく、1.0 など確定払戻と大きくずれる値が出る
 * （BOA-496）ため、ガイド文で注意する。
 *
 * 締切時オッズ（公式、BOA-496）: 締切後に Cron が公式の「締切時オッズ」表示を取り直して保存した値
 * （race_odds_final）がある券種は、表をその値だけで出す（締切直前の記録値と1つの表に混ぜない）。状態の1行は
 * 「締切時オッズ（公式）」、推移の最後の点は「締切時（公式）」（0分前の記録は推移から外す）。取れなかった
 * レース・券種は従来の表示（記録値と注記）のまま。
 *
 * 免責文言（BOA-311指示#1）: スクレイピング取得値のため、実際の投票内容は
 * 主催者発行のものと照合するよう明記する。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import {
  fetchLiveOdds,
  LIVE_PAGE_OF_BET_TYPE,
} from "../../services/liveOddsService";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";
import { parseRaceId } from "../../utils/raceId";
import InlineFetchError from "../InlineFetchError";
import "./RaceOddsListTab.css";

const BOAT_NUMBERS = [1, 2, 3, 4, 5, 6];

// ライブ取得の対象: 締切までこの時間以内の、当日のレース
const LIVE_WINDOW_MS = 90 * 60 * 1000;

// 券種定義。dataKeyはgetRaceOddsSnapshots（スナップショット行）と /api/odds/live の data の両方のキー。
// ordered=false（trio/quinella/wide）は艇番昇順ソート済みキー（ADR-0054）
const BET_TYPES = [
  { id: "trifecta", dataKey: "trifectaAll", ordered: true },
  { id: "trio", dataKey: "trioAll", ordered: false },
  { id: "exacta", dataKey: "exactaAll", ordered: true },
  { id: "quinella", dataKey: "quinellaAll", ordered: false },
  { id: "wide", dataKey: "wideAll", ordered: false, isRange: true },
  { id: "winPlace", dataKey: "win" },
].map((bt) => ({ ...bt, page: LIVE_PAGE_OF_BET_TYPE[bt.id] }));

// タブを開いたときに取るページ（単勝・複勝、3連単、3連単の表の「2単」に使う2連単）。
// 2連単を後回しにすると、3連単の表で「最新」の真下に古い2単が並ぶ（ファン評価1周目）
const INITIAL_LIVE_PAGES = ["tf", "3t", "2tf"];

const JST_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

// ISO文字列 → "8:04"（JST）
function formatJstTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : JST_TIME.format(date);
}

// 公式の「オッズ更新時間」（"08:14"）→ "8:14"
function formatOfficialTime(hhmm) {
  return hhmm ? hhmm.replace(/^0(\d)/, "$1") : null;
}

function todayJst(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** ライブ取得の対象か（当日かつ締切前90分以内） */
function isLiveOddsTarget(raceId, startTime, nowMs) {
  const parsed = parseRaceId(raceId);
  const deadline = getDeadlineDate(raceId, startTime);
  if (!parsed || !deadline || parsed.date !== todayJst(nowMs)) return false;
  const remaining = deadline.getTime() - nowMs;
  return remaining > 0 && remaining <= LIVE_WINDOW_MS;
}

// レンジ値（拡連複・複勝）は下限を代表値として使う（人気度＝色分けの基準として
// 下限の方が「最低でもこれだけ付く」という保守的な値のため）
function valueToNumber(value, isRange) {
  if (value == null) return null;
  return isRange ? value.low : value;
}

// 票0（公式の「0.0」）か
function isNoVotes(value, isRange) {
  return valueToNumber(value, isRange) === 0;
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

// 発走（締切）までの残り分数
function minutesBeforeOf(iso, deadline) {
  if (!deadline) return null;
  return Math.max(
    0,
    Math.round((deadline.getTime() - new Date(iso).getTime()) / 60000),
  );
}

// スナップショット履歴から指定キーの推移（発走までの残り分数付き）を作る。
// ライブ値があれば末尾に「最新 8:14」として足す（スナップショットが無くてもライブ値だけで出す）。
// 締切時オッズ（公式）の表（finalMap）があれば、0分前（締切直前）の記録を外し、末尾に「締切時（公式）」を足す
// （同じ時点を指す2つの値を並べない。記録は公式の更新の遅れを含むため）
function buildTrend(snapshots, betType, key, deadline, live, finalMap) {
  const points = snapshots
    .map((snap) => {
      const raw = snap[betType.dataKey]?.[key];
      if (raw == null) return null;
      return {
        minutesBefore: minutesBeforeOf(snap.capturedAt, deadline),
        value: raw,
      };
    })
    .filter(Boolean)
    .filter((p) => !finalMap || p.minutesBefore !== 0);
  if (finalMap) {
    const finalValue = finalMap[key];
    if (finalValue != null) points.push({ official: true, value: finalValue });
    return points;
  }
  const liveValue = live?.data?.[betType.dataKey]?.[key];
  if (liveValue != null) {
    // 時点はスナップショットと同じ「締切○分前」でそろえる（取得した時刻から数える。ファン評価2周目）
    points.push({
      live: true,
      minutesBefore: minutesBeforeOf(live.fetchedAt, deadline),
      value: liveValue,
    });
  }
  return points;
}

// 券種ごとに最新の「その券種の値を持つ」スナップショットを使う。全通り系5列は
// 個別取得で、最新行に選択中の券種だけnullのことがある（一部券種の取得失敗や
// FR-4以前のレース）ため、単純に末尾行を使うと表全体が空になる
// 単勝（win）はどの行でも艇番→値のオブジェクトが入る（全艇 null でも truthy）ため、値を1艇でも持つ最新行を
// 選ぶ。全ての行で全艇 null なら最新行（「票なし（または未取得）」の注記を出すため）
function latestSnapshotWith(snapshots, dataKey) {
  const reversed = [...snapshots].reverse();
  if (dataKey === "win") {
    return (
      reversed.find((s) => Object.values(s.win ?? {}).some((v) => v != null)) ??
      reversed[0] ??
      null
    );
  }
  return reversed.find((s) => s[dataKey]) ?? null;
}

// 出走艇。出走表（players）の艇から、欠場（直前情報の is_absent）の艇を除く。
// 加えて、オッズの表のどれかがあるのに、その艇を含むキーが1つも無い艇も除く（欠場の記録が無い
// 過去のレースで、欠場艇のブロックを「-」だけで出さないため）。票0（0）はキーがある扱い
// （値の大小では判定しない。票0の艇を欠場と取り違えないため）
function activeBoatsOf({ players, absentBoats, maps }) {
  const listed = [
    ...new Set((players ?? []).map((p) => Number(p.number))),
  ].filter((n) => BOAT_NUMBERS.includes(n));
  const base = listed.length > 0 ? listed.sort((a, b) => a - b) : BOAT_NUMBERS;
  const present = new Set();
  let anyMap = false;
  for (const map of maps) {
    if (!map) continue;
    anyMap = true;
    for (const [key, value] of Object.entries(map)) {
      if (value != null) key.split("-").forEach((n) => present.add(Number(n)));
    }
  }
  return base.filter((n) => !absentBoats.has(n) && (!anyMap || present.has(n)));
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

// 小さな折れ線スパークライン（MotorWakuStatsGridと同じ発想のインラインSVG）。
// 末尾がライブ値なら、その点を別色で打つ
function Sparkline({ points, isRange }) {
  if (points.length < 2) return null;
  const nums = points.map((p) => valueToNumber(p.value, isRange));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const width = 200;
  const height = 40;
  const xy = nums.map((v, i) => [
    (i / (nums.length - 1)) * width,
    height - ((v - min) / range) * height,
  ]);
  const coords = xy
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const last = xy[xy.length - 1];
  // 末尾が締切時オッズ（公式）なら、最後の区間を点線にし、点を青で打つ（記録の推移と別の時点・出どころのため）
  if (points[points.length - 1].official) {
    const prev = xy[xy.length - 2];
    const recorded = xy
      .slice(0, -1)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    return (
      <svg
        className="rol-sparkline"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="odds-trend-sparkline"
      >
        {xy.length > 2 && (
          <polyline points={recorded} fill="none" strokeWidth="2" />
        )}
        <line
          className="rol-sparkline-official-line"
          x1={prev[0]}
          y1={prev[1]}
          x2={last[0]}
          y2={last[1]}
          strokeWidth="2"
        />
        <circle
          className="rol-sparkline-official"
          cx={last[0]}
          cy={last[1]}
          r="3"
        />
      </svg>
    );
  }
  return (
    <svg
      className="rol-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={coords} fill="none" strokeWidth="2" />
      {points[points.length - 1].live && (
        <circle
          className="rol-sparkline-live"
          cx={last[0]}
          cy={last[1]}
          r="3"
        />
      )}
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
  const { t } = useTranslation();
  const noVotes = isNoVotes(value, isRange);
  const bucket = heatBucket(valueToNumber(value, isRange));
  const text = noVotes
    ? t("oddsList.noVotes")
    : (formatValue(value, isRange) ?? "-");
  return (
    <button
      type="button"
      className={`rol-odds${bucket !== null ? ` rol-heat-${bucket}` : ""}${noVotes ? " is-no-votes" : ""}${selected ? " is-selected" : ""}`}
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
  const labelOf = (p) => {
    if (p.official) return t("oddsList.finalTrendLabel");
    if (p.live) {
      return p.minutesBefore === null
        ? t("oddsList.liveLatest")
        : t("oddsList.liveTrendLabel", { n: p.minutesBefore });
    }
    if (p.minutesBefore === null) return "-";
    if (p.minutesBefore === 0) return t("oddsList.deadlineLabel");
    return t("oddsList.minutesBeforeLabel", { n: p.minutesBefore });
  };
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
              <div
                className={`rol-trend-item${p.live ? " is-live" : ""}${p.official ? " is-official" : ""}`}
                key={i}
              >
                <div className="rol-trend-value">
                  {isNoVotes(p.value, isRange)
                    ? t("oddsList.noVotes")
                    : formatValue(p.value, isRange)}
                </div>
                <div className="rol-trend-label">{labelOf(p)}</div>
              </div>
            ))}
          </div>
          {trend.some((p) => p.official) && (
            <p className="rol-trend-note" data-testid="odds-trend-note">
              {t("oddsList.finalTrendNote")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// 締切時オッズ（公式）を表示しているときの状態の1行（BOA-496）。更新ボタンは出さない（値はもう変わらない）
function FinalStatus({ deadline }) {
  const { t } = useTranslation();
  const time = deadline ? formatJstTime(deadline.toISOString()) : null;
  return (
    <div
      className="rol-status is-official"
      data-testid="odds-live-status"
      data-state="final"
    >
      <span className="rol-official-dot" aria-hidden="true" />
      <span className="rol-status-strong">{t("oddsList.finalOfficial")}</span>
      {time && <b>{t("oddsList.finalDeadlineAt", { time })}</b>}
      <span className="rol-status-sub">{t("oddsList.finalSource")}</span>
    </div>
  );
}

// スナップショットの取得時刻の説明（「8:04 取得（発走30分前）」「締切時点 8:58 取得」）
function snapshotLabel(t, snapshot, deadline) {
  const time = formatJstTime(snapshot.capturedAt);
  const n = minutesBeforeOf(snapshot.capturedAt, deadline);
  if (n === 0) return t("oddsList.snapshotAtDeadline", { time });
  if (n === null) return t("oddsList.snapshotAt", { time });
  return t("oddsList.snapshotBefore", { time, n });
}

// ライブ取得の状態の1行（取得中・最新・失敗）。スナップショットだけのときは取得時刻の注記
function LiveStatus({ entry, fallbackLabel, onRefresh }) {
  const { t } = useTranslation();
  if (!entry) {
    // DB のスナップショットは「取得した時点の公式表示」。公式のオッズ更新は数分遅れることがあり、
    // 締切直前に取った値でも締切時オッズとは一致しない（BOA-496、ファン評価1周目）
    return fallbackLabel ? (
      <div className="rol-status is-snapshot" data-testid="odds-live-status">
        <span>{t("oddsList.snapshotValues", { label: fallbackLabel })}</span>
        <span className="rol-status-sub">{t("oddsList.snapshotLagNote")}</span>
      </div>
    ) : null;
  }
  const liveLabel = entry.result
    ? t("oddsList.liveValueLabel", {
        time:
          formatOfficialTime(entry.result.officialUpdatedAt) ??
          formatJstTime(entry.result.fetchedAt),
      })
    : fallbackLabel;
  if (entry.status === "loading") {
    return (
      <div
        className="rol-status is-loading"
        role="status"
        data-testid="odds-live-status"
      >
        <span className="rol-spinner" aria-hidden="true" />
        <span>
          {liveLabel
            ? t("oddsList.liveLoadingWith", { label: liveLabel })
            : t("oddsList.liveLoading")}
        </span>
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <div
        className="rol-status is-error"
        role="alert"
        data-testid="odds-live-status"
      >
        <span>{t("oddsList.liveFailed", { label: liveLabel })}</span>
        <button type="button" className="rol-status-btn" onClick={onRefresh}>
          {t("oddsList.liveRetry")}
        </button>
      </div>
    );
  }
  const { result } = entry;
  return (
    <div className="rol-status is-live" data-testid="odds-live-status">
      <span className="rol-live-dot" aria-hidden="true" />
      <span className="rol-status-strong">
        {result.final ? t("oddsList.liveFinal") : t("oddsList.liveLatest")}
      </span>
      {/* 取得した時刻を主に出す。取得中の「いまは○:○○取得の値」から時刻が戻ったように見えないよう、
          公式の「オッズ更新時間」は補足にする（ファン評価2周目） */}
      <b>
        {t("oddsList.fetchedAt", { time: formatJstTime(result.fetchedAt) })}
      </b>
      {result.officialUpdatedAt && (
        <span className="rol-status-sub">
          {t("oddsList.officialUpdated")}{" "}
          {formatOfficialTime(result.officialUpdatedAt)}
        </span>
      )}
      {entry.unchanged && (
        <span className="rol-status-sub" data-testid="odds-live-unchanged">
          {t("oddsList.liveUnchanged")}
        </span>
      )}
      {!result.final && (
        <button type="button" className="rol-status-btn" onClick={onRefresh}>
          {t("oddsList.liveRefresh")}
        </button>
      )}
    </div>
  );
}

function RaceOddsListTab({ raceId, raceStartTime, players }) {
  const { t } = useTranslation();
  // スナップショット（DB）の取得結果。raceId とセットで持つ（frontend-data-fetch.md §3）
  const [snapshotState, setSnapshotState] = useState(null);
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  // 欠場艇（直前情報の is_absent）
  const [absentState, setAbsentState] = useState(null);
  // タブを開いた時刻でライブ取得の対象かを決める（表示中に締切を過ぎても、開いた時点の判断を保つ）
  const [openedAtMs] = useState(() => Date.now());
  const liveEnabled = isLiveOddsTarget(raceId, raceStartTime, openedAtMs);
  // ライブ取得の結果（page → {status, result, requestId}）。result は直近の成功（取り直し中・失敗時も保持）。
  // 開いたときに取るページは、初期値から loading にしておく（効果の中で同期的に setState しないため）。
  // requestId は、取り直しが重なったときに最後の要求の結果だけを使うための番号
  const [liveState, setLiveState] = useState(() => ({
    raceId,
    pages: liveEnabled
      ? Object.fromEntries(
          INITIAL_LIVE_PAGES.map((p, i) => [
            p,
            { status: "loading", result: null, requestId: i + 1 },
          ]),
        )
      : {},
  }));
  const requestSeq = useRef(INITIAL_LIVE_PAGES.length);
  const mounted = useRef(true);
  // 初回取得を1回だけにする（開発時の StrictMode は効果を2回走らせ、公式へ同じページを2回取りに行くため）
  const initialFetchStarted = useRef(false);
  const [betTypeId, setBetTypeId] = useState(BET_TYPES[0].id);
  // 推移を表示中の組み合わせキー（券種内で一意。例: "1-2-3"）
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // PredictionPanel側でRaceTabsに`key={analysisRaceId}`を付けているため、
  // レースが変わるとこのコンポーネント自体が再マウントされ、stateは自然に
  // 初期化される（react-hooks/set-state-in-effect: 効果本体での同期的なsetState呼び出しを
  // 避け、非同期コールバック内でのみ呼ぶ）
  useEffect(() => {
    let cancelled = false;
    if (!raceId) return undefined;
    // 締切時オッズ（公式、BOA-496）も同時に取る。どちらかの失敗は「データなし」にせず、まとめて再取得できるようにする
    Promise.all([
      supabaseDataService.getRaceOddsSnapshots(raceId),
      supabaseDataService.getRaceFinalOdds(raceId),
    ])
      .then(([data, final]) => {
        if (!cancelled) {
          setSnapshotState({ raceId, data, final, failed: false });
        }
      })
      .catch((err) => {
        // 取得失敗を「データなし」にしない。失敗として持ち、再取得できるようにする
        console.error("オッズ一覧取得エラー:", err?.message ?? String(err));
        if (!cancelled) setSnapshotState({ raceId, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, snapshotReloadKey]);

  useEffect(() => {
    let cancelled = false;
    if (!raceId) return undefined;
    supabaseDataService
      .getRaceMotorMaintenanceBreakdown(raceId)
      // 戻り値は { state, rows }（BOA-497）。欠場は state によらず rows の is_absent で見る
      .then(({ rows }) => {
        if (cancelled) return;
        const absent = rows
          .filter((r) => r.is_absent === true)
          .map((r) => Number(r.boat_number));
        setAbsentState({ raceId, absent, failed: false });
      })
      .catch((err) => {
        // 欠場の判定は補助（出走表とオッズのキーでも判定できる）。取れなくても表は出す
        console.error("欠場情報の取得エラー:", err?.message ?? String(err));
        if (!cancelled) setAbsentState({ raceId, absent: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // ページ1つをライブ取得する。状態は非同期のコールバックでだけ更新する
  const runLiveFetch = (page, requestId) => {
    const settle = (patch) => {
      if (!mounted.current) return;
      setLiveState((prev) => {
        const current = prev.pages[page];
        // 取り直しが重なったときは、最後に始めた要求の結果だけを使う
        if (current?.requestId !== requestId) return prev;
        return {
          ...prev,
          pages: {
            ...prev.pages,
            [page]: {
              ...current,
              ...(typeof patch === "function" ? patch(current) : patch),
            },
          },
        };
      });
    };
    fetchLiveOdds(raceId, page)
      .then((result) =>
        // 取り直しても CDN（30秒）から同じ応答が返ると見た目が変わらないため、「変化なし」を出す
        settle((current) => ({
          status: "ok",
          result,
          unchanged:
            current?.result?.fetchedAt != null &&
            current.result.fetchedAt === result.fetchedAt,
        })),
      )
      .catch((err) => {
        // 失敗は state に持つ（スナップショットへのフォールバックと「取得に失敗しました」を出す）
        console.error(
          `オッズのライブ取得エラー（${page}）:`,
          err?.message ?? String(err),
        );
        settle({ status: "error" });
      });
  };

  // チップの切り替え・「更新」ボタンから呼ぶ（イベントハンドラ）
  const startLiveFetch = (page) => {
    const requestId = ++requestSeq.current;
    setLiveState((prev) => ({
      ...prev,
      pages: {
        ...prev.pages,
        [page]: {
          result: prev.pages[page]?.result ?? null,
          status: "loading",
          requestId,
        },
      },
    }));
    runLiveFetch(page, requestId);
  };

  // 開いたときの初回取得（単勝・複勝と3連単を並列に）。以降は「更新」ボタンで取り直す（自動更新しない）
  useEffect(() => {
    if (!liveEnabled || initialFetchStarted.current) return;
    initialFetchStarted.current = true;
    INITIAL_LIVE_PAGES.forEach((page, i) => runLiveFetch(page, i + 1));
    // 開いたときの1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const betType = BET_TYPES.find((b) => b.id === betTypeId) ?? BET_TYPES[0];
  const livePages = liveState.raceId === raceId ? liveState.pages : {};

  const selectBetType = (id) => {
    setBetTypeId(id);
    setSelectedKey(null);
    const page = BET_TYPES.find((b) => b.id === id)?.page;
    if (liveEnabled && page && !livePages[page]) startLiveFetch(page);
  };

  // 同じ組み合わせを再タップすると推移を閉じる
  const toggleSelected = (key) =>
    setSelectedKey((prev) => (prev === key ? null : key));

  const snapshots =
    snapshotState?.raceId === raceId && !snapshotState.failed
      ? snapshotState.data
      : null;
  const snapshotsFailed =
    snapshotState?.raceId === raceId && snapshotState.failed;
  const snapshotsLoading = !snapshots && !snapshotsFailed;
  const finalOdds =
    snapshotState?.raceId === raceId && !snapshotState.failed
      ? (snapshotState.final ?? null)
      : null;
  const absentBoats = new Set(
    absentState?.raceId === raceId ? absentState.absent : [],
  );

  const liveEntry = liveEnabled ? (livePages[betType.page] ?? null) : null;
  // 締切時オッズ（公式）がこの券種にあれば、表・推移をその値で出す（ライブ取得・スナップショットより優先）
  const finalMap = finalOdds?.[betType.dataKey] ?? null;
  const useFinal = !!finalMap;
  const liveResult = useFinal ? null : (liveEntry?.result ?? null);
  const deadline = getDeadlineDate(raceId, raceStartTime);
  const isRange = !!betType.isRange;

  const latestSnapshot = snapshots
    ? latestSnapshotWith(snapshots, betType.dataKey)
    : null;
  const fallbackLabel = latestSnapshot
    ? snapshotLabel(t, latestSnapshot, deadline)
    : null;

  // 表示する値: 締切時オッズ（公式）があればそれ、無ければライブ値、無ければ最新スナップショット
  const latestMap = useFinal
    ? finalMap
    : liveResult
      ? (liveResult.data?.[betType.dataKey] ?? null)
      : (latestSnapshot?.[betType.dataKey] ?? null);
  const placeMap =
    betType.id === "winPlace"
      ? useFinal
        ? (finalOdds.place ?? null)
        : liveResult
          ? (liveResult.data?.place ?? null)
          : (latestSnapshot?.place ?? null)
      : null;

  // 出走艇（全券種の最新値＋ライブ値のキーから、欠場の記録が無い過去レースの欠場艇を除く）
  const boats = activeBoatsOf({
    players,
    absentBoats,
    maps: [
      ...BET_TYPES.filter((bt) => bt.id !== "winPlace").map(
        (bt) =>
          (snapshots &&
            latestSnapshotWith(snapshots, bt.dataKey)?.[bt.dataKey]) ??
          null,
      ),
      ...Object.values(livePages).flatMap((entry) =>
        Object.entries(entry.result?.data ?? {})
          .filter(([key]) => key !== "win" && key !== "place")
          .map(([, map]) => map),
      ),
      ...BET_TYPES.filter((bt) => bt.id !== "winPlace").map(
        (bt) => finalOdds?.[bt.dataKey] ?? null,
      ),
    ],
  });

  // 当日・締切前で、まだライブ取得の対象（締切90分前以内）に入っていないレースだけ、公式のオッズへの導線を出す
  const parsedRace = parseRaceId(raceId);
  const beforeLiveWindow =
    !liveEnabled &&
    !!parsedRace &&
    !!deadline &&
    parsedRace.date === todayJst(openedAtMs) &&
    deadline.getTime() > openedAtMs;
  const officialOddsUrl = beforeLiveWindow
    ? `https://www.boatrace.jp/owpc/pc/race/oddstf?rno=${parsedRace.raceNo}&jcd=${String(parsedRace.venueCode).padStart(2, "0")}&hd=${parsedRace.date.replace(/-/g, "")}`
    : null;

  const retrySnapshots = () => {
    setSnapshotState(null);
    setSnapshotReloadKey((k) => k + 1);
  };
  const refreshLive = () => startLiveFetch(betType.page);

  const header = (
    <>
      <p className="rol-subtitle">{t("oddsList.subtitle")}</p>
      <p className="rol-disclaimer">⚠️ {t("oddsList.disclaimer")}</p>
    </>
  );

  // ライブ取得しないレース: 従来どおりスナップショットだけで出す
  if (!liveEnabled) {
    if (snapshotsLoading) {
      return (
        <div className="race-odds-list-tab">
          <p className="rol-subtitle">{t("oddsList.subtitle")}</p>
          <p className="rol-no-data">{t("oddsList.loading")}</p>
        </div>
      );
    }
    if (snapshotsFailed) {
      return (
        <div className="race-odds-list-tab">
          {header}
          <InlineFetchError
            message={t("oddsList.fetchFailed")}
            onRetry={retrySnapshots}
          />
        </div>
      );
    }
    if (snapshots.length === 0 && !finalOdds) {
      return (
        <div className="race-tabs-empty">
          <p>{t("oddsList.emptyTitle")}</p>
          <p className="race-tabs-empty-body">{t("oddsList.emptyBody")}</p>
          {/* 当日で締切90分より前: 公式には朝からオッズが出ているため、いつ出るかと公式への導線を示す
              （ファン評価2周目） */}
          {officialOddsUrl && (
            <p
              className="race-tabs-empty-body"
              data-testid="odds-before-window"
            >
              {t("oddsList.liveFromNote")}{" "}
              <a
                href={officialOddsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("oddsList.officialOddsLink")}
              </a>
            </p>
          )}
        </div>
      );
    }
  }

  const nameByBoat = new Map(
    (players ?? []).map((p) => [p.number, p.name?.replace(/\s+/g, "")]),
  );

  // スナップショットは保存時に票0（公式の0.0）を捨てている（cron の解析）。券種の表がある以上、出走艇の
  // 組み合わせでキーが無いのは票0なので、ライブ値と同じく「票なし」として出す（ファン評価1周目）
  // レンジ型（拡連複）は {low:0, high:0} で表す（数値の 0 を渡すと formatValue が落ちる。ファン評価2周目 P0）
  // 締切時オッズ（公式）は票0を 0 のまま保存しているため、キーが無いのは欠場・未発売（「-」）
  const valueOf = (key) =>
    latestMap?.[key] ??
    (latestMap && !liveResult && !useFinal
      ? isRange
        ? { low: 0, high: 0 }
        : 0
      : null);

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
        trend={buildTrend(
          snapshots ?? [],
          betType,
          selectedKey,
          deadline,
          liveResult,
          useFinal ? finalMap : null,
        )}
        isRange={isRange}
        spanAll={spanAll}
      />
    ) : null;

  // 3連単: 1着ブロック → 2着列 → 3着行（＋合成オッズ・2連単オッズ）
  const renderTrifecta = () => {
    // 2連単オッズは、3連単と同じ時点の値を使う（別時刻の値が同じ列に並ばないように）。
    // ライブ表示中は2連単のライブ値（取得済みなら）、スナップショット表示中は同じ行の値
    // （2連単のページはチップを切り替えるまで取らないため、未取得の間はスナップショットの値を出す）
    // スナップショットの2連単でキーが無い組は、保存時に落ちた票0（セルと同じく「票なし」）
    // 締切時オッズ（公式）の表では、2連単も締切時オッズだけを使う（取れていなければ「-」。記録値を混ぜない）
    const liveResult2tf = !!(liveResult && livePages["2tf"]?.result);
    const exactaMap = useFinal
      ? (finalOdds.exactaAll ?? null)
      : ((liveResult ? livePages["2tf"]?.result?.data?.exactaAll : null) ??
        latestSnapshot?.exactaAll ??
        null);
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
                    <span>
                      {exacta === 0 ||
                      (exacta === null &&
                        exactaMap &&
                        !liveResult2tf &&
                        !useFinal)
                        ? t("oddsList.noVotes")
                        : (formatValue(exacta) ?? "-")}
                    </span>
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

  // 単勝・複勝: 艇ごとの表。票0（公式の0.0）は「票なし」。スナップショットの null は、票0と未取得を
  // 保存時に区別していない（scrape-odds.js が 0.0 を null にし、取得漏れも null）。実際に、公式の締切時
  // オッズが27.3の艇が全行 null だった例がある（江戸川8R 9/28、ファン評価1・2周目で同じ指摘）。
  // 「票なし」と断定せず「-」とし、注記で「票なし（または未取得）」と説明する
  const renderWinPlace = () => {
    const winOf = (n) => latestMap?.[String(n)] ?? null;
    const placeOf = (n) => placeMap?.[String(n)] ?? null;
    const snapshotHasNull =
      !liveResult &&
      !useFinal &&
      boats.some((n) => winOf(n) === null || placeOf(n) === null);
    const cell = (value, range) => {
      if (value == null) return "-";
      if (isNoVotes(value, range)) {
        return <span className="rol-no-votes">{t("oddsList.noVotes")}</span>;
      }
      return formatValue(value, range);
    };
    return (
      <>
        <table className="rol-win-table">
          <thead>
            <tr>
              <th scope="col">{t("oddsList.boatColumn")}</th>
              <th scope="col">{t("result.payoutType.win")}</th>
              <th scope="col">{t("result.payoutType.place")}</th>
            </tr>
          </thead>
          <tbody>
            {boats.map((n) => (
              <tr key={n}>
                <th scope="row">
                  <span className="rol-win-boat">
                    <BoatBadge n={n} />
                    {nameByBoat.get(n) && (
                      <span className="rol-block-name" translate="no">
                        {nameByBoat.get(n)}
                      </span>
                    )}
                  </span>
                </th>
                <td>{cell(winOf(n), false)}</td>
                <td>{cell(placeOf(n), true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {snapshotHasNull && (
          <p className="rol-callout">{t("oddsList.winNoVotesOrMissing")}</p>
        )}
      </>
    );
  };

  // 表示中の値が全て票0か（締切前の早い時間に起きる）
  const allNoVotes =
    latestMap &&
    Object.keys(latestMap).length > 0 &&
    Object.values(latestMap).every((v) => isNoVotes(v, isRange));

  const liveFailedWithoutData =
    liveEnabled && liveEntry?.status === "error" && !liveResult && !latestMap;

  const renderBody = () => {
    if (liveFailedWithoutData) {
      return (
        <InlineFetchError
          message={t("oddsList.liveFailedNoData")}
          onRetry={refreshLive}
        />
      );
    }
    if (!latestMap) {
      if (liveEntry?.status === "loading" || snapshotsLoading) return null;
      if (snapshotsFailed && !liveEnabled) return null;
      return <p className="rol-no-data">{t("oddsList.noBetTypeData")}</p>;
    }
    return (
      <>
        <p className="rol-guide">{t(`oddsList.guide.${betType.id}`)}</p>
        {allNoVotes && (
          <p className="rol-callout">
            {betType.id === "winPlace"
              ? t("oddsList.winAllNoVotes")
              : t("oddsList.allNoVotes")}
          </p>
        )}
        {betType.id === "trifecta" && renderTrifecta()}
        {betType.id === "trio" && renderTrio()}
        {betType.id === "winPlace" && renderWinPlace()}
        {["exacta", "quinella", "wide"].includes(betType.id) && renderPairs()}
        {betType.id !== "winPlace" && (
          <p className="rol-legend">💡 {t("oddsList.legend")}</p>
        )}
      </>
    );
  };

  return (
    <div className="race-odds-list-tab">
      {header}

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
            {bt.id === "winPlace"
              ? t("oddsList.winPlaceChip")
              : t(`result.payoutType.${bt.id}`)}
          </button>
        ))}
      </div>

      {useFinal ? (
        <FinalStatus deadline={deadline} />
      ) : (
        !liveFailedWithoutData && (
          <LiveStatus
            entry={liveEntry}
            fallbackLabel={fallbackLabel}
            onRefresh={refreshLive}
          />
        )
      )}
      {renderBody()}
    </div>
  );
}

export default RaceOddsListTab;
