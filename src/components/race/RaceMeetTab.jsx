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
import { getMeetScoreboard } from "../../services/meetQueries2.js";
import { getRacerScopedRaceStats } from "../../services/racerQueries2.js";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { FINISH_ABSENT } from "./seriesPoints";
import { finishMarkKeyOf } from "../../utils/prevResult";
import { buildMeetModel } from "./RaceMeetTabModel";
import RaceMeetTabCompare from "./RaceMeetTabCompare";
import RaceMeetTabForecast from "./RaceMeetTabForecast";
import RaceMeetTabTrend from "./RaceMeetTabTrend";
import RaceMeetTabDetail from "./RaceMeetTabDetail";
import "./RaceMeetTab.css";

// 句点の後に空白を入れない言語（BOA-738）
const CJK_SENTENCE_LANGS = new Set(["ja", "zh-TW"]);

// 節の取得（effect の中身）。戻り値は effect の後始末
function subscribeBoard(raceId, venueCode, setBoard) {
  if (!raceId || venueCode === null || venueCode === undefined)
    return undefined;
  let cancelled = false;
  getMeetScoreboard(raceId, venueCode)
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
}

// 選んだ選手の履歴の取得（effect の中身）。戻り値は effect の後始末
function subscribeRecords(racerId, setRecords) {
  if (!racerId) return undefined;
  let cancelled = false;
  // setRecords(undefined) を同期で呼ぶと連鎖レンダーになるため、
  // 取得結果が来たときだけ更新する（切替中は前の選手の表が一瞬残るが、
  // 下のチップで誰を見ているかは分かる）
  getRacerScopedRaceStats(racerId)
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
}

// 表の印の説明。印が表の6艇に出ているときだけ断る（セルの title はタッチ端末で
// 読めない）。予選後F（BOA-626）、全走欠場（BOA-504）、今節初戦・未出走（BOA-660）、
// 着順の「欠」とその分母（BOA-504）
function buildMarkNotes(m) {
  const { t, ranking, absentOnly, inTable, notYetRun, isCancelled } = m;
  const showFinishAbsentNote = [...ranking, ...absentOnly]
    .filter(inTable)
    .some((r) => r.finishes.includes(FINISH_ABSENT));
  return [
    m.showPostPrelimFlyingNote && t("meetTab.postPrelimFlyingNote"),
    m.showAbsentNote && t("meetTab.absentNote"),
    notYetRun.length > 0 &&
      t(
        isCancelled
          ? "meetTab.notYetRunCancelledNote"
          : "meetTab.notYetRunNote",
      ),
    showFinishAbsentNote && t("meetTab.finishAbsentNote"),
  ].filter(Boolean);
}

// 全走欠場の選手は得点率の見出しが出ない。何も書かないと「取り忘れ」と
// 読まれるので、欠場だと書く（BOA-504 ファン評価）
function absentDetailTextOf(m) {
  const { t, mine, absentOnly, selectedPlayer } = m;
  return (
    !mine &&
    absentOnly.some((r) => r.racerId === selectedPlayer?.racerId) &&
    t("meetTab.absentDetail")
  );
}

// 取得前の表示と、節の走が1件も無いときの表示
function MeetBoardStatus({ m }) {
  const { t, board, ranking, notYetRun } = m;
  if (board === undefined)
    return <p className="rmt-loading">{t("basicInfo.loading")}</p>;
  if (ranking.length === 0 && notYetRun.length === 0)
    return <p className="rmt-empty">{t("basicInfo.meetEmpty")}</p>;
  return null;
}

function RaceMeetTab({
  raceId,
  venueCode,
  players,
  focusedBoat,
  onFocusBoat,
  // 中止が確定したレース（BOA-658）。行われないレースに「今日の着順でこう動く」を出さない
  isCancelled = false,
}) {
  const { t, i18n } = useTranslation();
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
  // 早見の表（6艇×着順）は390pxで右が切れるため手がかりを出す。
  // 行数が決まってから測り直す（マウント直後は取得前で幅が無い）
  const forecastScroll = useHorizontalScrollHint([
    sortedPlayers.length,
    board?.meetStart,
  ]);
  // 選んでいる艇はタブをまたいで共有する（BOA-492）。共有値が null（＝まだ
  // どの艇も選んでいない）のときは従来どおり1号艇を見せる
  const selectedBoat = focusedBoat ?? sortedPlayers[0]?.number ?? null;

  useEffect(
    () => subscribeBoard(raceId, venueCode, setBoard),
    [raceId, venueCode],
  );

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];

  useEffect(
    () => subscribeRecords(selectedPlayer?.racerId, setRecords),
    [selectedPlayer?.racerId],
  );

  if (sortedPlayers.length === 0) return null;

  const base = {
    t,
    language: i18n.language,
    // 文と文の区切り。和文（ja・zh-TW）は句点の後に空白を入れない（BOA-738）。
    // 空白だけの値は locale の検査で「中身が空のキー」になるので、言語で分ける
    sp: CJK_SENTENCE_LANGS.has(i18n.language) ? "" : " ",
    board,
    records,
    raceId,
    venueCode,
    sortedPlayers,
    selectedPlayer,
    selectedBoat,
    onFocusBoat,
    isCancelled,
    localize,
    finishLabelOf,
    trendMetric,
    setTrendMetric,
    forecastScroll,
  };
  const model = { ...base, ...buildMeetModel(base) };
  const m = { ...model, markNotes: buildMarkNotes(model) };
  m.hasMarkNotes = m.markNotes.length > 0;
  m.absentDetailText = absentDetailTextOf(m);

  return (
    <div className="race-meet-tab">
      <p className="rmt-note">{t("meetTab.note")}</p>

      {/* 1. 6艇横断。レースを開いて最初に見るもの */}
      <RaceMeetTabCompare m={m} />
      <MeetBoardStatus m={m} />
      {/* 1a. 得点率早見（6艇×着順） */}
      <RaceMeetTabForecast m={m} />
      {/* 1b. 6艇の推移（レース単位） */}
      <RaceMeetTabTrend m={m} />
      <RaceMeetTabDetail m={m} />
    </div>
  );
}

export default RaceMeetTab;
