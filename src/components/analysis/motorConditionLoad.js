/** MotorConditionChart のstate と取得（MotorConditionChart.jsx から本文を字のまま移した） */
import { useEffect, useRef, useState } from "react";
import { getMotorGenerationStart } from "../../services/motorQueries.js";
import {
  getMotorPowerIndex,
  getMotorUsageHistory,
} from "../../services/motorQueries2.js";
import {
  getRaceMotorBreakdown,
  getVenueMotorChampionshipHistory,
  getVenueMotorStats,
} from "../../services/motorQueries3.js";
import {
  getVenueMotorRanking,
  getVenueMotorRanks,
} from "../../services/motorQueries4.js";
import {
  getMotorConditionTrend,
  getMotorRacerWakuStats,
  getMotorWakuStats,
} from "../../services/motorQueries5.js";
import { getMotorPartsHistory } from "../../services/motorQueries6.js";
import { getTodayJST } from "../../utils/dateUtils";
import { countMeetPartsChanges } from "../../utils/motorMeetParts";

// 画面の state と ref（呼ぶ順は元の MotorConditionChart の本体と同じ）
export function useMotorStates(initialMotorNumber) {
  const [breakdown, setBreakdown] = useState([]);
  const [meetParts, setMeetParts] = useState(null);
  const [partsBoat, setPartsBoat] = useState(null);

  // 新しいモーターの最初の開催か等（BOA-830）。{ generationStart, firstMeet }
  const [freshness, setFreshness] = useState(null);
  // 「※」を押した艇（自前の2連率の出どころを表の下に出す。BOA-830）
  const [explainBoat, setExplainBoat] = useState(null);
  const [drillDownMotor, setDrillDownMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);

  const [powerIndex, setPowerIndex] = useState(null);
  const [usageHistory, setUsageHistory] = useState([]);
  const [partsHistory, setPartsHistory] = useState([]);
  const [venueMotorStats, setVenueMotorStats] = useState(null);
  // generationStart: 現行モーターの使用開始日（不明ならnull）。wins: その日以降の優勝
  const [championshipHistory, setChampionshipHistory] = useState({
    generationStart: null,
    wins: [],
  });
  // BOA-301: 会場内順位(FR-1)・枠番別成績(FR-2/3)・選手×枠成績(FR-4)
  const [venueMotorRanking, setVenueMotorRanking] = useState(null);
  // FR-2〜4は現行モーターの世代で集計する。generationStart: 使用開始日（不明ならnull）
  const [motorWakuStats, setMotorWakuStats] = useState({
    generationStart: null,
    rows: [],
  });
  const [motorRacerWakuStats, setMotorRacerWakuStats] = useState({
    generationStart: null,
    rows: [],
  });
  const [selectedWakuCourse, setSelectedWakuCourse] = useState(null);
  // 過去レースで、そのレースのモーターが入れ替え前（現行世代より前）か。
  // 今の同じ番号のモーターとは別物なので、ドリルダウンの中身を出さない（BOA-329）
  const [drillPreGeneration, setDrillPreGeneration] = useState(false);
  // 選択中のレース自体が入れ替え前（過去レースで、レース日 < 使用開始日）か。
  // 一覧の時点で伝え、行を押しても推移が出ないことを先に知らせる
  const [racePreGeneration, setRacePreGeneration] = useState(false);
  // 6基の会場内順位（会場公式サイトの2連率、BOA-428）。{state: "ok"|"empty"|"error"}。
  // null は取得中（列はまだ出さない）
  const [venueRanks, setVenueRanks] = useState(null);
  // 会場の現行モーターの使用開始日（BOATCAST bc_mst）。当日のレースで画面に出す
  // （2026-09-29 ユーザー判断 B、ADR-0067 の 2026-09-28 追記の改訂）
  const [generationStart, setGenerationStart] = useState(null);
  const [periodDays, setPeriodDays] = useState(90);
  const pendingInitialMotorNumber = useRef(initialMotorNumber);
  // レース/会場が変わった時だけドリルダウンをリセットする（期間トグルだけの
  // 変更でドリルダウン中の画面が一覧に戻されてしまわないようにするため）
  const lastRaceVenueRef = useRef(null);
  return {
    breakdown, setBreakdown, meetParts, setMeetParts, partsBoat, setPartsBoat,
    freshness, setFreshness, explainBoat, setExplainBoat,
    drillDownMotor, setDrillDownMotor, trendData, setTrendData,
    powerIndex, setPowerIndex, usageHistory, setUsageHistory,
    partsHistory, setPartsHistory, venueMotorStats, setVenueMotorStats,
    championshipHistory, setChampionshipHistory,
    venueMotorRanking, setVenueMotorRanking, motorWakuStats, setMotorWakuStats,
    motorRacerWakuStats, setMotorRacerWakuStats,
    selectedWakuCourse, setSelectedWakuCourse,
    drillPreGeneration, setDrillPreGeneration,
    racePreGeneration, setRacePreGeneration, venueRanks, setVenueRanks,
    generationStart, setGenerationStart, periodDays, setPeriodDays,
    pendingInitialMotorNumber, lastRaceVenueRef,
  };
}

// 節の使用履歴にこの選手がいれば、その節の部品交換数を数える（embedded の札）
async function loadRowMeetParts(selectedVenue, selectedRace, raceDate, row) {
  try {
    const history = await getMotorUsageHistory(
      selectedVenue, row.motor_number, selectedRace, { includeTarget: true },
    );
    const meet = history.find((item) => String(item.racerId) === String(row.racer_id));
    if (!meet) return { boat: row.boat_number, unavailable: true };
    const parts = await getMotorPartsHistory(
      selectedVenue, row.motor_number, 90, selectedRace, { includeTarget: true },
    );
    return { boat: row.boat_number, ...countMeetPartsChanges(parts.events, {
      from: meet.firstDate, to: raceDate,
    }) };
  } catch (err) {
    console.error("Failed to load meet motor parts:", err);
    return { boat: row.boat_number, failed: true };
  }
}

// 表は待たせず、失敗した基だけ札を隠す。履歴は直近90日と同じ窓。
function startMeetPartsLoad(m, run, data, raceDate) {
  const { selectedVenue, selectedRace, setMeetParts } = m;
  Promise.all(data.map((row) => loadRowMeetParts(selectedVenue, selectedRace, raceDate, row)))
    .then((rows) => {
      if (!run.cancelled) setMeetParts({ raceId: selectedRace, rows });
    });
}

// 会場内順位は一覧表のあとから足す（表の表示を待たせない）。当日のレースは最新の
// スナップショット、過去のレースはレース日以前で最新（BOA-521 と同じ）
function startVenueRanksLoad(m, run, raceDate) {
  m.setVenueRanks(null);
  getVenueMotorRanks(
    m.selectedVenue,
    raceDate !== null && raceDate < getTodayJST() ? raceDate : null,
  )
    .then((ranks) => {
      if (!run.cancelled) m.setVenueRanks(ranks);
    });
}

// 一覧表の取得結果を state に入れる
function applyBreakdown(m, data, dataFreshness, raceDate, venueGenerationStart) {
  const preGeneration =
    raceDate !== null &&
    raceDate < getTodayJST() &&
    venueGenerationStart !== null &&
    raceDate < venueGenerationStart;
  m.setGenerationStart(venueGenerationStart);
  m.setRacePreGeneration(preGeneration);
  m.setBreakdown(data);
  m.setFreshness(dataFreshness ?? null);
  m.setExplainBoat(null);
}

// 機力バッジ等からのディープリンク（?motor=）で指定されたモーターが
// 今回のレースに実在すれば、そのままドリルダウン画面を開く。
// マッチしなかった場合もpendingは消費する（消費せず残すと、後で
// ユーザーが手動で選んだ別レースがたまたま同じモーター番号を含んでいた際に
// 意図せず自動ドリルダウンしてしまうため）
function consumePendingMotor(m, data, pendingSnapshot) {
  const pendingExists =
    pendingSnapshot !== null &&
    data.some((r) => r.motor_number === pendingSnapshot);
  if (pendingExists) {
    m.setDrillDownMotor(pendingSnapshot);
  }
  m.pendingInitialMotorNumber.current = null;
}

async function loadBreakdown(m, run, pendingSnapshot, isNewRaceOrVenue) {
  const { selectedRace, selectedVenue, periodDays, embedded, t } = m;
  try {
    m.setLoading(true);
    m.setError(null);
    m.setMeetParts(null);
    m.setPartsBoat(null);
    if (isNewRaceOrVenue) m.setDrillDownMotor(null);
    // { rows, fetchFailed? }。会場公式のモーター成績が取れなかった行は venue_stats_failed（BOA-740）
    const { rows: data, freshness: dataFreshness } =
      await getRaceMotorBreakdown(
      selectedRace,
      selectedVenue,
      periodDays,
    );
    if (run.cancelled) return;
    const raceDate = selectedRace?.slice(0, 10) ?? null;
    // 使用開始日は、表示（1行・注記の日付）と入れ替え前の判定にだけ使う。取得が
    // 一時的に失敗しても一覧表そのものは出す（日付の行を出さず、入れ替え前とも
    // 判定しない）。以前は過去レースでしか呼んでいなかったので、当日のレースでは
    // この取得の失敗が一覧表のエラーにつながらなかった
    let venueGenerationStart = null;
    try {
      venueGenerationStart =
        await getMotorGenerationStart(selectedVenue);
    } catch (err) {
      console.error("モーター使用開始日取得エラー:", err.message);
    }
    if (run.cancelled) return;
    applyBreakdown(m, data, dataFreshness, raceDate, venueGenerationStart);
    if (embedded) startMeetPartsLoad(m, run, data, raceDate);
    startVenueRanksLoad(m, run, raceDate);
    consumePendingMotor(m, data, pendingSnapshot);
    run.applied = true;
  } catch (err) {
    if (run.cancelled) return;
    m.setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load race motor breakdown:", err);
  } finally {
    if (!run.cancelled) m.setLoading(false);
  }
}

// レース選択時: 枠番別モーター調子を取得（機力指数はvenue確定後に別途取得）
export function useBreakdownLoad(m) {
  const { selectedRace, selectedVenue, periodDays } = m;
  useEffect(() => {
    if (selectedRace === null) return;
    const raceVenueKey = `${selectedRace}-${selectedVenue}`;
    const isNewRaceOrVenue = m.lastRaceVenueRef.current !== raceVenueKey;
    m.lastRaceVenueRef.current = raceVenueKey;
    // StrictMode（開発時）の2回実行対策: 使い捨ての1回目でpendingを消費しきって
    // しまわないよう、cleanup側で未適用（cancelled）なら元に戻す
    const pendingSnapshot = m.pendingInitialMotorNumber.current;
    const run = { cancelled: false, applied: false };
    loadBreakdown(m, run, pendingSnapshot, isNewRaceOrVenue);
    return () => {
      run.cancelled = true;
      if (!run.applied) m.pendingInitialMotorNumber.current = pendingSnapshot;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace, selectedVenue, periodDays]);
}

// ドリルダウンの9つの取得を同時に始める（Promise の配列を返す）
function startDrillFetches(m, beforeRaceId, isPast, raceDate) {
  const { selectedVenue, drillDownMotor, periodDays } = m;
  return [
    getMotorConditionTrend(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    getMotorPowerIndex(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    getMotorUsageHistory(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    getMotorPartsHistory(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    // 公式サイトのスナップショット（鮮度・優出等）は、過去レースならレース日以前の最新
    getVenueMotorStats(
      selectedVenue,
      drillDownMotor,
      isPast ? raceDate : null,
    ),
    getVenueMotorChampionshipHistory(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    // BOA-301 FR-1〜4: 会場内順位（公式の最新スナップショット）・
    // 枠番別成績・選手×枠成績（現行モーターの世代）は、periodDays
    // （既存の2連率/3連率推移トグル）とは独立した集計窓のため渡さない
    getVenueMotorRanking(
      selectedVenue,
      drillDownMotor,
      undefined,
      isPast ? raceDate : null,
    ),
    getMotorWakuStats(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    getMotorRacerWakuStats(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
  ];
}

function applyDrillData(m, drill) {
  const [
    trend,
    power,
    history,
    parts,
    venueStats,
    championships,
    ranking,
    wakuStats,
    racerWakuStats,
  ] = drill;
  m.setTrendData(trend);
  m.setPowerIndex(power);
  m.setUsageHistory(history);
  m.setPartsHistory(parts.events ?? []);
  m.setVenueMotorStats(venueStats);
  m.setChampionshipHistory(championships);
  m.setVenueMotorRanking(ranking);
  m.setMotorWakuStats(wakuStats);
  m.setMotorRacerWakuStats(racerWakuStats);
}

async function loadTrend(m) {
  const { selectedVenue, selectedRace, t } = m;
  try {
    m.setLoading(true);
    m.setError(null);
    m.setDrillPreGeneration(false);
    const raceDate = selectedRace?.slice(0, 10) ?? null;
    const isPast = raceDate !== null && raceDate < getTodayJST();
    if (isPast) {
      const generationStart =
        await getMotorGenerationStart(selectedVenue);
      if (generationStart !== null && raceDate < generationStart) {
        m.setDrillPreGeneration(true);
        return;
      }
    }
    // 「このレースの直前まで」で集計する。過去レース（BOA-521）は今日から遡ると
    // レース後の走りまで入り、「このときモーターはどうだったか」を振り返れない。
    // 当日のレースも同じにする（BOA-557）。終了後に開くとそのレース自身の結果が
    // 入り、翌日（過去レース扱い）に開いたときと数字が変わっていた。発走前は
    // 直前までの結果＝今までの結果なので、見える数字は変わらない
    const beforeRaceId = selectedRace ?? null;
    const drill = await Promise.all(
      startDrillFetches(m, beforeRaceId, isPast, raceDate),
    );
    applyDrillData(m, drill);
  } catch (err) {
    m.setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load motor condition trend:", err);
  } finally {
    m.setLoading(false);
  }
}

// モーター選択時: 節ごとの推移と機力指数を取得
export function useDrillLoad(m) {
  const { selectedVenue, selectedRace, drillDownMotor, periodDays } = m;
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    loadTrend(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, selectedRace, drillDownMotor, periodDays]);
}

export function usePeriodAndWakuReset(m) {
  const { selectedRace, selectedVenue, drillDownMotor, setPeriodDays, setSelectedWakuCourse } = m;
  // 過去レースでは期間を選ばせないので、90日に戻す（当日のレースで「直近1ヶ月」を
  // 選んだまま過去レースに移ったとき、見えない切り替えの値で集計しないように）
  useEffect(() => {
    if (selectedRace && selectedRace.slice(0, 10) < getTodayJST()) {
      setPeriodDays(90);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace]);

  // モーター・会場が変わったらFR-4ドリルダウン（枠タップで開く選手一覧）を閉じる
  // （periodDaysトグルだけの変更では閉じない。90/30日切り替えはFR-2〜4の
  // 集計窓とは無関係なため）
  useEffect(() => {
    setSelectedWakuCourse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, drillDownMotor]);
}
