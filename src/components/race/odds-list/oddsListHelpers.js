// オッズ一覧タブの定数と純粋な補助関数（RaceOddsListTab.jsx から移しただけ。字は変えていない）
import { LIVE_PAGE_OF_BET_TYPE } from "../../../services/liveOddsService";
import { getDeadlineDate } from "../../../utils/raceDeadlineStatus";
import { parseRaceId } from "../../../utils/raceId";
import { formatOdds } from "../../../utils/oddsMath";

export const BOAT_NUMBERS = [1, 2, 3, 4, 5, 6];

// ライブ取得の対象: 締切までこの時間以内の、当日のレース
export const LIVE_WINDOW_MS = 90 * 60 * 1000;
// 締切時オッズ（公式）を取り直す期間。締切の5分後から、最大60分後まで（api/cron/odds-final.js）
export const FINAL_ODDS_WINDOW_MS = 60 * 60 * 1000;
// 締切時オッズ（公式）の保存を始めた日（odds_final=live、BOA-496）。これより前のレースは取得していないため、
// 「取得できませんでした」と書かない
export const FINAL_ODDS_SINCE = "2026-09-29";

// 券種定義。dataKeyはgetRaceOddsSnapshots（スナップショット行）と /api/odds/live の data の両方のキー。
// ordered=false（trio/quinella/wide）は艇番昇順ソート済みキー（ADR-0054）
export const BET_TYPES = [
  { id: "trifecta", dataKey: "trifectaAll", ordered: true },
  { id: "trio", dataKey: "trioAll", ordered: false },
  { id: "exacta", dataKey: "exactaAll", ordered: true },
  { id: "quinella", dataKey: "quinellaAll", ordered: false },
  { id: "wide", dataKey: "wideAll", ordered: false, isRange: true },
  { id: "winPlace", dataKey: "win" },
].map((bt) => ({ ...bt, page: LIVE_PAGE_OF_BET_TYPE[bt.id] }));

// タブを開いたときに取るページ（単勝・複勝、3連単、3連単の表の「2単」に使う2連単）。
// 2連単を後回しにすると、3連単の表で「最新」の真下に古い2単が並ぶ（ファン評価1周目）
export const INITIAL_LIVE_PAGES = ["tf", "3t", "2tf"];

const JST_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

// ISO文字列 → "8:04"（JST）
export function formatJstTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : JST_TIME.format(date);
}

// 公式の「オッズ更新時間」（"08:14"）→ "8:14"
export function formatOfficialTime(hhmm) {
  return hhmm ? hhmm.replace(/^0(\d)/, "$1") : null;
}

export function todayJst(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** ライブ取得の対象か（当日かつ締切前90分以内） */
export function isLiveOddsTarget(raceId, startTime, nowMs) {
  const parsed = parseRaceId(raceId);
  const deadline = getDeadlineDate(raceId, startTime);
  if (!parsed || !deadline || parsed.date !== todayJst(nowMs)) return false;
  const remaining = deadline.getTime() - nowMs;
  return remaining > 0 && remaining <= LIVE_WINDOW_MS;
}

// レンジ値（拡連複・複勝）は下限を代表値として使う（人気度＝色分けの基準として
// 下限の方が「最低でもこれだけ付く」という保守的な値のため）
export function valueToNumber(value, isRange) {
  if (value == null) return null;
  return isRange ? value.low : value;
}

// 票0（公式の「0.0」）か
export function isNoVotes(value, isRange) {
  return valueToNumber(value, isRange) === 0;
}

export function formatValue(value, isRange) {
  if (value == null) return null;
  return isRange
    ? `${formatOdds(value.low)}-${formatOdds(value.high)}`
    : formatOdds(value);
}

// オッズ値をヒートマップの濃淡バケット(0〜4、4が最も人気=オッズが低い)に変換
export function heatBucket(numericValue) {
  if (numericValue == null || numericValue <= 0) return null;
  const intensity = Math.max(
    0,
    Math.min(1, 1 - Math.log10(numericValue) / 2.4),
  );
  return Math.min(4, Math.floor(intensity * 5));
}

// 発走（締切）までの残り分数
export function minutesBeforeOf(iso, deadline) {
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
// 取得から何分たったら「最新」をやめて「○分前の値」と書くか（自動では取り直さないため、表示だけ言い換える。
// BOA-532）
export const LIVE_STALE_MS = 3 * 60 * 1000;

// ライブ取得した値の鮮度。状態の1行と推移パネルの最後の点で同じ判断を使う（ファン評価2周目: 状態の1行が
// 「○分前の値」「締切済み」になっても、推移の最後の点が緑の「最新」のままだった）
//   final: 公式の締切時オッズ / after-deadline: 締切前に取った値で、いまは締切後 /
//   after-deadline-pending: 締切後に取ったが、公式がまだ締切時オッズになっていない / stale / fresh
export function liveFreshnessOf(result, nowMs, deadline) {
  if (result.final) return "final";
  const fetchedMs = Date.parse(result.fetchedAt);
  if (deadline && nowMs >= deadline.getTime()) {
    return fetchedMs >= deadline.getTime()
      ? "after-deadline-pending"
      : "after-deadline";
  }
  return nowMs - fetchedMs >= LIVE_STALE_MS ? "stale" : "fresh";
}

export function buildTrend(
  snapshots,
  betType,
  key,
  deadline,
  live,
  finalMap,
  liveFreshness,
) {
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
  if (liveValue == null) return points;
  // ライブで取れた公式の締切時オッズは、DB の締切時オッズと同じ「締切時（公式）」の点にする（0分前の記録は外す）
  if (liveFreshness === "final") {
    return [
      ...points.filter((p) => p.minutesBefore !== 0),
      { official: true, value: liveValue },
    ];
  }
  // 締切後に取った値（公式がまだ締切時オッズでない）は「締切○分前」で表せないため、取得時刻で書く
  if (liveFreshness === "after-deadline-pending") {
    points.push({ atTime: formatJstTime(live.fetchedAt), value: liveValue });
    return points;
  }
  // 時点はスナップショットと同じ「締切○分前」でそろえる（取得した時刻から数える。ファン評価2周目）。
  // 緑の「最新」は、状態の1行が「最新」のあいだだけ
  points.push({
    live: liveFreshness === "fresh",
    minutesBefore: minutesBeforeOf(live.fetchedAt, deadline),
    value: liveValue,
  });
  return points;
}

// 出走艇。出走表（players）の艇から、欠場（直前情報の is_absent）の艇を除く。
// 加えて、オッズの表のどれかがあるのに、その艇を含むキーが1つも無い艇も除く（欠場の記録が無い
// 過去のレースで、欠場艇のブロックを「-」だけで出さないため）。票0（0）はキーがある扱い
// （値の大小では判定しない。票0の艇を欠場と取り違えないため）
export function activeBoatsOf({ players, absentBoats, maps }) {
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
export function triosOf(boats) {
  return boats.flatMap((a) =>
    boats
      .filter((b) => b > a)
      .flatMap((b) => boats.filter((c) => c > b).map((c) => [a, b, c])),
  );
}

// グリッドで、選択中の要素の直後に推移パネルを挿入する。パネルは全幅（rol-span-all）で、グリッドの
// grid-auto-flow: dense により、同じ行の残りの要素が前に詰まってパネルはその行の下に出る。列数（画面幅で
// 1〜4列に変わる）によらず「選んだ行の直後」になる（BOA-530）
export function withPanelAfter(items, selectedIdx, panel) {
  if (selectedIdx < 0 || !panel) return items;
  return [
    ...items.slice(0, selectedIdx + 1),
    panel,
    ...items.slice(selectedIdx + 1),
  ];
}

// 文字列のおおよその幅（em）。全角（漢字・かな・ハングル）は1em、それ以外（数字・英字・記号）は0.65em
// （太字の数字は約0.6em。1000倍以上を小数なしにして文字数が減ると見積もりの余裕も減るため、少し広めに取る。BOA-577）
export const approxEm = (text) =>
  [...text].reduce(
    (sum, ch) =>
      sum + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.65),
    0,
  );

// 画面に出す組番の書き方。キーは券種によらず "1-2-3" だが、順不同の券種（3連複・2連複・拡連複）は
// 結果タブの払戻と同じく "1=2=3" と書く（BOA-552）
export const comboLabel = (comboKey, ordered) =>
  ordered ? comboKey : comboKey.replaceAll("-", "=");

// スナップショットの取得時刻の説明（「8:04 取得（発走30分前）」「締切時点 8:58 取得」）
export function snapshotLabel(t, snapshot, deadline) {
  const time = formatJstTime(snapshot.capturedAt);
  const n = minutesBeforeOf(snapshot.capturedAt, deadline);
  if (n === 0) return t("oddsList.snapshotAtDeadline", { time });
  if (n === null) return t("oddsList.snapshotAt", { time });
  return t("oddsList.snapshotBefore", { time, n });
}
