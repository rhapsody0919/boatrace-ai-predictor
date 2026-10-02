/**
 * RaceMeetTab - レース詳細ページ「今節」タブ（phase a FR-3）
 *
 * ## なぜ独立タブにしたか（2026-09-26、熱血ファン視点の議論の結論）
 *
 * 当初は基本情報タブのバー展開（選手を1人選んでから開く）の中に置いていたが、
 * **中身の主役が「6艇横断」＝レース単位の情報**になった時点で置き場所が合わなくなった。
 *
 * - 勝負駆けは「この6人の中で誰が一番欲しがっているか」でしか読めない。
 *   選手を1人選んでから見るものではなく、レースを開いたら最初に見るもの
 * - バー展開の中に置くと、どの艇を開いても同じ6艇リストが出る（6回同じものを見る）
 * - 基本情報タブの展開部分が836pxまで伸び、主役（データ出走表・バー）と競合していた
 * - ボートレース日和も「今節成績」を独立タブ（モータ情報の隣）に置いている。
 *   同じ位置に置けば、日和から来た読み手の学習コストが無い
 *
 * ## 構成
 *
 * 1. **6艇の今節**（レース単位）: 得点率順に並べ、節内順位・前検順位を添える
 * 2. **選んだ1艇の詳細**（選手単位）: 得点率と早見・ST・前検・展示順位・日別の走り
 *
 * データは `getMeetScoreboard`（節の全選手、+3本）と
 * `getRacerScopedRaceStats`（選んだ選手の走、既存キャッシュ）だけで、
 * 節の全選手分の個別履歴は引かない。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS, BOAT_LINE_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import {
  buildMeetResults,
  buildMeetTrend,
  getRecentRaces,
  lastStartTiming,
  MEET_ST_DIFF_THRESHOLD,
} from "./basicInfoStats";
import {
  buildMeetRanking,
  listAbsentOnlyRacers,
  groupExcludedRacers,
  FINISH_ABSENT,
  forecastSeriesScore,
  pointsNeededForBorder,
  countsForSeriesScore,
  isExcludedStage,
  SEMIFINAL_DEFAULT_SLOTS,
  SEMIFINAL_SPLIT_DEFAULT_SLOTS,
  MEET_SMALL_SAMPLE_RUNS,
} from "./seriesPoints";
import { finishMarkKeyOf } from "../../utils/prevResult";
import RaceHistoryTable from "./RaceHistoryTable";
import MeetSparkline from "./MeetSparkline";
import {
  dayCenter,
  dayTickLabels,
  layoutTrendByDate,
  sparkLeftPercent,
} from "../../utils/trendDateLayout";
import "./RaceMeetTab.css";
import "../common/HorizontalScrollHint.css";

// 順位の対象外の理由 → 画面の文言キー（meetTab.<key> と meetTab.<key>Title）。BOA-587
const EXCLUDED_LABEL_KEY = {
  withdrawn: "withdrawn",
  // 公式の備考による途中帰郷（説明の文だけ当社の推定と分ける）
  officialWithdrawn: "withdrawnOfficial",
  awardExcluded: "awardExcluded",
  flying: "flyingExcluded",
};
// 順位の対象外の内訳で名前を出す上限（超えた分は「ほか◯人」、BOA-697）
const EXCLUDED_LIST_MAX = 6;
// 準優・優勝戦に乗れない（必要得点を出さない）理由
const AWARD_EXCLUDED_REASONS = new Set(["awardExcluded", "flying"]);

// 準優の目安（上から slots 位）の中か。順位の対象外は rank が null で、
// `null <= 18` は true になるため、比べる前に外す（BOA-587 ファン評価1周目）
const rankInBorder = (row, slots) =>
  row.rank !== null && row.rank !== undefined && row.rank <= slots;

function RaceMeetTab({
  raceId,
  venueCode,
  players,
  focusedBoat,
  onFocusBoat,
  // 中止が確定したレース（BOA-658）。行われないレースに「今日の着順でこう動く」を出さない
  isCancelled = false,
}) {
  const { t } = useTranslation();
  // 着順の欄の公式の記号（エ・転 等）を、データ出走表と同じ言語ごとの表記にする
  const finishLabelOf = (finish) => {
    if (typeof finish !== "string") return finish;
    const key = finishMarkKeyOf(finish);
    return key ? t(`dataTable.prevMark.${key}`) : finish;
  };
  const localize = useLocalizedPath();
  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  const [board, setBoard] = useState(undefined);
  const [records, setRecords] = useState(undefined);
  // 6艇比較の推移で見る指標（ST / 展示）
  const [trendMetric, setTrendMetric] = useState("st");
  // 早見の表（6艇×着順）は390pxで右が切れるため手がかりを出す
  const {
    ref: forecastRef,
    hasMore: forecastHasMore,
    update: forecastUpdate,
    scrollRight: forecastScrollRight,
    // 行数が決まってから測り直す（マウント直後は取得前で幅が無い）
  } = useHorizontalScrollHint([sortedPlayers.length, board?.meetStart]);
  // 選んでいる艇はタブをまたいで共有する（BOA-492）。共有値が null（＝まだ
  // どの艇も選んでいない）のときは従来どおり1号艇を見せる
  const selectedBoat = focusedBoat ?? sortedPlayers[0]?.number ?? null;

  useEffect(() => {
    if (!raceId || venueCode === null || venueCode === undefined)
      return undefined;
    let cancelled = false;
    supabaseDataService
      .getMeetScoreboard(raceId, venueCode)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((err) => {
        console.error("今節の取得エラー:", err?.message ?? String(err));
        if (!cancelled) setBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, venueCode]);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];

  useEffect(() => {
    const racerId = selectedPlayer?.racerId;
    if (!racerId) return undefined;
    let cancelled = false;
    // setRecords(undefined) を同期で呼ぶと連鎖レンダーになるため、
    // 取得結果が来たときだけ更新する（切替中は前の選手の表が一瞬残るが、
    // 下のチップで誰を見ているかは分かる）
    supabaseDataService
      .getRacerScopedRaceStats(racerId)
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .catch((err) => {
        console.error("今節（選手履歴）の取得エラー:", err?.message);
        if (!cancelled) setRecords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.racerId]);

  if (sortedPlayers.length === 0) return null;

  const ranking = buildMeetRanking(board);
  // 今節の走が全て欠場の選手は得点率が出ず ranking に載らない。そのままだと
  // 比較表から黙って消えるので、末尾に「欠場」の行として足す（BOA-504）
  const rankedIds = new Set(ranking.map((r) => r.racerId));
  const absentOnly = listAbsentOnlyRacers(board).filter(
    (r) => !rankedIds.has(r.racerId),
  );
  // Ｗ開催の節は母集団が半分（24人前後）になるので、既定値も分ける。
  // 通常の18を当てると「24人中18位まで」という緩すぎる線になる（BOA-511）
  const slots =
    board?.semifinalSlots ??
    (board?.seriesRacerIds
      ? SEMIFINAL_SPLIT_DEFAULT_SLOTS
      : SEMIFINAL_DEFAULT_SLOTS);
  const stage = board?.currentStage ?? "";
  const isAfterPrelim = isExcludedStage(stage);
  // **表示中のレースが得点率を動かすか**。予選が締まった後の一般戦・特別選抜戦・
  // 準優・優勝戦では動かない（公式の得点率一覧も予選終了時点で止まる）。
  // 表示中レースの種別だけを見ていると、最終日の「特別選抜戦」で
  // 「今日の着順で得点率はこう動く」「準優の目安」を出してしまう。
  // 判定は得点率の集計と同じ `countsForSeriesScore` を使う（BOA-457）
  const prelimEndRaceId = board?.prelimEndRaceId ?? null;
  const prelimOver = !countsForSeriesScore(stage, raceId, prelimEndRaceId);
  const prelimEndDate = prelimEndRaceId
    ? `${Number(prelimEndRaceId.slice(5, 7))}/${Number(prelimEndRaceId.slice(8, 10))}`
    : null;
  const prelimEndDay = board?.prelimEndDay ?? null;
  // 丸一日レースが無かった日（中止・順延、BOA-636）。「9/22」の形で持つ
  const noRaceDays = board?.noRaceDays ?? [];
  const mdList = (days) =>
    days
      .map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`)
      .join(t("meetTab.listSeparator"));
  // 予選終了の日より前の、レースが無かった日。日目と日付の数が合わない理由になる
  const noRaceDaysBeforePrelimEnd = prelimEndRaceId
    ? noRaceDays.filter((d) => d < prelimEndRaceId.slice(0, 10))
    : [];
  const pretestOf = (racerId) => board?.pretestByRacer?.[racerId] ?? null;
  // 同率が何人いるか。節の序盤は得点率の刻みが粗く（3走なら0.33刻み）
  // 「11位」が3人並ぶ。順位だけ見せると分解能を過信させる
  const tiedCount = (rank) =>
    ranking.filter((r) => r.rank !== null && r.rank === rank).length;

  // 節内順位の表が公式の得点率一覧の値でできているか（出典の注記の出し分け）。
  // サービス層が「予選終了後の表示」のときだけ公式行を渡す（BOA-475）
  const usesOfficialScore = ranking.some((r) => r.fromOfficial);

  const mine = ranking.find((r) => r.racerId === selectedPlayer?.racerId);
  // ボーダーは**順位の対象になっている選手だけ**から取る。途中で離脱した
  // 選手を混ぜると公式とズレる（若松G1の実測で 5.67 → 除外すると 5.60 で
  // 実ボーダーと完全一致）
  const rankedOnly = ranking.filter((r) => !r.withdrawn);
  // 予選の後に今節Fを切った選手（順位は付いたまま。BOA-626）
  const postPrelimFlying = new Set(board?.postPrelimFlyingRacerIds ?? []);
  // 順位の対象外の内訳（BOA-697）
  const excludedGroups = groupExcludedRacers(ranking, absentOnly);
  // 男女Ｗ優勝戦の節か（サービス層が同じシリーズの選手だけを渡してくる）
  const seriesSplit = Boolean(board?.seriesRacerIds);
  // 節全体では何人いるか。分けたときに「なぜ半分になったのか」を数で示す。
  // `buildMeetRanking` を分けずにもう一度通すだけ（追加クエリ0本・48人ぶんの計算）
  // 出場者は出走表から数える（得点率の母集団ではなく。BOA-660）。取れなければ従来どおり
  const entrantIds = board?.meetEntrantIds ?? null;
  const seriesIdSet = seriesSplit ? new Set(board.seriesRacerIds) : null;
  const entrantCount = Math.max(
    entrantIds
      ? entrantIds.filter((id) => !seriesIdSet || seriesIdSet.has(id)).length
      : 0,
    ranking.length,
  );
  const meetTotal = entrantIds
    ? entrantIds.length
    : seriesSplit
      ? buildMeetRanking({ ...board, seriesRacerIds: null }).length
      : ranking.length;
  // 表の6艇のうちの選手か（凡例の出し分け。節の誰かに該当者が居るだけで出すと、
  // 表に無い印の説明を読ませることになる。BOA-660）
  const inTable = (r) => sortedPlayers.some((p) => p.racerId === r.racerId);
  // 今節をまだ走っていない艇（このレースが今節の初戦）。行ごと消すと「欠場か」と
  // 読み違えるので、行として出す（BOA-660、津 9/23 6R で6艇中3艇しか出なかった）
  // **データが届く前は判定しない**。届く前は今節の走が0件なので6艇とも「まだ走って
  // いない」になり、「節の出場は0人」と全艇「今節初戦」の表が一瞬出ていた
  // （PR #1102 ファン評価2周目）
  const notYetRun = board
    ? sortedPlayers.filter(
        (p) =>
          !ranking.some((r) => r.racerId === p.racerId) &&
          !absentOnly.some((r) => r.racerId === p.racerId),
      )
    : [];
  const border = rankedOnly[slots - 1]?.rate;
  // **この節をまだ1走もしていない選手**の数（BOA-690）。この選手がいる間（ふつうは
  // 初日の途中）は順位の対象がそろっておらず、目安が意味を持たない（下関の初日に
  // 「準優の目安は18位（2.00）」と出た）。2日目以降は出したまま、走数で断る
  const notYetStarted = (board?.notYetStartedRacerIds ?? []).filter(
    (id) => !seriesIdSet || seriesIdSet.has(id),
  ).length;
  const bordersReady = notYetStarted === 0;
  // 目安を出している時点の走数（順位の対象の選手の中央値）。「◯走時点の目安」と断る
  const medianRuns = (() => {
    const runs = rankedOnly.map((r) => r.runs).sort((a, b) => a - b);
    return runs.length > 0 ? runs[Math.floor(runs.length / 2)] : 0;
  })();
  // 表のボーダー表示は「節全体の順位」なので、選んだ選手の走数に依存しない
  const showBorderBadge =
    !isCancelled &&
    !isAfterPrelim &&
    !prelimOver &&
    bordersReady &&
    border !== undefined;
  const showBorder =
    !isCancelled &&
    bordersReady &&
    !isAfterPrelim &&
    !prelimOver &&
    mine &&
    mine.runs >= MEET_SMALL_SAMPLE_RUNS;

  const meet = buildMeetResults(records ?? [], { raceId, venueCode });
  const trend = buildMeetTrend(meet, records ?? []);
  const st = trend.st;
  const pre = pretestOf(selectedPlayer?.racerId);
  // スパークラインの右端に出す「前走」の値（欠測は飛ばして最後の実測を採る）
  const lastOf = (key) => {
    const vals = meet.map((r) => r[key]).filter((v) => typeof v === "number");
    return vals.length > 0 ? vals[vals.length - 1] : null;
  };
  // 表の日付（9/22）と揃える。`slice` だけだと「09/22」でゼロ埋めが残る
  const firstMeetDate = meet[0]?.date
    ? `${Number(meet[0].date.slice(5, 7))}/${Number(meet[0].date.slice(8, 10))}`
    : "";
  const venueDailyExhibitionAvg = board?.venueDailyExhibitionAvg ?? {};
  // 6艇の今節の推移（追加クエリ0本。節の全レースぶんをサービス層で2本
  // 引いて畳んである）。**同じ節・同じ水面を走った6艇**なので、
  // 縦の物差しを共通にして初めて比較になる
  const meetRunsByRacer = board?.meetRunsByRacer ?? {};
  const trendKey = trendMetric === "st" ? "st" : "exhibition";
  // 中身の無い走（ST・展示・着順のどれも無い）は外す。中止になった日のレースは
  // 出走表にだけ残り、点の無い空きの位置を取って線を片側に寄せていた
  // （津 2026-09-21・22 は中止。2026-09-28 の最終日で、飯山泰の線が右7割に詰まった。
  // BOA-537 ファン評価2周目）
  const trendRowsRaw = sortedPlayers.map((p) => ({
    player: p,
    runs: (meetRunsByRacer[p.racerId] ?? []).filter(
      (x) =>
        x.st !== null ||
        x.exhibition !== null ||
        (x.finish !== null && x.finish !== undefined),
    ),
  }));
  // **横軸は日付**（BOA-538）。以前は各行が自分の走数で左右いっぱいに伸びる
  // 「走った順」で、走数が違うと同じ横位置が別の日になり、行をまたいで同じ日と
  // 比べられなかった。節の日（6艇のうち誰かが走った日）を等間隔に並べて、
  // 6行の横位置をそろえる。`meetRunsByRacer` は表示中レースの直前までしか持たない
  // ので、日付の範囲は「この節の全日程」ではなく「ここに出ている走の範囲」。
  // 追加取得はせず、既に持っている日付から出す
  const trendDates = [
    ...new Set(
      trendRowsRaw.flatMap((r) => r.runs.map((x) => x.date).filter(Boolean)),
    ),
  ].sort();
  // 横軸は日付（BOA-538）。節の日（6艇のうち誰かが走った日）を等間隔に並べ、
  // 各走をその日の位置に置く。1日2走は左右にずらし、走らなかった日で線を切る
  const trendRows = trendRowsRaw.map((r) => ({
    ...r,
    layout: layoutTrendByDate(r.runs, trendDates),
  }));
  // 表の日付（9/22）と同じ形。`slice` だけだと「09/22」でゼロ埋めが残る
  const mdOf = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  // **線が1本も引けないときは出さない**。初日で各艇1走だと点が1個ずつになり、
  // 折れ線が描かれないのに「◯〜◯の走」「走った順」と言うことになる
  // （戸田 2026-09-26 の11Rで、6行とも線が無い状態で出ていた）。
  // 2点以上ある行が1つも無ければ、説明することが無い
  const hasAnyLine = trendRows.some(
    (r) => r.runs.filter((x) => typeof x[trendKey] === "number").length >= 2,
  );
  const trendRange =
    trendDates.length > 0 && hasAnyLine
      ? {
          from: mdOf(trendDates[0]),
          to: mdOf(trendDates[trendDates.length - 1]),
        }
      : null;
  // 横軸の範囲の中で、レースが無かった日（目盛りから抜ける日、BOA-636）
  const trendNoRaceDays =
    trendDates.length > 1
      ? noRaceDays.filter(
          (d) => d > trendDates[0] && d < trendDates[trendDates.length - 1],
        )
      : [];
  const trendValues = trendRows
    .flatMap((r) => r.runs.map((x) => x[trendKey]))
    .filter((v) => typeof v === "number");
  const trendDomain =
    trendValues.length >= 2
      ? [Math.min(...trendValues), Math.max(...trendValues)]
      : null;
  // 6艇の平均。各行の同じ高さに破線で引くと、行をまたいだ比較の手がかりになる
  // （行が分かれていると「同じ物差し」と書いても伝わりにくい）
  const trendMean =
    trendValues.length >= 2
      ? trendValues.reduce((a, b) => a + b, 0) / trendValues.length
      : null;
  // 今節の各走の「そのレース内でのST順位」（節の全レースぶんのSTから算出済み）
  const stRankByRace = Object.fromEntries(
    (meetRunsByRacer[selectedPlayer?.racerId] ?? []).map((r) => [
      r.raceId,
      r.stRank,
    ]),
  );
  // 線の点に合わせたときに出す文字列（BOA-454の確認中に出たユーザー要望）。
  // 文言の組み立て（i18n）は呼び出し側の責任にし、MeetSparkline は受け取った
  // 文字列を出すだけにしてある。日付は月日だけ（同じ節しか並ばないので年は要らない）。
  //
  // **下の「日別の走り」表と同じ行（getRecentRaces の正規化後）から作る。**
  // 生の `meet` の行はレース番号を持たず（race_id から導出する）、着順も
  // `finishPositionOf` を通して初めて決まるため、生の行から組み立てると
  // 表には「11R・4着」と出ているのに吹き出しだけ「—R・着外」になる
  const meetRows = getRecentRaces(meet, meet.length);
  const sparkLabel = (row, metricKey, value, rank) => {
    if (value === null || value === undefined) return null;
    const shown = Number(value).toFixed(2);
    return t("meetTab.sparkTip", {
      date:
        typeof row.date === "string" && row.date.length === 10
          ? `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8, 10))}`
          : (row.date ?? "—"),
      no: row.raceNo ?? "—",
      metric: t(metricKey),
      value: rank
        ? t("raceHistoryTable.startTimingCell", { time: shown, rank })
        : shown,
      finish:
        row.finishRank == null
          ? row.absent
            ? t("basicInfo.finishAbsent")
            : (row.finishMark ?? t("basicInfo.finishUnknown"))
          : t("meetTab.sparkTipFinish", { finish: row.finishRank }),
    });
  };

  // 得点率早見（6艇×1着〜6着）。公式の「得点率早見」は**6艇を1つの表**にして
  // 行＝艇・列＝着順で並べ、ボーダーとの関係を色で示す
  // （https://www.boatrace.jp/static_extra/pc/guide/guide-7.html）。
  // 1艇ぶんだけ出していたときは「他の艇はどうなるのか」が読めなかった。
  // 追加クエリ0本（既に持っている得点・走数から純関数で出す）
  const remainingPrelimRuns = board?.remainingPrelimRunsByRacer ?? {};
  // 残り走で取りうる最大得点（ドリーム戦の1着は12点）。無ければ予選配点で代用
  const remainingPrelimMaxPoints = board?.remainingPrelimMaxPointsByRacer ?? {};
  const forecastRows =
    !isCancelled && !prelimOver && !isAfterPrelim
      ? sortedPlayers
          .map((p) => ({
            player: p,
            row: ranking.find((r) => r.racerId === p.racerId),
          }))
          .filter((x) => x.row)
          .map(({ player, row }) => ({
            player,
            row,
            // 表示中レースの種別で配点を切り替える（ドリーム戦は1着+12）
            cells: forecastSeriesScore(row, stage),
            // 公式の「必要得点」＝準優ボーダーをクリアするのに要る得点。
            // 残り走数は**当日の番組が出ている予選レース**から数える
            // （翌日以降の出走表は未取得のことが多い）
            needed: pointsNeededForBorder(
              row,
              showBorderBadge && border !== undefined ? border : null,
              remainingPrelimRuns[player.racerId] ?? 0,
              remainingPrelimMaxPoints[player.racerId] ?? null,
            ),
            remaining: remainingPrelimRuns[player.racerId] ?? 0,
          }))
      : [];
  // 必要得点の列を出せるか（誰か1人でも残りの予選走が分かっていれば出す）
  const hasNeeded = forecastRows.some((r) => r.needed !== null);
  // STの前走は、直前がFならFと出す（数値のある最後の走を採るとFを飛ばす。BOA-597）
  const lastSt = lastStartTiming(meet, {
    valueOf: (r) => r.startTiming,
    markOf: (r) =>
      r.isFlying === true ? "F" : r.finishMark === "L" ? "L" : null,
  });
  const lastExhibition = lastOf("exhibitionTime");

  // 得点率は平均なので「1着→6着」と「3着→3着」が同じ5.00になる。
  // 次をどう見るかは並びで変わる
  const renderFinishes = (finishes) =>
    finishes.length > 0 && (
      <span className="rmt-finishes">
        <span className="rmt-finishes-label">
          {/* 予選が終わった後は、並びは予選の走だけ（得点率に数える走、BOA-457）。
              「着順」とだけ書くと、準優の日の一般戦など後の走が抜けて見える
              （2026-09-29 戸田12R の山田康二: 並び6走・節の全走は7走。BOA-568） */}
          {t(prelimOver ? "meetTab.finishLabelPrelim" : "meetTab.finishLabel")}
        </span>
        {finishes.map((f, i2) => (
          <span key={i2}>
            {i2 > 0 && t("meetTab.finishSeparator")}
            {/* 1着だけ強く出す。勝負駆けは「勝ちがあるか」で
                見え方が変わり、並びの中で一番探される数字 */}
            <span className={f === 1 ? "is-win" : undefined}>
              {f === FINISH_ABSENT
                ? t("meetTab.finishAbsent")
                : (f ?? t("meetTab.finishDq"))}
            </span>
          </span>
        ))}
      </span>
    );

  // 前検は「何位か」より「何秒か」で水面を読む数字。順位だけでは会場の
  // 出方が分からない
  const renderPretestCell = (p) => {
    const pt = pretestOf(p.racerId);
    return (
      <td className="rmt-pretest">
        {pt?.pretest_time !== null && pt?.pretest_time !== undefined
          ? pt.pretest_rank
            ? t("meetTab.pretestCell", {
                time: Number(pt.pretest_time).toFixed(2),
                rank: pt.pretest_rank,
              })
            : Number(pt.pretest_time).toFixed(2)
          : pt?.pretest_rank
            ? t("meetTab.pretestRank", { rank: pt.pretest_rank })
            : "—"}
      </td>
    );
  };

  // 比較表の行見出し（艇番・名前・級別＋着順の並び）
  const renderPlayerHead = (p, finishes) => {
    const color = BOAT_COLORS[p.number] || {};
    const pt = pretestOf(p.racerId);
    return (
      <th scope="row">
        <button
          type="button"
          className="rmt-row-select"
          onClick={() => onFocusBoat(p.number)}
          aria-pressed={p.number === selectedBoat}
        >
          <span
            className="rmt-boat-chip"
            style={{ background: color.bg, color: color.text }}
          >
            {p.number}
          </span>
          <span className="rmt-name" translate="no">
            {p.name?.replace(/\s+/g, "")}
          </span>
          {pt?.racer_class && (
            <span className="rmt-class" title={t("meetTab.classTitle")}>
              {pt.racer_class}
            </span>
          )}
        </button>
        {renderFinishes(finishes)}
      </th>
    );
  };

  return (
    <div className="race-meet-tab">
      <p className="rmt-note">{t("meetTab.note")}</p>

      {/* 1. 6艇横断。レースを開いて最初に見るもの */}
      {/* 6艇とも今節初戦（初日の1R等）でも表を出す。表を出さないと1Rだけ見え方が
          変わり、出場人数も出ない（PR #1102 ファン評価1周目） */}
      {(ranking.length > 0 || notYetRun.length > 0) && (
        <div className="rmt-card">
          <h3 className="rmt-card-title">{t("meetTab.compareTitle")}</h3>
          <table className="rmt-compare">
            <thead>
              <tr>
                <th scope="col">{t("meetTab.colBoat")}</th>
                <th scope="col">{t("meetTab.colScore")}</th>
                <th scope="col">{t("meetTab.colRank")}</th>
                <th scope="col">
                  {/* Ｗ優勝戦の節では、節内順位は片側（24人前後）の中の順位なのに、
                      前検の順位は節全体の中の順位（公式の値）。分母を見出しに出す（BOA-690） */}
                  {seriesSplit
                    ? t("meetTab.colPretestOf", { total: meetTotal })
                    : t("meetTab.colPretest")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers
                .map((p) => ({
                  player: p,
                  row: ranking.find((r) => r.racerId === p.racerId),
                }))
                .filter((x) => x.row)
                .sort((a, b) => b.row.rate - a.row.rate)
                .map(({ player: p, row }, i, arr) => {
                  const tied = tiedCount(row.rank);
                  const inBorder = showBorderBadge && rankInBorder(row, slots);
                  // 目安内の最後の行に太い罫線を引く。「誰が線の上か」は
                  // 数字を突き合わせないと分からず、実際に読み落とされた
                  const borderEdge =
                    inBorder &&
                    !(arr[i + 1] && rankInBorder(arr[i + 1].row, slots));
                  return (
                    <tr
                      key={p.number}
                      className={[
                        p.number === selectedBoat ? "is-current" : "",
                        // 「目安内」をセル内のバッジで出すと、390pxで
                        // 前検の列が card の外へ押し出されて切れた。
                        // 行の左帯＋点線＋注記に置き換える
                        inBorder ? "is-in-border" : "",
                        borderEdge ? "is-border-edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      // 行＝選手なので、行をタップしたら下の詳細が切り替わる。
                      // 下のチップまで指を動かさせない（表は横スクロールしない
                      // ためスワイプ誤爆の懸念も無い）
                      onClick={() => onFocusBoat(p.number)}
                    >
                      {renderPlayerHead(p, row.finishes)}
                      <td className="rmt-rate">
                        {row.runs < MEET_SMALL_SAMPLE_RUNS && (
                          <span
                            className="rmt-warn"
                            title={t("basicInfo.smallSampleTitle")}
                          >
                            ⚠
                          </span>
                        )}
                        {row.rate.toFixed(2)}
                      </td>
                      <td className="rmt-rank">
                        {/* 途中で節を離脱した選手・賞典除外の選手は順位の対象外
                            （公式も同じ）。理由で説明を出し分ける（BOA-587） */}
                        {row.rank === null ? (
                          <span
                            className="rmt-excluded"
                            title={t(
                              `meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason] ?? "withdrawn"}Title`,
                            )}
                          >
                            {t(
                              `meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason] ?? "withdrawn"}`,
                            )}
                          </span>
                        ) : tied > 1 ? (
                          <span title={t("meetTab.rankTiedTitle", { tied })}>
                            {t("meetTab.rankTied", { rank: row.rank })}
                          </span>
                        ) : (
                          t("meetTab.rankPlain", { rank: row.rank })
                        )}
                        {/* 予選の後にFを切った選手。順位は予選で確定しているので
                            残すが、予選中のFの選手（賞典除外で順位なし）と並ぶと
                            食い違って見えるため印を添える（BOA-626） */}
                        {row.rank !== null &&
                          postPrelimFlying.has(row.racerId) && (
                            <span
                              className="rmt-post-flying"
                              title={t("meetTab.postPrelimFlyingTitle")}
                            >
                              {t("meetTab.postPrelimFlying")}
                            </span>
                          )}
                      </td>
                      {renderPretestCell(p)}
                    </tr>
                  );
                })}
              {sortedPlayers
                .map((p) => ({
                  player: p,
                  absent: absentOnly.find((r) => r.racerId === p.racerId),
                }))
                .filter((x) => x.absent)
                .map(({ player: p, absent }) => (
                  <tr
                    key={p.number}
                    className={[
                      "is-absent",
                      p.number === selectedBoat ? "is-current" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onFocusBoat(p.number)}
                  >
                    {renderPlayerHead(p, absent.finishes)}
                    {/* 走数0で得点率・順位は出ない。空欄や0.00にせず
                        欠場と書く（BOA-504） */}
                    <td className="rmt-rate">
                      <span title={t("meetTab.absentTitle")}>
                        {t("meetTab.absent")}
                      </span>
                    </td>
                    <td className="rmt-rank">—</td>
                    {renderPretestCell(p)}
                  </tr>
                ))}
              {/* 今節をまだ走っていない艇（BOA-660） */}
              {notYetRun.map((p) => (
                <tr
                  key={p.number}
                  className={[
                    "is-not-yet-run",
                    p.number === selectedBoat ? "is-current" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onFocusBoat(p.number)}
                >
                  {renderPlayerHead(p, [])}
                  <td className="rmt-rate">—</td>
                  {/* 中止のレースは走らないので「初戦」と書かない（ファン評価1周目） */}
                  <td className="rmt-rank">
                    {t(
                      isCancelled
                        ? "meetTab.notYetRunCancelled"
                        : "meetTab.notYetRun",
                    )}
                  </td>
                  {renderPretestCell(p)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rmt-hint">{t("meetTab.rowHint")}</p>
          <p className="rmt-sub">
            {ranking
              .filter(inTable)
              .some((r) => r.runs < MEET_SMALL_SAMPLE_RUNS) && (
              <>{t("meetTab.smallSampleLegend")} </>
            )}
            {/* 賞典除外・途中帰郷の選手も節は走っているので、「出場」から外さない。
                順位の対象の人数と分けて書く（ファン評価2周目: 出場50人なのに
                前検51位の選手がいた） */}
            {/* Ｗ優勝戦で分けたときは「節の出場」と書かない。下の注記の
                「節全体は◯人」と食い違って読める（BOA-660） */}
            {(() => {
              // 全部の走が欠場の選手も順位の対象外。数えないと「47人（対象42人・
              // 4人を除く）」と足し算が合わない（BOA-660）
              const excluded =
                ranking.length - rankedOnly.length + absentOnly.length;
              // まだ1走もしていない選手も順位にまだ入らない。書かないと初日に
              // 「48人（対象44人・1人を除く）」と合わなかった（BOA-690）
              // 全員がまだ走っていない（初日の1R等）なら「順位の対象は0人」と書かない。
              // 初戦を欠場した選手がいれば「全員が初戦」は誤りなので、従来の書き方に戻す
              if (
                rankedOnly.length === 0 &&
                excluded === 0 &&
                notYetStarted > 0
              )
                return t(
                  `meetTab.compareSub${seriesSplit ? "Series" : ""}AllNotYet`,
                  { all: entrantCount },
                );
              const variant =
                excluded > 0 && notYetStarted > 0
                  ? "ExcludedNotYet"
                  : excluded > 0
                    ? "Excluded"
                    : notYetStarted > 0
                      ? "NotYet"
                      : "";
              return t(
                `meetTab.compareSub${seriesSplit ? "Series" : ""}${variant}`,
                {
                  all: entrantCount,
                  total: variant ? rankedOnly.length : entrantCount,
                  excluded,
                  notYet: notYetStarted,
                },
              );
            })()}
            {/* 「予選後F」の意味（セルの title はタッチ端末で読めない。BOA-626）。
                **表の6艇に印が出ているときだけ**断る。節の誰かに居るだけで出すと、
                表に印が無いのに説明だけ出て「どこにあるのか」と迷う（ファン評価1周目） */}
            {sortedPlayers.some((p) =>
              ranking.some(
                (r) =>
                  r.racerId === p.racerId &&
                  r.rank !== null &&
                  postPrelimFlying.has(r.racerId),
              ),
            ) && <> {t("meetTab.postPrelimFlyingNote")}</>}
            {/* 「欠場」の理由。セルの title はタッチ端末で読めないので本文にも書く
                （BOA-504 ファン評価） */}
            {absentOnly.some(inTable) && <> {t("meetTab.absentNote")}</>}
            {notYetRun.length > 0 && (
              <>
                {" "}
                {t(
                  isCancelled
                    ? "meetTab.notYetRunCancelledNote"
                    : "meetTab.notYetRunNote",
                )}
              </>
            )}
            {/* 着順の並びの「欠」の意味と、得点率の分母から外していること
                （一部欠場の開催でも書く。BOA-504 ファン評価） */}
            {[...ranking, ...absentOnly]
              .filter(inTable)
              .some((r) => r.finishes.includes(FINISH_ABSENT)) && (
              <> {t("meetTab.finishAbsentNote")}</>
            )}
            {showBorderBadge && (
              <>
                {" "}
                {t("meetTab.borderLine", {
                  slots,
                  rate: border.toFixed(2),
                })}{" "}
                {t("meetTab.borderNote")}{" "}
                {/* 何走時点の目安かを断る。2日目の朝の目安は、予選終了時の目安と
                    平均0.46点ずれる（BOA-690 の実測。数値は画面に出さない） */}
                {t("meetTab.borderAsOfRuns", { runs: medianRuns })}
              </>
            )}
            {/* まだ全員が走っていない間は目安を出さない理由を書く（BOA-690） */}
            {!bordersReady && !isCancelled && !isAfterPrelim && !prelimOver && (
              <>
                {" "}
                {/* Ｗ優勝戦では「出場選手」が24人か48人か読めないので書き分ける */}
                {t(
                  seriesSplit
                    ? "meetTab.borderPendingSeries"
                    : "meetTab.borderPending",
                )}
              </>
            )}
          </p>
          {/* 順位の対象外の内訳（BOA-697）。人数だけでは誰が外れたか分からず、予選の後に
              順位が動いた理由も読めなかった。公式の備考欄に近い形で名前を理由ごとに出す。
              7人以上は6人まで出して「ほか◯人」と畳む（行が長くなりすぎないように） */}
          {excludedGroups.length > 0 && (
            <p className="rmt-excluded-list">
              <strong>{t("meetTab.excludedListLabel")}</strong>
              {(() => {
                let budget = EXCLUDED_LIST_MAX;
                const parts = [];
                for (const g of excludedGroups) {
                  if (budget <= 0) break;
                  const shown = g.names.slice(0, budget);
                  budget -= shown.length;
                  parts.push(
                    <span key={g.reason}>
                      {parts.length > 0 && t("meetTab.excludedGroupSeparator")}
                      <span translate="no">
                        {shown.join(t("meetTab.listSeparator"))}
                      </span>
                      {t("meetTab.excludedReasonWrap", {
                        reason: t(`meetTab.excludedReason_${g.reason}`),
                      })}
                    </span>,
                  );
                }
                const total = excludedGroups.reduce(
                  (n, g) => n + g.names.length,
                  0,
                );
                return (
                  <>
                    {parts}
                    {total > EXCLUDED_LIST_MAX &&
                      t("meetTab.excludedMore", {
                        count: total - EXCLUDED_LIST_MAX,
                      })}
                  </>
                );
              })()}
            </p>
          )}
          {/* **Ｗ優勝戦の節**は1つの節に独立した2つの勝ち上がりが同居する
              （全期間で6節）。何も言わずに人数が半分になると「なぜ減ったのか」に
              なるので、節全体の人数と併せて断る。準優の目安が出ていない日は
              その語に触れない。両方の選手が乗るレース（予選終了後の消化レース。
              実データでは多摩川に5本）では分けられないので、そちらも断る（BOA-511） */}
          {board?.isSplitMeet && (
            <p className="rmt-series-note">
              {seriesSplit
                ? t(
                    showBorderBadge
                      ? "meetTab.seriesSplitNote"
                      : "meetTab.seriesSplitNoteNoBorder",
                    { meetTotal },
                  )
                : t("meetTab.seriesMixedNote", { total: rankedOnly.length })}
            </p>
          )}
          {/* 公式の順位表は52名中3名（賞典除外1・途中帰郷2）を順位から外す。
              当社は全員で順位を振るため下位ほどズレる（2026-09-27に若松G1で
              実測: 得点率は6/6一致、順位は最大4つ差）。除外の判定材料が
              自社データに無いので、合わせにいかずに違いを書く */}
          <p className="rmt-rank-note">
            {/* 公式の備考で外すのは予選の後だけで、そのときは得点率も公式の値になる
                （rankSourceNoteOfficial）。それ以外は当社の推定（PR #1149 ファン評価2周目） */}
            {t(
              usesOfficialScore
                ? "meetTab.rankSourceNoteOfficial"
                : "meetTab.rankSourceNote",
            )}
            {/* 予選の後の扱い（Fは外さない・帰郷は外す）は、予選が終わってから
                関係する話なので、予選中は出さない（注記が長くなるだけだった） */}
            {!usesOfficialScore && prelimOver && (
              <> {t("meetTab.rankSourceNoteAfterPrelim")}</>
            )}
          </p>
          <p className="rmt-source">{t("basicInfo.meetPretestSource")}</p>
        </div>
      )}

      {board === undefined && (
        <p className="rmt-loading">{t("basicInfo.loading")}</p>
      )}
      {board !== undefined &&
        ranking.length === 0 &&
        notYetRun.length === 0 && (
          <p className="rmt-empty">{t("basicInfo.meetEmpty")}</p>
        )}

      {/* 1a. 得点率早見（6艇×着順）。公式と同じ行列で、ボーダーの目安との
          関係を色で示す。「当確」という断定はしない（番組が未確定で
          ボーダー自体が推定のため。公式も「毎日変動します」と注記している） */}
      {forecastRows.length > 0 && (
        <div className="rmt-card">
          <h3 className="rmt-card-title">{t("meetTab.forecastTitle")}</h3>
          <div className={`hscroll-hint${forecastHasMore ? " has-more" : ""}`}>
            {forecastHasMore && (
              <button
                type="button"
                className="hscroll-more"
                onClick={forecastScrollRight}
                aria-hidden="true"
                tabIndex={-1}
              >
                ›
              </button>
            )}
            <div
              className="rmt-forecast-scroll"
              ref={forecastRef}
              onScroll={forecastUpdate}
            >
              <table className="rmt-forecast-table">
                <thead>
                  <tr>
                    <th scope="col">{t("meetTab.colBoat")}</th>
                    <th scope="col">{t("meetTab.colScore")}</th>
                    {/* 公式（PC横長）は必要得点を右端に置くが、390pxでは
                        右端の列が画面外になる。「今の得点率」と「あと何点要るか」
                        が一番見たい2つなので前に出す */}
                    {hasNeeded && <th scope="col">{t("meetTab.colNeeded")}</th>}
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <th key={n} scope="col">
                        {t("meetTab.forecastRankHeader", { rank: n })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecastRows.map(
                    ({ player: p, row, cells, needed, remaining }) => {
                      const color = BOAT_COLORS[p.number] || {};
                      return (
                        <tr
                          key={p.number}
                          className={
                            p.number === selectedBoat ? "is-current" : ""
                          }
                          onClick={() => onFocusBoat(p.number)}
                        >
                          <th scope="row">
                            <button
                              type="button"
                              className="rmt-row-select"
                              onClick={() => onFocusBoat(p.number)}
                              aria-pressed={p.number === selectedBoat}
                            >
                              <span
                                className="rmt-boat-chip"
                                style={{
                                  background: color.bg,
                                  color: color.text,
                                }}
                              >
                                {p.number}
                              </span>
                              <span className="rmt-name" translate="no">
                                {p.name?.replace(/\s+/g, "")}
                              </span>
                            </button>
                          </th>
                          <td
                            className={`rmt-rate${
                              showBorderBadge &&
                              border !== undefined &&
                              !row.withdrawn &&
                              row.rate >= border
                                ? " is-in-border"
                                : ""
                            }`}
                          >
                            {row.rate.toFixed(2)}
                          </td>
                          {hasNeeded && (
                            <td className="rmt-needed">
                              {/* 賞典除外の選手は準優に乗れないので、必要得点を
                                出さない（BOA-587） */}
                              {AWARD_EXCLUDED_REASONS.has(
                                row.excludedReason,
                              ) ? (
                                <span className="rmt-excluded">
                                  {t(
                                    `meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason]}`,
                                  )}
                                </span>
                              ) : needed === null ? (
                                "—"
                              ) : needed.reachable ? (
                                // 必要得点は今日の残りの予選ぶん（1日2走ある選手もいる）
                                // を足した点数。横の早見は次の1走だけなので、2走以上
                                // 残っていれば走数を添える。無いと「1着でも目安に
                                // 届かないのに必要得点17」と食い違って読める（BOA-596）
                                <>
                                  {t("meetTab.neededPoints", {
                                    points: needed.needed,
                                  })}
                                  {/* 走数は2行目に小さく出す。1行に並べると
                                    375pxで列が広がり、早見の3着以降が
                                    最初の画面から外れた（ファン評価1周目） */}
                                  {remaining > 1 && (
                                    <span className="rmt-needed-runs">
                                      {t("meetTab.neededPointsRuns", {
                                        runs: remaining,
                                      })}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="rmt-unreachable">
                                  {t("meetTab.neededUnreachable")}
                                </span>
                              )}
                            </td>
                          )}
                          {cells.map((f) => (
                            <td
                              key={f.rank}
                              className={
                                showBorderBadge &&
                                border !== undefined &&
                                !row.withdrawn &&
                                // 今日2走以上残る選手の行は色を付けない。セルの数字は
                                // 「次の1走だけ」の得点率で、準優に届くかは残りの
                                // 走次第なので、その着で届くとは言えない。1周目は
                                // 「残りを全部6着でも届くか」で塗ったが、数字と色の
                                // 基準がずれ「7.00なのに色なし」と読まれた（BOA-596）
                                remaining <= 1 &&
                                f.rate >= border
                                  ? "is-in-border"
                                  : undefined
                              }
                            >
                              {f.rate.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="rmt-sub">
            {showBorderBadge && border !== undefined
              ? t("meetTab.forecastNote", {
                  slots,
                  rate: border.toFixed(2),
                })
              : t("meetTab.forecastNoteNoBorder")}
          </p>
          {/* 目安の出し方と誤差、必要得点の式は長いので折りたたむ。
              実測の差（若松G1 0.07 / 桐生一般 0.83）まで書くのは、
              「数位ずれる」を具体で示さないと目安の精度を過信されるため */}
          {showBorderBadge && border !== undefined && (
            <details className="rmt-how">
              <summary>{t("meetTab.forecastDetailSummary")}</summary>
              <p className="rmt-caveat">
                {t("meetTab.forecastDetail", { slots })}
              </p>
            </details>
          )}
        </div>
      )}

      {/* 1b. 6艇の推移（レース単位）。表の数字だけでは「誰が仕上がってきたか」
          が読めない。同じ節・同じ水面を走った6艇なので、縦の物差しを
          共通にして並べる（1艇ずつ切り替えて見比べる手間を無くす） */}
      {trendDomain && (
        <div className="rmt-card">
          <div className="rmt-card-head">
            <h3 className="rmt-card-title">{t("meetTab.compareTrendTitle")}</h3>
            <div className="rmt-metric-chips" role="group">
              {[
                { key: "st", label: t("meetTab.compareTrendSt") },
                { key: "exhibition", label: t("meetTab.compareTrendEx") },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`rmt-metric-chip${trendMetric === m.key ? " is-active" : ""}`}
                  onClick={() => setTrendMetric(m.key)}
                  aria-pressed={trendMetric === m.key}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {/* 右端の数値が何か分からない、という指摘（2026-09-27）。列見出しを出す */}
          <div className="rmt-trend-head">
            {/* 点の下の数字が着順だと行の中で分かるように（BOA-537）。真ん中の列は
                日付の目盛りに使うので、名前の列の上に置く */}
            <span className="rmt-trend-head-sub">
              {t("meetTab.trendFinishHeader")}
            </span>
            {/* 日付の目盛り（点と同じ横位置）。縦のガイド線は引かない */}
            <span className="rmt-trend-days" aria-hidden="true">
              {dayTickLabels(trendDates).map((label, i) => (
                <span
                  key={trendDates[i]}
                  className="rmt-trend-day"
                  style={{
                    left: `${sparkLeftPercent(
                      dayCenter(i, trendDates.length),
                    ).toFixed(2)}%`,
                  }}
                >
                  {label}
                </span>
              ))}
            </span>
            <span className="rmt-trend-last">
              {t("meetTab.trendLastHeader")}
            </span>
          </div>
          <ul className="rmt-trend-rows">
            {trendRows.map(({ player: p, runs, layout }) => {
              const color = BOAT_COLORS[p.number] || {};
              const vals = runs.map((r) => r[trendKey]);
              // 右端の「前走」。STは直前がFならFと出す（BOA-597）。展示はFでも
              // 走っている（展示タイムはある）ので、数値のある最後の走のまま
              const lastRun = lastStartTiming(runs, {
                valueOf: (r) => r[trendKey],
                markOf: (r) =>
                  trendKey === "st" && (r.finish === "F" || r.finish === "L")
                    ? r.finish
                    : null,
              });
              return (
                <li key={p.number}>
                  {/* 行全体を1つのボタンにする。以前は艇番・選手名だけが押せて、
                      いちばん大きい的の折れ線と右端の値を押しても何も起きなかった。
                      すぐ上の表は「行をタップ」で切り替わるので、そろえる（BOA-550） */}
                  <button
                    type="button"
                    className="rmt-trend-row"
                    onClick={() => onFocusBoat(p.number)}
                    aria-pressed={p.number === selectedBoat}
                  >
                    <span className="rmt-trend-label">
                      <span
                        className="rmt-boat-chip"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {p.number}
                      </span>
                      <span className="rmt-name" translate="no">
                        {p.name?.replace(/\s+/g, "")}
                      </span>
                    </span>
                    <MeetSparkline
                      points={vals.map((v) => ({ value: v }))}
                      domain={trendDomain}
                      baseline={trendMean}
                      // 線は公式の艇色そのままだと1号艇（白）が背景に溶ける
                      color={
                        BOAT_LINE_COLORS[p.number] ||
                        "var(--brand-accent-primary)"
                      }
                      height={34}
                      // 1走の選手も前走の点を出す（空白だと取れていないと読まれる）
                      allowSinglePoint
                      // 前走が F・L なら、1つ前の走に「前走」の大きい点を付けない。
                      // 右端は「F」なのに大きい点が0.09の走に付き、前走が好スタートに
                      // 見えていた（BOA-597 ファン評価1周目）
                      markLast={!lastRun?.mark}
                      xPositions={layout.xs}
                      xCenters={layout.centers}
                      breakBefore={layout.breakBefore}
                      // 各走の着順を点の下に出す（BOA-537。ファン4人のパネル）
                      pointLabels={runs.map((r) =>
                        r.finish === null || r.finish === undefined
                          ? null
                          : {
                              // 公式の記号（エ・転 等）はデータ出走表と同じ表記にする（BOA-654）
                              text: finishLabelOf(r.finish),
                              win: r.finish === 1,
                              mark: typeof r.finish === "string",
                            },
                      )}
                    />
                    <span className="rmt-trend-last">
                      {lastRun === null
                        ? "—"
                        : (lastRun.mark ?? lastRun.value.toFixed(2))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* 横軸の期間と、行を押すと下が変わること。どちらも
              「点を押したら情報が出る」より先に要る、というファン評価の結論
              （2026-09-29、BOA-495） */}
          {trendRange && (
            <p className="rmt-trend-range">
              {/* 1日だけの節で「9/20〜9/20」と書かない（BOA-538 ファン評価） */}
              {trendRange.from === trendRange.to
                ? t("meetTab.compareTrendRangeOneDay", { day: trendRange.from })
                : t("meetTab.compareTrendRange", trendRange)}
              {/* 目盛りから抜けている日の理由（BOA-636）。横軸の範囲の中だけ。
                  段落の他の文（2xs）に埋もれないよう、この1文だけ一段大きくする
                  （ファン評価3周目、予選確定の一文と同じ大きさ） */}
              {trendNoRaceDays.length > 0 && (
                <>
                  {" "}
                  <span className="rmt-trend-noday">
                    {t("meetTab.compareTrendNoRaceDays", {
                      days: mdList(trendNoRaceDays),
                    })}
                  </span>
                </>
              )}
            </p>
          )}
          <p className="rmt-hint">{t("meetTab.compareTrendHint")}</p>
          <p className="rmt-spark-note">
            {t("meetTab.compareTrendFinishNote")}
          </p>
          <p className="rmt-spark-note">{t("meetTab.compareTrendNote")}</p>
        </div>
      )}

      {/* 2. 選んだ1艇の詳細 */}
      <div
        className="rmt-chip-row"
        role="group"
        aria-label={t("wakuInfo.boatLabel")}
      >
        {sortedPlayers.map((p) => {
          const color = BOAT_COLORS[p.number] || {};
          const active = selectedPlayer?.number === p.number;
          return (
            <button
              key={p.number}
              type="button"
              className={`rmt-select-chip${active ? " is-active" : ""}`}
              style={
                active ? { background: color.bg, color: color.text } : undefined
              }
              onClick={() => onFocusBoat(p.number)}
              aria-pressed={active}
            >
              <span>{p.number}</span>
              <span translate="no">{p.name?.replace(/\s+/g, "")}</span>
            </button>
          );
        })}
      </div>

      <div className="rmt-card">
        {/* 全走欠場の選手は得点率の見出しが出ない。何も書かないと「取り忘れ」と
            読まれるので、欠場だと書く（BOA-504 ファン評価） */}
        {!mine &&
          absentOnly.some((r) => r.racerId === selectedPlayer?.racerId) && (
            <p className="rmt-detail-score">{t("meetTab.absentDetail")}</p>
          )}
        {mine && (
          <p className="rmt-detail-score">
            {t(
              prelimOver
                ? "basicInfo.meetScorePrelimOver"
                : "basicInfo.meetScore",
              {
                rate: mine.rate.toFixed(2),
                n: mine.runs,
                // 公式の得点率一覧がある開催では公式の値をそのまま出している。
                // 出典を「当社計算」と書いたままにすると嘘になる（BOA-475）
                source: t(
                  mine.fromOfficial
                    ? "meetTab.sourceOfficial"
                    : "meetTab.sourceOwn",
                ),
              },
            )}
            {/* 順位の対象外（賞典除外・途中帰郷）の理由は、予選が終わった後も出す。
                目安の行は予選中しか出ないので、そちらに頼ると最終日に消えていた
                （ファン評価2周目） */}
            {mine.withdrawn && !(showBorder && border !== undefined) && (
              <span className="rmt-detail-border">
                {t(
                  `meetTab.${EXCLUDED_LABEL_KEY[mine.excludedReason] ?? "withdrawn"}Title`,
                )}
              </span>
            )}
            {showBorder && border !== undefined && (
              <span className="rmt-detail-border">
                {mine.withdrawn
                  ? // 順位の対象外（賞典除外・途中帰郷）は目安との距離を言わない。
                    // rank が null なので `<= slots` で比べると「目安の中」になる（BOA-587）
                    t(
                      `meetTab.${EXCLUDED_LABEL_KEY[mine.excludedReason] ?? "withdrawn"}Title`,
                    )
                  : rankInBorder(mine, slots)
                    ? t("basicInfo.meetBorderIn", { slots })
                    : t("basicInfo.meetBorder", {
                        slots,
                        rate: border.toFixed(2),
                        diff: (border - mine.rate).toFixed(2),
                      })}
              </span>
            )}
          </p>
        )}
        {/* 中止のレースでは早見・目安を出さないので、その理由をここに出す（BOA-658。
            丸一日中止の日に、前日までの数字で「今日の着順でこう動く」が出ていた） */}
        {isCancelled && (
          <p className="rmt-forecast rmt-forecast-settled">
            {t("meetTab.cancelledNoForecast")}
          </p>
        )}
        {mine && !isCancelled && prelimOver && (
          // 早見（6艇分）は予選中しか出さないので、終わっている理由をここに出す。
          // 「もう動かない」は勝負駆けの読みを決める情報なので、補足より一段強く出す
          // （BOA-636。375pxで10.4pxの灰色だった）
          <p className="rmt-forecast rmt-forecast-settled">
            {isAfterPrelim
              ? t("basicInfo.meetScoreNoForecast", { stage })
              : t(
                  prelimEndDay
                    ? "meetTab.prelimOverNoteDay"
                    : "meetTab.prelimOverNote",
                  { date: prelimEndDate ?? "", day: prelimEndDay ?? "" },
                )}
            {/* 丸一日中止の日は日目に数えない（公式も翌日に同じ日目を振り直す）。
                書かないと、初日から日付を数えて「1日ずれている」と読まれる
                （BOA-636、PR #1044 ファン評価） */}
            {!isAfterPrelim && noRaceDaysBeforePrelimEnd.length > 0 && (
              <>
                {" "}
                {t("meetTab.prelimNoRaceDays", {
                  days: mdList(noRaceDaysBeforePrelimEnd),
                })}
              </>
            )}
          </p>
        )}

        {records === undefined ? (
          <p className="rmt-loading">{t("basicInfo.loading")}</p>
        ) : meet.length === 0 ? (
          <p className="rmt-empty">
            {t(
              isCancelled ? "meetTab.meetEmptyCancelled" : "basicInfo.meetEmpty",
            )}
          </p>
        ) : (
          <>
            {/* 今節の走順に並べた小さな線。数字の羅列だと8走ぶんの上下を
                頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
                判定文は出さず、形と基準線を見せて読み手に委ねる */}
            <div className="rmt-sparks">
              <div className="rmt-spark">
                <div className="rmt-spark-head">
                  <span className="rmt-spark-title">
                    {t("meetTab.sparkStTitle")}
                  </span>
                  {st.diff !== null && (
                    <span className="rmt-spark-base">
                      {t("meetTab.sparkStMeta", {
                        avg: st.meetAvg.toFixed(2),
                        n: st.meetN,
                        base: st.baseAvg === null ? "—" : st.baseAvg.toFixed(2),
                      })}{" "}
                      <span className="rmt-verdict">
                        {st.diff <= -MEET_ST_DIFF_THRESHOLD
                          ? t("basicInfo.meetTrendStPush", {
                              diff: Math.abs(st.diff).toFixed(2),
                            })
                          : st.diff >= MEET_ST_DIFF_THRESHOLD
                            ? t("basicInfo.meetTrendStCareful", {
                                diff: st.diff.toFixed(2),
                              })
                            : t("basicInfo.meetTrendStFlat")}
                      </span>
                    </span>
                  )}
                </div>
                <MeetSparkline
                  points={meetRows.map((r) => ({
                    value: r.startTiming ?? null,
                    label: sparkLabel(
                      r,
                      "meetTab.compareTrendSt",
                      r.startTiming,
                      stRankByRace[r.raceId] ?? null,
                    ),
                  }))}
                  baseline={st.baseAvg}
                  color="var(--brand-accent-primary)"
                  markLast={!lastSt?.mark}
                />
                <div className="rmt-spark-foot">
                  <span>{firstMeetDate}</span>
                  <span>
                    {lastSt === null
                      ? "—"
                      : t("meetTab.sparkLast", {
                          value: lastSt.mark ?? lastSt.value.toFixed(2),
                        })}
                  </span>
                </div>
              </div>

              <div className="rmt-spark">
                <div className="rmt-spark-head">
                  <span className="rmt-spark-title">
                    {t("meetTab.sparkExTitle")}
                  </span>
                  {pre?.pretest_time !== null &&
                    pre?.pretest_time !== undefined && (
                      <span className="rmt-spark-base">
                        {pre.pretest_rank
                          ? t("meetTab.sparkExMetaRank", {
                              value: Number(pre.pretest_time).toFixed(2),
                              rank: pre.pretest_rank,
                            })
                          : t("meetTab.sparkBaselinePretest", {
                              value: Number(pre.pretest_time).toFixed(2),
                            })}
                      </span>
                    )}
                </div>
                <MeetSparkline
                  points={meetRows.map((r) => ({
                    value: r.exhibitionTime ?? null,
                    label: sparkLabel(
                      r,
                      "meetTab.compareTrendEx",
                      r.exhibitionTime,
                      r.exhibitionRank ?? null,
                    ),
                  }))}
                  // 基準は「その日の会場全体の展示平均」。水面は日ごとに
                  // 0.08秒動くため（若松2026-09-22〜27の実測で6.829〜6.907）、
                  // 生タイムだけでは重い日の6.90と軽い日の6.90を同じに読む
                  referenceSeries={meetRows.map(
                    (r) => venueDailyExhibitionAvg[r.date] ?? null,
                  )}
                  color="var(--color-info-text, #2a7fbf)"
                />
                <div className="rmt-spark-foot">
                  <span>{firstMeetDate}</span>
                  <span>
                    {lastExhibition === null
                      ? "—"
                      : t("meetTab.sparkLast", {
                          value: lastExhibition.toFixed(2),
                        })}
                  </span>
                </div>
              </div>
              <p className="rmt-spark-note">{t("meetTab.sparkNote")}</p>
            </div>

            {/* 展示は「初日→直近」の2点比較で上向き/下向きと断定していたが、
                間の走を捨てるため実態と逆の結論になっていた（2026-09-27の
                実測: 6.86→6.89→6.77→6.78→6.88→6.81→6.76→6.87 で
                「1つ下向き」と出るが、今節ベスト級は間にある）。
                判定はやめ、走ごとの生の数字を表に並べて読み手に委ねる */}
            <RaceHistoryTable
              rows={meetRows.map((r) => ({
                ...r,
                startTimingRank: stRankByRace[r.raceId] ?? null,
              }))}
              showEntryCourse
              showExhibition
              compactDate
              omitColumns={["venue", "raceTitle", "grade", "stage"]}
              buildRaceHref={(id) => localize(`/race/${id}`)}
            />
            <details className="rmt-how">
              <summary>{t("basicInfo.conditionsHowToRead")}</summary>
              <p className="rmt-caveat">{t("basicInfo.meetScoreNote")}</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

export default RaceMeetTab;
