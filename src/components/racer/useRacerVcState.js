import { useEffect, useMemo, useState } from "react";
import { aggregateRacerCrossStats } from "../../services/core.js";
import { getRacerRaceHistory } from "../../services/racerQueries2.js";
import {
  entryCourseCounts,
  filterByEntryCourse,
} from "../../pure/racerEntryCourseFilter.js";

// 選手ページの成績・調子（RacerPerformanceStats）の絞り込みと出走履歴の状態。
// 絞り込みはフロント側の純関数で再集計し、履歴は racerId ごとに1回だけ取る（ADR-0063）

/** 会場×枠番×グレード×レース種別の絞り込みと、レース一覧のページ・再試行のトークン */
function useVcFilterState() {
  // 会場×枠番フィルタ。「全会場」「全枠番」がそれぞれ絞り込みなしを表す。
  // 表示は「枠番」。実際の進入コースはBOA-257の制約により取得できないため、
  // 発走前に決まる枠番（艇番）基準で集計・表示する
  const [vcVenue, setVcVenue] = useState("all");
  const [vcBoat, setVcBoat] = useState("all");
  // グレード（races.race_grade）・レース種別（race_conditions.race_stage、
  // 「優勝戦」「準優勝戦」の完全一致のみ判定可能。BOA-159）
  const [vcGrade, setVcGrade] = useState("all");
  const [vcStage, setVcStage] = useState("all");
  // 実際に入った進入コース（オーナー 2026-11-25）。進入が分かった走（2025-12 以降）だけを数える
  const [vcCourse, setVcCourse] = useState("all");
  // レース一覧のページ番号（1始まり、常時表示。ADR-0063）。フィルタが変わったら1ページ目に
  // 戻す必要があるため、フィルタ変更を検知してリセットする
  const [vcRacePage, setVcRacePage] = useState(1);
  // 出走履歴取得が失敗した際、手動で再試行するためのトークン。フィルタ
  // （vcVenue/vcBoat/vcGrade/vcStage）はネットワークI/Oを発生させない設計に
  // しているため、選び直しでは再試行にならない。専用のトリガーとして分離している
  const [vcRetryToken, setVcRetryToken] = useState(0);
  return {
    vcVenue,
    setVcVenue,
    vcBoat,
    setVcBoat,
    vcGrade,
    setVcGrade,
    vcStage,
    setVcStage,
    vcCourse,
    setVcCourse,
    vcRacePage,
    setVcRacePage,
    vcRetryToken,
    setVcRetryToken,
  };
}

/** 出走履歴（racerId ごとに1回取る）と、その読み込みの状態 */
function useVcHistory(racerId, vcRetryToken, onHistoryStateChange) {
  // racerIdをデータと一緒に保持し、propsのracerIdと食い違えば「別選手の
  // 履歴」として無視する（同一マウントのまま別選手ページへ遷移した場合に、
  // 前選手の履歴が新しい選手のフィルタ結果として残り続けるのを防ぐ）。
  // useEffectでracerId変化時にリセットする代わりにレンダー中の導出値として
  // 扱うことで、エフェクト内での同期的なsetStateを避けている
  const [vcHistoryState, setVcHistoryState] = useState({
    racerId: null,
    fetching: false,
    data: null,
    error: false,
  });
  const vcHistory =
    vcHistoryState.racerId === racerId ? vcHistoryState.data : null;
  const vcHistoryLoading =
    !!racerId &&
    vcHistory === null &&
    vcHistoryState.racerId === racerId &&
    vcHistoryState.fetching;
  const vcHistoryError =
    vcHistoryState.racerId === racerId && vcHistoryState.error;

  // 履歴はレース一覧・ST推移・条件別の共通入力。別選手の履歴は未完了とする。
  const snapshotHistoryState = vcHistoryError
    ? "error"
    : vcHistory === null
      ? "loading"
      : vcHistory.length
        ? "done"
        : "empty";
  useEffect(() => {
    onHistoryStateChange?.({ racerId, state: snapshotHistoryState });
  }, [racerId, snapshotHistoryState, onHistoryStateChange]);

  useEffect(() => {
    // 決まり手・推移・レース一覧を常時表示するため（ADR-0063）、フィルタ操作を
    // 待たずracerIdが確定したら常に履歴を取得する（フィルタ変更自体は
    // 追加I/Oを発生させない、既存の最適化方針は維持）
    if (!racerId || vcHistory !== null) return;
    let cancelled = false;
    const loadHistory = async () => {
      setVcHistoryState({ racerId, fetching: true, data: null, error: false });
      try {
        const result = await getRacerRaceHistory(racerId);
        if (!cancelled) {
          setVcHistoryState({
            racerId,
            fetching: false,
            data: result,
            error: false,
          });
        }
      } catch (err) {
        console.error("選手出走履歴取得エラー:", err.message);
        if (!cancelled) {
          setVcHistoryState({
            racerId,
            fetching: false,
            data: null,
            error: true,
          });
        }
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [racerId, vcHistory, vcRetryToken]);

  return { vcHistory, vcHistoryLoading, vcHistoryError, snapshotHistoryState };
}

/** 選手が変わったら絞り込みを、絞り込みか選手が変わったらレース一覧のページを、描画の中で戻す */
function useVcResets(racerId, f) {
  // 同じマウントで選手が変わったら、コミット前にフィルタを初期値へ戻す。
  const [previousRacerId, setPreviousRacerId] = useState(racerId);
  if (previousRacerId !== racerId) {
    setPreviousRacerId(racerId);
    f.setVcVenue("all");
    f.setVcBoat("all");
    f.setVcGrade("all");
    f.setVcStage("all");
    f.setVcCourse("all");
  }

  // フィルタまたは選手が変わったら、レース一覧を1ページ目へ戻す。
  const racePageInputs = [
    racerId,
    f.vcVenue,
    f.vcBoat,
    f.vcGrade,
    f.vcStage,
    f.vcCourse,
  ];
  const [previousRacePageInputs, setPreviousRacePageInputs] =
    useState(racePageInputs);
  if (
    racePageInputs.some(
      (value, index) => value !== previousRacePageInputs[index],
    )
  ) {
    setPreviousRacePageInputs(racePageInputs);
    f.setVcRacePage(1);
  }
}

/** クロス集計（成績ブロック用）と、履歴から数えた枠番別成績 */
function useVcCross(vcHistory, f) {
  const { vcVenue, vcBoat } = f;
  const vcVenueFixed = vcVenue !== "all";
  const vcBoatFixed = vcBoat !== "all";
  const vcGradeValue = f.vcGrade === "all" ? null : f.vcGrade;
  const vcStageValue = f.vcStage === "all" ? null : f.vcStage;
  // クロス集計（成績ブロック用。会場・枠番のどちらか一方だけ固定の場合のみ
  // 使う。両方固定/両方未固定はnull——それぞれ既存の単一カード/一覧表示を使う）
  const vcCrossData = useMemo(() => {
    if (!vcHistory || vcVenueFixed === vcBoatFixed) return null;
    if (vcVenueFixed) {
      return aggregateRacerCrossStats(
        vcHistory,
        { venueCode: Number(vcVenue) },
        "boat",
        vcGradeValue,
        vcStageValue,
      );
    }
    return aggregateRacerCrossStats(
      vcHistory,
      { boatNumber: Number(vcBoat) },
      "venue",
      vcGradeValue,
      vcStageValue,
    );
  }, [
    vcHistory,
    vcVenueFixed,
    vcBoatFixed,
    vcVenue,
    vcBoat,
    vcGradeValue,
    vcStageValue,
  ]);
  // 枠番別成績（全会場計）。出走履歴が届いたら、会場別・条件別・レース一覧と同じ履歴から数える（BOA-1190）。
  // 日次の集計（course_race_counts）は race_results の course_1〜6 が空のレース（結果はあるのに
  // 進入の列が無い、本番で約4%）を数えず、同じ画面の「全体」の走数と合わなかった（/racer/3941 で 218走と 232走）。
  // 履歴の読み込み中・失敗・空のときは、これまでどおり日次の集計を出す
  const historyCourseStats = useMemo(
    () =>
      vcHistory?.length
        ? aggregateRacerCrossStats(vcHistory, {}, "boat", null, null).map(
            (row) => ({
              course: row.key,
              total: row.n,
              wins: row.win,
              winRate: row.winRate,
              top2Rate: row.top2Rate,
              top3Rate: row.top3Rate,
            }),
          )
        : null,
    [vcHistory],
  );
  return { vcCrossData, historyCourseStats };
}

/**
 * 絞り込み・出走履歴・クロス集計をまとめて返す。
 * 履歴の取得は racerId が確定したら1回（再試行のトークンで取り直す）。絞り込みの切り替えは I/O を起こさない
 */
export function useRacerVcState(racerId, onHistoryStateChange) {
  const f = useVcFilterState();
  const history = useVcHistory(racerId, f.vcRetryToken, onHistoryStateChange);
  useVcResets(racerId, f);
  // 枠の中（会場別・枠番別・決まり手・推移・レース一覧）は進入コースで絞った履歴から数える。
  // 枠の外（レース条件別）は絞り込みに連動しないので、絞る前の履歴（vcHistoryAll）を使う
  const vcHistory = useMemo(
    () => filterByEntryCourse(history.vcHistory, f.vcCourse),
    [history.vcHistory, f.vcCourse],
  );
  // 選択肢に出す走数は、ほかの絞り込みに合う走のうち進入が分かった走だけ
  const vcCourseCounts = useMemo(
    () =>
      entryCourseCounts(history.vcHistory, {
        venue: f.vcVenue,
        boat: f.vcBoat,
        grade: f.vcGrade,
        stage: f.vcStage,
      }),
    [history.vcHistory, f.vcVenue, f.vcBoat, f.vcGrade, f.vcStage],
  );
  const cross = useVcCross(vcHistory, f);
  const vcActive =
    f.vcVenue !== "all" ||
    f.vcBoat !== "all" ||
    f.vcGrade !== "all" ||
    f.vcStage !== "all" ||
    f.vcCourse !== "all";
  return {
    ...f,
    ...history,
    vcHistory,
    vcHistoryAll: history.vcHistory,
    vcCourseCounts,
    ...cross,
    vcActive,
    vcVenueFixed: f.vcVenue !== "all",
    vcBoatFixed: f.vcBoat !== "all",
  };
}
