/**
 * RaceBasicInfoTab - レース詳細ページ「基本情報」タブ（BOA-306）
 *
 * 日和の期間別グリッド（勝率×7区分の数値羅列）をそのまま模倣せず、6艇の
 * 横棒グラフで「どの条件で調子が良いか」を直感的に見せる
 * （[[feedback_ui_visualization_over_statistical_rigor]]の方針）。
 *
 * データソースは2系統:
 * 1. 期間=今期 かつ グレード=全レースの場合（勝率/2連対率/3連対率のみ）:
 *    race_entriesの公式集計済み値（win_rate/local_win_rate/global_2rate/
 *    local_2rate/global_3rate/local_3rate）をそのまま使う。boatrace.jp側で
 *    算出済みの正確な値のため、自社で集計し直す必要が無い
 * 2. それ以外（グレード・期間で絞り込む場合、および平均STは常に）:
 *    getRacerScopedRaceStats(racerId)で選手の過去2年分の出走履歴を取得し、
 *    クライアント側でフィルタ・集計する（basicInfoStats.js）。平均STには
 *    公式集計値の相当品が無いため常にこちら（2026-09-16、レビュー指摘#1で
 *    平均STも会場/グレードでフィルタできるよう対応）。対象は表示中の6選手のみ
 *    （1選手×該当レースのみのライブ集計であり、BOA-303が問題視する
 *    全選手×全会場の横断集計とはスコープが異なる）
 *
 * 「得意会場」ドリルダウンは、上記2と同じgetRacerScopedRaceStatsの生データを
 * 会場別に集計し、現在選択中の指標でランキングする（2026-09-16、レビュー
 * 指摘#3で固定指標(勝率)から選択中指標に連動するよう変更。以前使っていた
 * getRacerVenueStatsは廃止）
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import { supabaseDataService } from "../../services/supabaseDataService";
import { parseRaceId } from "../../utils/raceId";
import RecentRunsTable from "./RecentRunsTable";
import {
  filterRecords,
  computeRates,
  getRecentRaces,
  computeVenueRanking,
  buildConditionRows,
  pickPeriodStats,
  periodDiff,
  periodDiffShownFrom,
  SMALL_SAMPLE_THRESHOLD,
  WAVE_EXCLUDED_VENUE_CODES,
  recordsBeforeRace,
} from "./basicInfoStats";
import InlineFetchError from "../InlineFetchError";
import FlyingBadge from "./FlyingBadge";
import { bestOf } from "../../utils/bestOf";
import {
  ACCIDENT_BADGE_MIN_STARTS,
  computeAccidentStats,
} from "../../utils/accidentRate";
import "./RaceBasicInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate", "avgSt"];
// 「直近◯走」の件数。今節タブ（FR-3）と内容が重なりすぎたため5→10にした
// （2026-09-26ユーザーフィードバック。今節は節の区切りで、こちらは節をまたぐ流れを見る）
const RECENT_RACES_COUNT = 10;
const GRADES = ["all", "ippan", "sgg1"];
// 期間フィルタ（PERIODS）に「初日」「最終日」は**足さない**。2026-09-15時点では
// 判定に使うrace_conditions.series_day/is_final_dayが全件nullだったため削除した
// 経緯があるが、この2列は現在99.9%埋まっている（2026-09-28実測、2026-02-01以降
// 36,607/36,629行＝99.94%。残る22行は当日＝スクレイプ前の分）。それでも
// 足さない理由は2つで、いずれもデータの有無とは関係ない。
//   1. **条件別タブで既に出している**（CONDITION_ROWSのfirstDay/finalDay、PR #831
//      で出荷済み。basicInfoStats.js参照）。足すと同じ数字が同じタブの2箇所に出る
//   2. **軸の意味が混ざる**。PERIODSは「今期／過去3ヶ月／直近1ヶ月」という
//      *時間の幅* の軸で、初日・最終日は幅ではなく *条件*（当地・一般戦・波5cm以上
//      と同じ仲間）。条件は条件別タブ側が持つ、という切り分けを崩さない
// なお母数は足りている（初日の走数は中央24走、SMALL_SAMPLE_THRESHOLDを割るのは
// 0.6%。2026-09-28実測）ので、将来「初日×当地×SG・G1」のような掛け合わせが
// 欲しくなったら条件別タブ側を多軸化するのが筋。1の重複が言えるのは既定状態
// （全国・全レース）についてで、当地やSG・G1を選ぶと条件別タブ側は絞らない
// 集計のままなので数字は一致しない
const PERIODS = ["current", "last3m", "last1m"];
const PRESETS = [
  { scope: "local", grade: "ippan" },
  { scope: "local", grade: "sgg1" },
  { scope: "national", grade: "sgg1" },
];

function formatRate(value) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

// 「勝率」は公式集計値（win_rate/local_win_rate）を使う場合、実際の1着率(%)
// ではなく順位の重み付き平均点（0〜9程度、DataRaceTable等でも%無し表記）。
// グレード・期間で絞り込んだ場合は自社集計の「実際の1着率(%)」に切り替わる
// （公式の点数計算式を自社で再現することはできないため）。この2つは定義が
// 異なる別の指標であるため、表示の出し分け・注記が必須
function formatWinRate(value, isPercentage) {
  if (value === null || value === undefined) return "—";
  return isPercentage ? `${value.toFixed(1)}%` : value.toFixed(2);
}

// 指標に応じた値のフォーマット（得意会場ランキング等、勝率の公式/自社切替が
// 関係しない箇所で使う汎用フォーマッタ）
function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  return metric === "avgSt" ? value.toFixed(2) : `${value.toFixed(1)}%`;
}

function RaceBasicInfoTab({
  raceId,
  venueCode,
  players,
  focusedBoat,
  onFocusBoat,
}) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [metric, setMetric] = useState("winRate");
  const [scope, setScope] = useState("national");
  const [grade, setGrade] = useState("all");
  const [period, setPeriod] = useState("current");
  // 展開中の艇はタブをまたいで共有する（BOA-492）。null は「誰も展開していない」で、
  // 従来のタブ内stateと同じ初期値。枠別・今節タブで艇を選んでからこのタブへ来ると、
  // その艇が展開済みで開く
  const expandedBoat = focusedBoat ?? null;
  // 展開パネルの内訳（トレンド/当地/条件別）。どの艇のものかを一緒に持ち、
  // 艇が変わったら "trend" に戻す。艇の選択はタブ間共有（BOA-492）で
  // このタブの操作以外でも変わるため、押した瞬間に戻すのでは足りない。
  // 副作用として、同じ艇を閉じて開き直したときは前の内訳が復元される
  // （従来は毎回 "trend" に戻っていた）。同じ選手の同じ切り口に戻るだけなので
  // そのままにしている
  const [expandedViewState, setExpandedViewState] = useState({
    boat: null,
    view: "trend",
  });
  const expandedView =
    expandedViewState.boat === expandedBoat ? expandedViewState.view : "trend";
  const setExpandedView = (view) =>
    setExpandedViewState({ boat: expandedBoat, view });
  const [officialRates, setOfficialRates] = useState(null);
  const [scopedStatsByRacer, setScopedStatsByRacer] = useState({});
  // 「前期」（racer_period_stats、phase a FR-4c）。6人分を1クエリで取る。
  // undefined=未取得、配列=取得済み、それ以外（{state:"forbidden"}）＝095未適用
  const [periodStats, setPeriodStats] = useState(undefined);
  const [periodFailed, setPeriodFailed] = useState(false);
  // 再読み込みボタン用。これを増やさないと取得effectの依存
  // （racerIdsKey / raceDate）が変わらず、再取得が起きないまま
  // 枠もエラーも消えて「失敗がデータなしに化ける」状態になる
  const [periodRetryToken, setPeriodRetryToken] = useState(0);
  // 今期の事故率（目安、BOA-327）の元データ。6人分を1回の RPC で取る。
  // undefined=未取得、{rows, range}=取得済み、{state:"unavailable"}=126未適用（出さない）、null=取得失敗
  const [accidentRecords, setAccidentRecords] = useState(undefined);
  const [accidentRetryToken, setAccidentRetryToken] = useState(0);

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceEntryOfficialRatesBreakdown(raceId)
      .then((data) => {
        if (!cancelled) setOfficialRates(data);
      })
      .catch((err) => {
        // catchしないとofficialRatesがnullのまま残り、loading判定
        // （officialRates === null）が永久にtrueになって勝率・連対率のセルが
        // スケルトンのまま固まる。下のensureScopedStatsと同じ扱いに揃える
        console.error("公式勝率取得エラー:", err?.message ?? String(err));
        if (!cancelled) setOfficialRates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // 「前期」は条件別タブを開いたときだけ要る値だが、6人分まとめて1クエリで済み
  // （racer_period_stats を period_year/period_no で絞って .in() する）、
  // タブを開くたびに待たせない方が読み手の体験が良いのでレース単位で先に取る。
  // racerIdsKey は「6人の登録番号の並び」で、同じレース内では変わらない
  const racerIdsKey = sortedPlayers.map((p) => p.racerId ?? "").join(",");
  const raceDate = parseRaceId(raceId)?.date ?? null;
  // 表示中のレースより前の走だけを使う（BOA-605。枠別情報タブの BOA-603 と同じ）。
  // 過去のレースを開いたとき、そのレース自身と後日の走がバー・得意会場・条件別に入り、
  // 結果を知った状態の数字になっていた。取得前（undefined）・失敗（null）はそのまま返す
  const recordsOf = (racerId) => {
    const records = scopedStatsByRacer[racerId];
    return Array.isArray(records)
      ? recordsBeforeRace(records, raceId)
      : records;
  };
  // 「直近3ヶ月・直近1ヶ月」の起点もレースの日にそろえる（当日のレースは今日と同じ）
  const periodAnchor = raceId
    ? new Date(`${raceId.slice(0, 10)}T12:00:00+09:00`)
    : new Date();
  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || !raceDate) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRacerPeriodStats(ids, raceDate)
      .then((data) => {
        if (!cancelled) setPeriodStats(data);
      })
      .catch((err) => {
        // 権限エラー（095未適用）はサービス層が {state:"forbidden"} で返すので
        // ここには来ない。ここに来るのはネットワーク断・タイムアウト等で、
        // 「データが無い」と区別して扱う（.claude/rules/frontend-data-fetch.md §3）
        console.error("前期成績取得エラー:", err?.message ?? String(err));
        if (!cancelled) {
          setPeriodStats(null);
          setPeriodFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey, raceDate, periodRetryToken]);

  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || !raceDate) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRacerAccidentRecords(ids, raceDate)
      .then((data) => {
        if (!cancelled) setAccidentRecords(data);
      })
      .catch((err) => {
        // 126 未適用はサービス層が {state:"unavailable"} で返すので、ここに来るのは通信の失敗。
        // 「事故が無い」と区別して、開いた欄に再試行つきのエラーを出す
        console.error("事故率取得エラー:", err?.message ?? String(err));
        if (!cancelled) setAccidentRecords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey, raceDate, accidentRetryToken]);
  // racerId → computeAccidentStats の結果。取得前・未適用・失敗は空
  const accidentByRacer = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(accidentRecords?.rows)) return map;
    const byId = new Map(accidentRecords.rows.map((r) => [r.racer_id, r]));
    for (const p of sortedPlayers) {
      if (!p.racerId) continue;
      // 今期まだ1走もしていない選手は RPC の行が無い。出走0として扱う
      map.set(
        p.racerId,
        computeAccidentStats(
          byId.get(p.racerId) ?? { starts: 0, incidents: [] },
          accidentRecords.range,
        ),
      );
    }
    return map;
    // sortedPlayers は毎回作り直す配列なので、中身の代わりに racerIdsKey で再計算する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accidentRecords, racerIdsKey]);
  // 期間の表示（「2026-05-01〜10-02」）。to はレースの前日。同じ年なら月日だけにする
  const accidentRangeLabel = (() => {
    const range = accidentRecords?.range;
    if (!range) return null;
    const last = new Date(`${range.to}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    const lastStr = last.toISOString().slice(0, 10);
    // 期の初日のレースは、前日が期の前になる（「2026-05-01〜04-30」と逆になる。ファン評価1周目）
    if (lastStr < range.from) return { from: range.from, to: null };
    return {
      from: range.from,
      to:
        lastStr.slice(0, 4) === range.from.slice(0, 4)
          ? lastStr.slice(5)
          : lastStr,
    };
  })();

  const ensureScopedStats = useCallback((racerId) => {
    if (!racerId) return;
    setScopedStatsByRacer((prev) => {
      if (prev[racerId]) return prev;
      supabaseDataService
        .getRacerScopedRaceStats(racerId)
        .then((data) => {
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: data }));
        })
        .catch((err) => {
          // withCache()はfetcher()の例外をそのまま伝播するため、ここで
          // catchしないとscopedStatsByRacer[racerId]がundefinedのまま
          // 永久に残り、「直近5走」が「読み込み中...」表示のまま固まって
          // しまう（レビュー指摘#2の調査で発見した潜在バグ）。取得失敗時は
          // 空配列にフォールバックし、「出走履歴データがありません」表示に
          // 倒す（例外を握りつぶさずログには残す）
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: [] }));
        });
      // 取得中はundefinedのまま保持し、二重取得を防ぐ
      return { ...prev, [racerId]: undefined };
    });
  }, []);

  // 平均STには公式集計値の相当品が無いため、常に自社集計（getRacerScopedRaceStats）
  // を使う。勝率/2連対率/3連対率はグレード・期間を絞り込んだ場合のみ自社集計に切り替わる
  const needsOwnAggregation =
    metric === "avgSt" || grade !== "all" || period !== "current";

  // 自社集計が必要になった瞬間、6選手分の履歴データをまとめて取得する
  useEffect(() => {
    if (!needsOwnAggregation) return;
    sortedPlayers.forEach((p) => ensureScopedStats(p.racerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOwnAggregation, raceId]);

  // 展開中の艇が変わったら、その選手の履歴を取りに行く（withCacheで他タブと
  // 共有されるため、枠別タブが先に取っていれば再フェッチは起きない）。
  // 以前は toggleExpanded の中で呼んでいたが、共有state化（BOA-492）で
  // 枠別・今節タブからも expandedBoat が変わるようになったため、
  // 「押したとき」ではなく「変わったとき」に寄せる
  useEffect(() => {
    if (expandedBoat === null) return;
    ensureScopedStats(
      sortedPlayers.find((p) => p.number === expandedBoat)?.racerId,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedBoat, raceId]);

  // Fバッジの「今節」の印（BOA-440）
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);

  const officialRowFor = (boatNumber) =>
    (officialRates ?? []).find((r) => r.boat_number === boatNumber) ?? null;

  // 表示用の1艇分の値を計算する（value/n/isSmallSample/loading）
  const valueFor = (p) => {
    if (!needsOwnAggregation) {
      const row = officialRowFor(p.number);
      if (!row)
        return {
          value: null,
          n: null,
          isSmallSample: false,
          loading: officialRates === null,
        };
      const value =
        scope === "local"
          ? metric === "winRate"
            ? row.local_win_rate
            : metric === "top2Rate"
              ? row.local_2rate
              : row.local_3rate
          : metric === "winRate"
            ? row.win_rate
            : metric === "top2Rate"
              ? row.global_2rate
              : row.global_3rate;
      return {
        value: value === null || value === undefined ? null : Number(value),
        n: null,
        isSmallSample: false,
        loading: false,
      };
    }

    const records = recordsOf(p.racerId);
    if (records === undefined)
      return { value: null, n: null, isSmallSample: false, loading: true };
    const filtered = filterRecords(records ?? [], {
      venueCode,
      scope,
      grade,
      period,
      now: periodAnchor,
    });
    const rates = computeRates(filtered);
    if (metric === "avgSt") {
      return {
        value: rates.avgSt,
        n: rates.avgStN,
        isSmallSample:
          rates.avgStN > 0 && rates.avgStN < SMALL_SAMPLE_THRESHOLD,
        loading: false,
      };
    }
    return {
      value: rates[metric],
      n: rates.n,
      isSmallSample: rates.n > 0 && rates.n < SMALL_SAMPLE_THRESHOLD,
      loading: false,
    };
  };

  if (sortedPlayers.length === 0) return null;

  // 平均STは小数2桁で表示する。棒の長さも表示と同じ桁で決める。生の値で決めると、同じ「0.13」の
  // 艇どうしで棒の長さが18ポイント違い、「差は数字で見て」の注記と食い違った（#1064 ファン評価3周目）
  const values = sortedPlayers.map((p) => {
    const v = valueFor(p);
    return metric === "avgSt" && typeof v.value === "number"
      ? { boat: p.number, ...v, value: Math.round(v.value * 100) / 100 }
      : { boat: p.number, ...v };
  });
  const numericValues = values
    .map((v) => v.value)
    .filter((v) => v !== null && v !== undefined);
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;

  // 勝率(公式値)・平均STは0-100%のスケールではない（勝率は0〜9程度の点数、
  // STは秒数）ため、6艇内の相対最小最大でバーの長さを決める。
  // 2連対率/3連対率、および自社集計に切り替わった勝率(1着率%)は
  // 素直に0-100%スケールで表示する
  const isRelativeScaleMetric =
    metric === "avgSt" || (metric === "winRate" && !needsOwnAggregation);

  const barWidthPercent = (value) => {
    if (value === null || value === undefined) return 0;
    if (isRelativeScaleMetric) {
      if (maxValue === minValue) return 50;
      const ratio = (value - minValue) / (maxValue - minValue);
      // STのみ「小さいほど良い」ため反転する
      const r = metric === "avgSt" ? 1 - ratio : ratio;
      // 最下位の艇も短い棒を残す（10〜100%）。0%だと棒が空になり、6.70 と 7.58 の差が
      // 「0対ほぼ半分」に見えて、勝率が無いようにも読めた（BOA-618）
      return 10 + r * 90;
    }
    return Math.max(0, Math.min(100, value));
  };

  // 6艇の中で最良の値（同値は全部）に金枠を付ける（race-detail-ui-unify R1）。
  // 棒は艇色のまま、値のラベルで示す（R4）。表示と同じ桁で比べる
  const valueDigits =
    metric === "avgSt"
      ? 3
      : metric === "winRate" && !needsOwnAggregation
        ? 2
        : 1;
  // 走数が少ない値（棒を薄く出しているもの）は比べない。条件で絞ると「2走で2連対率100%」の
  // ような値が最良になり、金枠が最も当てにならない値に付く
  const bestBoats = bestOf(
    values
      .filter((v) => !v.loading && !v.isSmallSample)
      .map(({ boat, value }) => ({ boat, value })),
    metric === "avgSt" ? "min" : "max",
    { digits: valueDigits },
  );

  const isPresetActive = (preset) =>
    preset.scope === scope && preset.grade === grade;

  // 自社集計の「勝率」は1着になった割合（%）で、公式の勝率（点数）とは別物。
  // 同じ「勝率」の名前で並ぶと、条件別の 26.9% と前期欄の公式の 6.71 が同じ指標に
  // 見えた（BOA-585）。自社集計を出す場所では「1着率」と呼ぶ（枠別情報タブと同じ語）
  const ownMetricLabel = (m) =>
    m === "winRate"
      ? t("wakuInfo.metrics.winRate")
      : t(`basicInfo.metrics.${m}`);

  const toggleExpanded = (boatNumber) => {
    onFocusBoat(expandedBoat === boatNumber ? null : boatNumber);
  };

  return (
    <div className="race-basic-info-tab">
      <p className="rbit-note">{t("basicInfo.note")}</p>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.metricLabel")}
      >
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            className={`rbit-chip${metric === m ? " is-active" : ""}`}
            onClick={() => setMetric(m)}
          >
            {needsOwnAggregation
              ? ownMetricLabel(m)
              : t(`basicInfo.metrics.${m}`)}
          </button>
        ))}
      </div>

      {metric === "winRate" && needsOwnAggregation && (
        <p className="rbit-metric-caveat">
          {t("basicInfo.winRateSwitchCaveat")}
        </p>
      )}

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.scopeLabel")}
      >
        {["national", "local"].map((s) => (
          <button
            key={s}
            type="button"
            className={`rbit-chip${scope === s ? " is-active" : ""}`}
            onClick={() => setScope(s)}
          >
            {t(`basicInfo.scopes.${s}`)}
          </button>
        ))}
      </div>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.gradeLabel")}
      >
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            className={`rbit-chip${grade === g ? " is-active" : ""}`}
            onClick={() => setGrade(g)}
          >
            {t(`basicInfo.grades.${g}`)}
          </button>
        ))}
      </div>

      <div className="rbit-preset-row">
        {PRESETS.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            className={`rbit-preset${isPresetActive(preset) ? " is-active" : ""}`}
            onClick={() => {
              setScope(preset.scope);
              setGrade(preset.grade);
            }}
          >
            {/* 日本語は「当地一般戦」と続けて書くが、英語・韓国語は語間に
                スペースが要るため区切りをロケール側に持たせる */}
            {t("basicInfo.presetLabel", {
              scope: t(`basicInfo.scopes.${preset.scope}`),
              grade: t(`basicInfo.grades.${preset.grade}`),
            })}
          </button>
        ))}
      </div>

      <details className="rbit-period-details">
        <summary>{t("basicInfo.periodSummary")}</summary>
        <div className="rbit-chip-row">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`rbit-chip${period === p ? " is-active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {t(`basicInfo.periods.${p}`)}
            </button>
          ))}
        </div>
        {grade !== "all" && period === "current" && (
          <p className="rbit-period-caveat">{t("basicInfo.periodCaveat")}</p>
        )}
      </details>

      {/* 勝率（公式の点数）・平均STの棒は、6艇の中の最小〜最大で長さを決める。
          平均STは差が0.03秒でも棒の長さが10%と100%に開くので、長さだけで差の大きさを
          読ませないよう書き添える（#1064 ファン評価2周目） */}
      {isRelativeScaleMetric && (
        <p className="rbit-metric-caveat rbit-relative-note">
          {t("basicInfo.relativeBarNote")}
        </p>
      )}
      <div className="rbit-bars">
        {values.map(({ boat, value, n, isSmallSample, loading }) => {
          const player = sortedPlayers.find((p) => p.number === boat);
          const color = BOAT_COLORS[boat] || {};
          return (
            <div key={boat} className="rbit-bar-block">
              <button
                type="button"
                className="rbit-bar-row"
                onClick={() => toggleExpanded(boat)}
                aria-expanded={expandedBoat === boat}
              >
                <span
                  className="rbit-boat-chip"
                  style={{ background: color.bg, color: color.text }}
                >
                  {boat}
                </span>
                {/* 名前とFバッジでgridの1列。バッジを直の子にすると
                    grid-template-columns（5列）がずれ、バーの上に重なる */}
                <span className="rbit-name-cell">
                  <span className="rbit-name" translate="no">
                    {/* 出走表の名前は姓と名の間を全角スペースで詰め物して
                        字数を揃えてある。今節タブ・モータ情報タブ・オッズ一覧は
                        詰めて出しており、ここだけ空きが残ると同じ画面で
                        表記が揺れる */}
                    {player?.name?.replace(/\s+/g, "")}
                  </span>
                  {/* 出走表の今期F数（T5-3）。ST考察カードのバッジと同じ出所
                      （race_entries.f_count）にしてある。この行は <button> なので
                      TermHintButton（入れ子の <button> になる）は置けず、
                      説明は title 属性で出す */}
                  <FlyingBadge
                    count={officialRowFor(boat)?.f_count}
                    currentMeet={currentMeetFlyingBoats.has(boat)}
                    lateCount={officialRowFor(boat)?.l_count}
                  />
                </span>
                <span className="rbit-bar-track">
                  {!loading && (
                    <span
                      className={`rbit-bar-fill${isSmallSample ? " is-small-sample" : ""}${boat === 1 ? " is-white" : ""}`}
                      style={{
                        width: `${barWidthPercent(value)}%`,
                        background: color.bg,
                      }}
                    />
                  )}
                </span>
                <span className="rbit-value">
                  {loading ? (
                    <span className="rbit-skeleton" aria-hidden="true" />
                  ) : (
                    <span
                      className={`rbit-value-num${bestBoats.has(boat) ? " ind-best" : ""}`}
                    >
                      {metric === "avgSt"
                        ? value !== null && value !== undefined
                          ? value.toFixed(valueDigits)
                          : "—"
                        : metric === "winRate"
                          ? formatWinRate(value, needsOwnAggregation)
                          : formatRate(value)}
                    </span>
                  )}
                  {n !== null && n !== undefined && (
                    <span
                      className={`rbit-n${isSmallSample ? " is-small-sample" : ""}`}
                    >
                      {t(
                        n === 0 ? "basicInfo.noData" : "basicInfo.sampleCount",
                        { n },
                      )}
                    </span>
                  )}
                </span>
                <span className="rbit-expand-arrow">
                  {expandedBoat === boat ? "▼" : "▶"}
                </span>
                {/* 今期の事故率（BOA-327）。B2ラインを超えた選手と、あとF1本（20点）以内で
                      超える選手にだけ出す（出走30走以上。accidentRate.js）。名前の列に入れると列が広がり、
                      その行だけ棒の枠が短くなって6艇の長さを比べられなくなるので、2段目に置く */}
                {(() => {
                  const acc = accidentByRacer.get(player?.racerId);
                  if (!acc?.showBadge) return null;
                  return (
                    <span
                      className={`rbit-accident-badge${acc.status === "over" ? " is-over" : ""}`}
                    >
                      {acc.status === "over"
                        ? t("basicInfo.accidentBadgeOver", {
                            rate: acc.rate.toFixed(2),
                          })
                        : t("basicInfo.accidentBadgeNear", {
                            need: acc.need,
                          })}
                    </span>
                  );
                })()}
              </button>

              {expandedBoat === boat && (
                <div className="rbit-expanded">
                  {/* 今期の事故率（目安、BOA-327）。どのサブタブでも見えるよう、タブの上に置く */}
                  {accidentRecords === null && (
                    <InlineFetchError
                      message={t("basicInfo.accidentFetchError")}
                      onRetry={() => {
                        setAccidentRecords(undefined);
                        setAccidentRetryToken((v) => v + 1);
                      }}
                    />
                  )}
                  {(() => {
                    const acc = accidentByRacer.get(player?.racerId);
                    if (!acc || !accidentRangeLabel) return null;
                    const kinds = ["F", "L1", "K1", "S1", "S2"]
                      .filter((k) => acc.counts[k] > 0)
                      .map((k) =>
                        t("basicInfo.accidentKindCount", {
                          kind: t(`basicInfo.accidentKind.${k}`),
                          n: acc.counts[k],
                        }),
                      )
                      .join(t("basicInfo.accidentKindSeparator"));
                    return (
                      <div
                        className={`rbit-accident${acc.settled && acc.status === "over" ? " is-over" : ""}`}
                      >
                        <div className="rbit-accident-heading">
                          {accidentRangeLabel.to
                            ? t("basicInfo.accidentTitle", accidentRangeLabel)
                            : t("basicInfo.accidentTitleOpen", {
                                from: accidentRangeLabel.from,
                              })}
                        </div>
                        {acc.starts === 0 ? (
                          <p className="rbit-accident-values">
                            {t("basicInfo.accidentNoStarts")}
                          </p>
                        ) : (
                          <div className="rbit-accident-values">
                            {/* 数字だけを太字にする（承認済みモックどおり） */}
                            <span className="rbit-accident-rate">
                              {t("basicInfo.accidentRateLabel")}{" "}
                              <span className="rbit-accident-rate-num">
                                {acc.rate.toFixed(2)}
                              </span>
                            </span>
                            <span className="rbit-accident-breakdown">
                              {t("basicInfo.accidentBreakdown", {
                                points: acc.points,
                                starts: acc.starts,
                                kinds: kinds || t("basicInfo.accidentNone"),
                              })}
                            </span>
                            <span className="rbit-accident-line">
                              {!acc.settled
                                ? t("basicInfo.accidentLineEarly", {
                                    min: ACCIDENT_BADGE_MIN_STARTS,
                                  })
                                : acc.status === "over"
                                  ? t("basicInfo.accidentLineOver")
                                  : t("basicInfo.accidentLineNear", {
                                      need: acc.need,
                                    })}
                            </span>
                          </div>
                        )}
                        <p className="rbit-accident-note">
                          {t("basicInfo.accidentNote")}
                        </p>
                      </div>
                    );
                  })()}
                  <div className="rbit-expanded-tabs">
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "trend" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("trend")}
                    >
                      {t("basicInfo.viewTrend")}
                    </button>
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "venue" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("venue")}
                    >
                      {t("basicInfo.viewVenue")}
                    </button>
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "conditions" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("conditions")}
                    >
                      {t("basicInfo.viewConditions")}
                    </button>
                  </div>

                  {expandedView === "trend" &&
                    (() => {
                      const records = scopedStatsByRacer[player?.racerId];
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      // 表示中のレースより前の走だけ（BOA-602）。過去のレースのページで、
                      // そのレース自身や後日の走が「直近」に混ざっていた。
                      // 並びは新しい順（いちばん上が前走）。選手ページのレース一覧と向きを
                      // そろえる（BOA-623 ファン評価1周目。375px で前走が下に隠れていた）
                      const recent = getRecentRaces(
                        recordsBeforeRace(records, raceId),
                        RECENT_RACES_COUNT,
                      ).reverse();
                      if (recent.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noHistory")}
                          </p>
                        );
                      }
                      return (
                        <div className="rbit-trend">
                          <p className="rbit-trend-note">
                            {t("basicInfo.trendNote")}
                          </p>
                          <RecentRunsTable
                            rows={recent}
                            buildRaceHref={(raceId) =>
                              localize(`/race/${raceId}`)
                            }
                          />
                        </div>
                      );
                    })()}

                  {expandedView === "venue" &&
                    (() => {
                      const records = recordsOf(player?.racerId);
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      const ranking = computeVenueRanking(records, metric);
                      if (ranking.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noVenueData")}
                          </p>
                        );
                      }
                      const currentRank =
                        ranking.findIndex((r) => r.venueCode === venueCode) + 1;
                      return (
                        <div className="rbit-venue-ranking">
                          <p className="rbit-venue-metric-label">
                            {t("basicInfo.venueRankingFor", {
                              metric: ownMetricLabel(metric),
                            })}
                          </p>
                          {/* 条件別と同じく自社集計で、上のバーの公式値とは別物。どの期間・
                              どの会場が対象かも書く（#1069 ファン評価1周目） */}
                          <p className="rbit-conditions-note rbit-venue-note">
                            {t("basicInfo.venueRankingNote")}
                          </p>
                          {currentRank > 0 && (
                            <p className="rbit-venue-current-rank">
                              {t("basicInfo.currentVenueRank", {
                                venue: t(`venues.${venueCode}`),
                                rank: currentRank,
                                total: ranking.length,
                              })}
                            </p>
                          )}
                          <ol className="rbit-venue-list">
                            {ranking.slice(0, 5).map((row, idx) => {
                              const rowN =
                                metric === "avgSt" ? row.avgStN : row.n;
                              const rowValue =
                                metric === "avgSt" ? row.avgSt : row[metric];
                              return (
                                <li
                                  key={row.venueCode}
                                  className={
                                    row.venueCode === venueCode
                                      ? "rbit-venue-item is-current"
                                      : "rbit-venue-item"
                                  }
                                >
                                  <span className="rbit-venue-rank">
                                    {idx + 1}
                                  </span>
                                  <span className="rbit-venue-name">
                                    {t(`venues.${row.venueCode}`)}
                                  </span>
                                  <span className="rbit-venue-rate">
                                    {formatMetricValue(metric, rowValue)}
                                  </span>
                                  <span className="rbit-venue-n">
                                    {t("basicInfo.sampleCount", { n: rowN })}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      );
                    })()}

                  {expandedView === "conditions" &&
                    (() => {
                      const records = recordsOf(player?.racerId);
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      if (records.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noHistory")}
                          </p>
                        );
                      }
                      const condRows = buildConditionRows(records, {
                        venueCode,
                        metric,
                      })
                        .filter((r) => !r.unavailable)
                        // n=0 の行は畳む（BOA-432）。B級中心の選手では
                        // 「SG・G1 — (n=0)」が毎回並ぶだけで読む値が無い
                        // （ナイターの行を出さないのと同じ理屈）。
                        // ただし **F持ち/Fなしは対で意味を持つ**（同じ「F数が
                        // 取れている走」を分け合う設計）ので、片方だけ消さず
                        // 両方0のときだけ両方畳む
                        .filter((r, _i, rows) => {
                          if (r.key === "fHolding" || r.key === "fClean") {
                            return rows.some(
                              (x) =>
                                (x.key === "fHolding" || x.key === "fClean") &&
                                x.n > 0,
                            );
                          }
                          return r.n > 0;
                        });
                      const period = pickPeriodStats(
                        periodStats,
                        player?.racerId,
                        (raceId ?? "").slice(0, 10),
                      );
                      // 前期と出走表の値の差（BOA-439）。出走表の値は上のバーの
                      // 既定（全国・今期）と同じ公式値（race_entries、追加クエリ無し）。
                      // 「今期」とは呼ばない: 出走表の勝率は期が替わっても数え直されず、
                      // 5月は直前の期の確定値との差が平均0.12しかない（9月は0.38。
                      // 2026-09-30実測）。バーを当地に切り替えても全国のままなので
                      // 「全国」も明記する。平均STは出走表の値が無いので差は出さない
                      const nowRow = officialRowFor(player?.number);
                      const winDiff = period
                        ? periodDiff(period.winRate, nowRow?.win_rate, 2)
                        : null;
                      const top2Diff = period
                        ? periodDiff(period.top2Rate, nowRow?.global_2rate, 1)
                        : null;
                      // 期の初めから3か月は差を出さず、出走表の値だけを並べる
                      // （periodDiffShownFrom のコメント参照）
                      const diffShownFrom = periodDiffShownFrom(
                        period?.calcTo ?? null,
                      );
                      const raceDate = (raceId ?? "").slice(0, 10);
                      // 前期を取り込む前に前々期を出しているとき（period.fallback）も差を出さない。
                      // 出走表の勝率は前期の成績に近く、前々期との差を「前期から」と読ませると誤る
                      const diffWithheld = Boolean(
                        period?.fallback ||
                        (diffShownFrom && raceDate && raceDate < diffShownFrom),
                      );
                      // 前々期を出しているときの、差を出さない理由。コードが知っている事実
                      // （前期を取り込んでいない・差を出し始める日）だけを書く。「公式の公開待ち」
                      // 「出走表は前期に近い」は日付によって外れる（期の初め3か月を過ぎれば公式は
                      // 公開済みで、出走表も前期から離れる）。ファン評価1周目・2周目で同じ注記に
                      // 指摘が続いたため、外の事実を言い切らない形にした
                      const fallbackDiffNote = (p, date) => {
                        const from = periodDiffShownFrom(p.pending.calcTo);
                        return from && date && date < from
                          ? t("basicInfo.periodDiffFallbackNoteDate", {
                              date: from,
                            })
                          : t("basicInfo.periodDiffFallbackNote");
                      };
                      // 2連対率の差は率の変化ではなくポイント差なので pt を付ける
                      const diffLabel = (d, unit = "", diffUnit = unit) =>
                        d && (
                          <span
                            // 勝率・2連対率とも高いほど良い。上がった＝緑、下がった＝赤
                            // （差の数字に＋−が付く。race-detail-ui-unify R2）。
                            // 差を出さない期の初め（diffWithheld）は色を付けない
                            className={`rbit-period-diff${
                              diffWithheld
                                ? ""
                                : d.sign > 0
                                  ? " is-up ind-good"
                                  : d.sign < 0
                                    ? " is-down ind-bad"
                                    : ""
                            }`}
                          >
                            {diffWithheld
                              ? t("basicInfo.periodCurrentOnly", {
                                  current: `${d.current}${unit}`,
                                })
                              : t("basicInfo.periodVsCurrent", {
                                  current: `${d.current}${unit}`,
                                  diff: `${d.diff}${diffUnit}`,
                                })}
                          </span>
                        );
                      return (
                        <div className="rbit-conditions">
                          {/* 値は全行とも自社集計。既定状態（勝率・全レース・今期）では
                              上のバーが公式値を出すため、同じ「全国」でも数字が違う */}
                          <p className="rbit-conditions-note">
                            {/* 絞り込み中は上のバーも自社集計なので、「公式値とは一致しない」とは
                                書かない。違いは期間・条件の範囲（#1069 ファン評価2周目） */}
                            {t(
                              needsOwnAggregation
                                ? "basicInfo.conditionsNoteFiltered"
                                : "basicInfo.conditionsNote",
                              { metric: ownMetricLabel(metric) },
                            )}
                          </p>
                          <table className="rbit-conditions-table">
                            <tbody>
                              {condRows.map((row) => {
                                const small =
                                  row.n > 0 && row.n < SMALL_SAMPLE_THRESHOLD;
                                return (
                                  <tr key={row.key}>
                                    <th scope="row">
                                      {t(`basicInfo.conditions.${row.key}`)}
                                    </th>
                                    <td
                                      className={`rbit-conditions-value${small ? " is-small-sample" : ""}`}
                                    >
                                      {row.value === null
                                        ? "—"
                                        : formatMetricValue(metric, row.value)}
                                    </td>
                                    <td
                                      className={`rbit-conditions-n${small ? " is-small-sample" : ""}`}
                                    >
                                      {small && (
                                        <span
                                          className="rbit-conditions-warn"
                                          title={t(
                                            "basicInfo.smallSampleTitle",
                                          )}
                                        >
                                          ⚠
                                        </span>
                                      )}
                                      {t("basicInfo.sampleCount", { n: row.n })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {/* A: この表は全コース込み。今日の枠と母集団が違う。
                              実例（2026-09-25 桐生1R）: 4号艇の選手は過去2年183走中
                              5・6枠が178走で全国1着率0.5%、6号艇の選手は枠がほぼ均等で
                              13.9%。素直に読むと今日の枠と逆方向に評価してしまう */}
                          <p className="rbit-conditions-caveat">
                            {t("basicInfo.conditionsCourseCaveat", {
                              boat,
                              n: records.filter((r) => r.boatNumber === boat)
                                .length,
                            })}
                          </p>
                          {/* C: Fを持った選手の見どころはスタートの踏み方なので、
                              指標が勝率等でも平均STを併記する。勝率だけだと
                              「F持ち時27.3% vs F無し時11.1%」のように
                              「Fを持っている方が走る」と読めてしまう */}
                          {metric !== "avgSt" &&
                            (() => {
                              const holding = condRows.find(
                                (r) => r.key === "fHolding",
                              );
                              const clean = condRows.find(
                                (r) => r.key === "fClean",
                              );
                              if (!holding?.avgStN && !clean?.avgStN)
                                return null;
                              const fmt = (row) =>
                                row?.avgSt === null || row?.avgSt === undefined
                                  ? "—"
                                  : row.avgSt.toFixed(2);
                              return (
                                <p className="rbit-conditions-caveat">
                                  {t("basicInfo.conditionsFStNote", {
                                    holding: fmt(holding),
                                    holdingN: holding?.avgStN ?? 0,
                                    clean: fmt(clean),
                                    cleanN: clean?.avgStN ?? 0,
                                  })}
                                </p>
                              );
                            })()}
                          {/* D: 外枠中心の選手は勝率だと全行0.0%に潰れて情報がゼロになる。
                              実例（同レース4号艇）: 勝率は全行0.0%だが、3連対率にすると
                              全国41.5%・最終日50.0%・波5cm以上50.0%と差が出る。
                              ただし3連対率も全部0の選手（1着も3着も無い新人）はいるので、
                              **切り替えて実際に差が出る場合だけ**誘導する */}
                          {metric !== "top3Rate" &&
                            metric !== "avgSt" &&
                            condRows.some((r) => r.n > 0) &&
                            // 厳密に0で判定すると「全国0.5%・一般戦0.6%」のような
                            // 実質潰れている選手を拾えない。1%未満＝100走に1回未満で
                            // 行間の差が読めない状態とみなす
                            condRows.every(
                              (r) => r.value === null || r.value < 1,
                            ) &&
                            buildConditionRows(records, {
                              venueCode,
                              metric: "top3Rate",
                            }).some(
                              (r) => r.value !== null && r.value >= 1,
                            ) && (
                              <p className="rbit-conditions-zero">
                                {t("basicInfo.conditionsAllZeroHint")}
                                <button
                                  type="button"
                                  className="rbit-conditions-zero-action"
                                  onClick={() => setMetric("top3Rate")}
                                >
                                  {t("basicInfo.conditionsAllZeroAction")}
                                </button>
                              </p>
                            )}
                          {/* 注記を4本並べるとグレーの壁になって誰も読まないので、
                              毎回は要らない2本（最終日の構造差・母数が違う行）は
                              折りたたむ。常時出すのはコース混在の1本とFのSTだけ */}
                          <details className="rbit-conditions-how">
                            <summary>
                              {t("basicInfo.conditionsHowToRead")}
                            </summary>
                            {/* B: 最終日は優勝戦を含み、勝ち上がった選手が1号艇に入る。
                                全36,221レースの実測で1号艇1着率は初日52.1%・中日54.0%・
                                最終日60.1%と構造的に差がある（選手の力ではなく枠の差） */}
                            {condRows.some((r) => r.key === "finalDay") && (
                              <p className="rbit-conditions-caveat">
                                {t("basicInfo.conditionsFinalDayCaveat")}
                              </p>
                            )}
                            {/* 「波5cm以上」から江戸川の走を外したことを書く（BOA-584） */}
                            {(() => {
                              const wave = condRows.find(
                                (r) => r.key === "wave5",
                              );
                              return wave?.excludedN > 0 ? (
                                <p className="rbit-conditions-caveat">
                                  {t("basicInfo.conditionsWaveExcludedNote", {
                                    venue: [...WAVE_EXCLUDED_VENUE_CODES]
                                      .map((code) => t(`venues.${code}`))
                                      .join(
                                        t(
                                          "basicInfo.conditionsBaseNoteSeparator",
                                        ),
                                      ),
                                    n: wave.excludedN,
                                  })}
                                </p>
                              ) : null;
                            })()}
                            {/* 母数が他行と違う行（初日・最終日・波・F持ち時・F無し時）は、
                                条件を判定できた走数を添えて「他行と比べない」と読ませる */}
                            {condRows.some((r) => r.baseN !== null) && (
                              <p className="rbit-conditions-caveat">
                                {t("basicInfo.conditionsBaseNote", {
                                  rows: condRows
                                    .filter((r) => r.baseN !== null)
                                    .map((r) =>
                                      t("basicInfo.conditionsBaseNoteRow", {
                                        label: t(
                                          `basicInfo.conditions.${r.key}`,
                                        ),
                                        n: r.baseN,
                                      }),
                                    )
                                    .join(
                                      t(
                                        "basicInfo.conditionsBaseNoteSeparator",
                                      ),
                                    ),
                                })}
                              </p>
                            )}
                          </details>
                          {/* 取得失敗を「前期のデータが無い」に化けさせない。
                              095未適用（forbidden）のときは枠ごと出さないのが
                              正しいので、ここでは出さない */}
                          {periodFailed && (
                            <InlineFetchError
                              message={t("basicInfo.periodFetchError")}
                              onRetry={() => {
                                setPeriodFailed(false);
                                setPeriodStats(undefined);
                                setPeriodRetryToken((v) => v + 1);
                              }}
                            />
                          )}
                          {/* 「前期」は公式の期別成績で、単位が点。自社集計の
                              1着率%と同じ列に混ぜられないため別枠にする */}
                          {period && (
                            <div
                              className={`rbit-period${period.fallback ? " is-fallback" : ""}`}
                            >
                              <div className="rbit-period-heading">
                                {t(
                                  period.fallback
                                    ? "basicInfo.periodTitleFallback"
                                    : "basicInfo.periodTitle",
                                  {
                                    from: period.calcFrom,
                                    to: period.calcTo,
                                  },
                                )}
                              </div>
                              {/* 公式の fan が公開される前（期替わり直後）は前々期を出す。
                                  その期を表として取り込んでいないときだけ（pickPeriodStats） */}
                              {/* 値の行は通常の前期と同じ見た目なので、見出しの「々」1文字だけに
                                  頼らず、この注記を本文と同じ大きさ・色で出す（ファン評価1周目 P2） */}
                              {period.fallback && (
                                <p className="rbit-period-note rbit-period-pending">
                                  {t("basicInfo.periodFallbackNote", {
                                    from: period.pending.calcFrom,
                                    to: period.pending.calcTo,
                                  })}
                                </p>
                              )}
                              <div className="rbit-period-values">
                                <span>
                                  {t("basicInfo.periodWinRate", {
                                    value:
                                      period.winRate === null
                                        ? "—"
                                        : period.winRate.toFixed(2),
                                  })}
                                  {diffLabel(winDiff)}
                                </span>
                                <span>
                                  {/* 単位は値側に付ける。i18n側に「%」を残すと
                                      出走0の新人（top2_rateがNULL）で
                                      「2連対率 —%」になる */}
                                  {t("basicInfo.periodTop2Rate", {
                                    value:
                                      period.top2Rate === null
                                        ? "—"
                                        : `${period.top2Rate.toFixed(1)}%`,
                                  })}
                                  {diffLabel(top2Diff, "%", "pt")}
                                </span>
                                <span>
                                  {t("basicInfo.periodAvgSt", {
                                    value:
                                      period.avgSt === null
                                        ? "—"
                                        : period.avgSt.toFixed(2),
                                  })}
                                </span>
                              </div>
                              {/* 優出・優勝（BOA-326）。公式の期別成績の前期の値と、
                                  前期を含む直近4期の合計。1艇ずつの表示で6艇の
                                  比較ではないので、最良の金枠は付けない */}
                              <div className="rbit-period-finals">
                                <span>
                                  {t("basicInfo.periodFinals", {
                                    value: period.finals ?? "—",
                                  })}
                                </span>
                                <span>
                                  {t("basicInfo.periodWins", {
                                    value: period.wins ?? "—",
                                  })}
                                </span>
                                {/* 範囲と回数を分け、回数は1つの塊で折り返す（375pxで「回」だけが
                                    次の行に落ちた。ファン評価2周目 P2） */}
                                <span className="rbit-period-recent">
                                  {t(
                                    period.fallback
                                      ? "basicInfo.periodRecentRangeFallback"
                                      : "basicInfo.periodRecentRange",
                                    {
                                      from: period.recent.from
                                        .slice(0, 7)
                                        .replace("-", "/"),
                                      to: period.recent.to
                                        .slice(0, 7)
                                        .replace("-", "/"),
                                    },
                                  )}
                                  <span className="rbit-period-recent-counts">
                                    {t("basicInfo.periodRecentCounts", {
                                      finals: period.recent.finals,
                                      wins: period.recent.wins,
                                    })}
                                  </span>
                                </span>
                              </div>
                              {diffWithheld && (winDiff || top2Diff) && (
                                <p className="rbit-period-note">
                                  {period.fallback
                                    ? fallbackDiffNote(period, raceDate)
                                    : t("basicInfo.periodDiffWithheldNote", {
                                        date: diffShownFrom,
                                      })}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Fバッジ・Lバッジの凡例。選手名の行は <button> で「?」を置けず、説明は
          title（ホバー）だけになるため、スマホでは意味を知る手段が無かった
          （BOA-440 ファン評価1周目）。バッジが1つも無いレースでは出さない */}
      {(officialRates ?? []).some(
        (r) => (r.f_count ?? 0) > 0 || (r.l_count ?? 0) > 0,
      ) && <p className="rbit-note">{t("flyingBadge.legend")}</p>}
      {/* 事故率の目印の凡例（BOA-327）。目印が1つでも出ているときだけ。「あと◯点」を予選の得点と
          取り違えないよう、何の点数かを書く（ファン評価1周目） */}
      {[...accidentByRacer.values()].some((a) => a.showBadge) && (
        <p className="rbit-note">{t("basicInfo.accidentLegend")}</p>
      )}
    </div>
  );
}

export default RaceBasicInfoTab;
