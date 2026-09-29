/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import RacerGradeBadge from "../racer/RacerGradeBadge";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import MotorRecordStatCards from "../MotorRecordStatCards";
import TrendLineChart from "./TrendLineChart";
import DrillDownHeader from "./DrillDownHeader";
import MotorWakuStatsGrid from "./MotorWakuStatsGrid";
import MotorRacerWakuDrillDown from "./MotorRacerWakuDrillDown";
import InlineFetchError from "../InlineFetchError";
import { getTodayJST } from "../../utils/dateUtils";
import {
  formatGenerationDate,
  isClippedByGeneration,
} from "../../utils/motorGeneration";
import "./MotorConditionChart.css";
import "../common/HorizontalScrollHint.css";

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  } = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });

  const [breakdown, setBreakdown] = useState([]);
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
  // 会場の現行モーターの使用開始日（BOATCAST bc_mst）。当日のレースで画面に出す
  // （2026-09-29 ユーザー判断 B、ADR-0067 の 2026-09-28 追記の改訂）
  const [generationStart, setGenerationStart] = useState(null);
  const [periodDays, setPeriodDays] = useState(90);
  const pendingInitialMotorNumber = useRef(initialMotorNumber);
  // レース/会場が変わった時だけドリルダウンをリセットする（期間トグルだけの
  // 変更でドリルダウン中の画面が一覧に戻されてしまわないようにするため）
  const lastRaceVenueRef = useRef(null);

  // レース選択時: 枠番別モーター調子を取得（機力指数はvenue確定後に別途取得）
  useEffect(() => {
    if (selectedRace === null) return;
    const raceVenueKey = `${selectedRace}-${selectedVenue}`;
    const isNewRaceOrVenue = lastRaceVenueRef.current !== raceVenueKey;
    lastRaceVenueRef.current = raceVenueKey;
    // StrictMode（開発時）の2回実行対策: 使い捨ての1回目でpendingを消費しきって
    // しまわないよう、cleanup側で未適用（cancelled）なら元に戻す
    const pendingSnapshot = pendingInitialMotorNumber.current;
    let cancelled = false;
    let applied = false;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        if (isNewRaceOrVenue) setDrillDownMotor(null);
        const data = await supabaseDataService.getRaceMotorBreakdown(
          selectedRace,
          selectedVenue,
          periodDays,
        );
        if (cancelled) return;
        const raceDate = selectedRace?.slice(0, 10) ?? null;
        // 使用開始日は、表示（1行・注記の日付）と入れ替え前の判定にだけ使う。取得が
        // 一時的に失敗しても一覧表そのものは出す（日付の行を出さず、入れ替え前とも
        // 判定しない）。以前は過去レースでしか呼んでいなかったので、当日のレースでは
        // この取得の失敗が一覧表のエラーにつながらなかった
        let venueGenerationStart = null;
        try {
          venueGenerationStart =
            await supabaseDataService.getMotorGenerationStart(selectedVenue);
        } catch (err) {
          console.error("モーター使用開始日取得エラー:", err.message);
        }
        if (cancelled) return;
        const preGeneration =
          raceDate !== null &&
          raceDate < getTodayJST() &&
          venueGenerationStart !== null &&
          raceDate < venueGenerationStart;
        setGenerationStart(venueGenerationStart);
        setRacePreGeneration(preGeneration);
        setBreakdown(data);
        // 機力バッジ等からのディープリンク（?motor=）で指定されたモーターが
        // 今回のレースに実在すれば、そのままドリルダウン画面を開く。
        // マッチしなかった場合もpendingは消費する（消費せず残すと、後で
        // ユーザーが手動で選んだ別レースがたまたま同じモーター番号を含んでいた際に
        // 意図せず自動ドリルダウンしてしまうため）
        const pendingExists =
          pendingSnapshot !== null &&
          data.some((r) => r.motor_number === pendingSnapshot);
        if (pendingExists) {
          setDrillDownMotor(pendingSnapshot);
        }
        pendingInitialMotorNumber.current = null;
        applied = true;
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race motor breakdown:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadBreakdown();
    return () => {
      cancelled = true;
      if (!applied) pendingInitialMotorNumber.current = pendingSnapshot;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace, selectedVenue, periodDays]);

  // モーター選択時: 節ごとの推移と機力指数を取得
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillPreGeneration(false);
        const raceDate = selectedRace?.slice(0, 10) ?? null;
        const isPast = raceDate !== null && raceDate < getTodayJST();
        if (isPast) {
          const generationStart =
            await supabaseDataService.getMotorGenerationStart(selectedVenue);
          if (generationStart !== null && raceDate < generationStart) {
            setDrillPreGeneration(true);
            return;
          }
        }
        // 過去レースは「このレースの直前まで」で集計する（BOA-521）。今日から遡ると
        // レース後の走りまで入り、「このときモーターはどうだったか」を振り返れない
        const beforeRaceId = isPast ? selectedRace : null;
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
        ] = await Promise.all([
          supabaseDataService.getMotorConditionTrend(
            selectedVenue,
            drillDownMotor,
            periodDays,
            beforeRaceId,
          ),
          supabaseDataService.getMotorPowerIndex(
            selectedVenue,
            drillDownMotor,
            periodDays,
            beforeRaceId,
          ),
          supabaseDataService.getMotorUsageHistory(
            selectedVenue,
            drillDownMotor,
            beforeRaceId,
          ),
          supabaseDataService.getMotorPartsHistory(
            selectedVenue,
            drillDownMotor,
            periodDays,
            beforeRaceId,
          ),
          // 公式サイトのスナップショット（鮮度・優出等）は、過去レースならレース日以前の最新
          supabaseDataService.getVenueMotorStats(
            selectedVenue,
            drillDownMotor,
            isPast ? raceDate : null,
          ),
          supabaseDataService.getVenueMotorChampionshipHistory(
            selectedVenue,
            drillDownMotor,
            beforeRaceId,
          ),
          // BOA-301 FR-1〜4: 会場内順位（公式の最新スナップショット）・
          // 枠番別成績・選手×枠成績（現行モーターの世代）は、periodDays
          // （既存の2連率/3連率推移トグル）とは独立した集計窓のため渡さない
          supabaseDataService.getVenueMotorRanking(
            selectedVenue,
            drillDownMotor,
            undefined,
            isPast ? raceDate : null,
          ),
          supabaseDataService.getMotorWakuStats(
            selectedVenue,
            drillDownMotor,
            beforeRaceId,
          ),
          supabaseDataService.getMotorRacerWakuStats(
            selectedVenue,
            drillDownMotor,
            beforeRaceId,
          ),
        ]);
        setTrendData(trend);
        setPowerIndex(power);
        setUsageHistory(history);
        setPartsHistory(parts.events ?? []);
        setVenueMotorStats(venueStats);
        setChampionshipHistory(championships);
        setVenueMotorRanking(ranking);
        setMotorWakuStats(wakuStats);
        setMotorRacerWakuStats(racerWakuStats);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load motor condition trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, selectedRace, drillDownMotor, periodDays]);

  // 過去レースでは期間を選ばせないので、90日に戻す（当日のレースで「直近1ヶ月」を
  // 選んだまま過去レースに移ったとき、見えない切り替えの値で集計しないように）
  useEffect(() => {
    if (selectedRace && selectedRace.slice(0, 10) < getTodayJST()) {
      setPeriodDays(90);
    }
  }, [selectedRace]);

  // モーター・会場が変わったらFR-4ドリルダウン（枠タップで開く選手一覧）を閉じる
  // （periodDaysトグルだけの変更では閉じない。90/30日切り替えはFR-2〜4の
  // 集計窓とは無関係なため）
  useEffect(() => {
    setSelectedWakuCourse(null);
  }, [selectedVenue, drillDownMotor]);

  // 入れ替え直後は、公式の累計がまだ付かず 2連率・3連率とも 0 の日が続く。この先頭の
  // 0 の点は「1回も連に絡まなかった」と読めるので描かない（BOA-513、ファン4人のパネル）
  const firstRatedIndex = (trendData?.trend ?? []).findIndex(
    (row) => row.motor_2rate !== 0 || row.motor_3rate !== 0,
  );
  const chartData = (trendData?.trend ?? [])
    .slice(firstRatedIndex === -1 ? 0 : firstRatedIndex)
    .map((row) => ({
      date: row.date.slice(5),
      motor_2rate: row.motor_2rate,
      motor_3rate: row.motor_3rate,
    }));

  const exhibitionChartData = (trendData?.trend ?? [])
    .filter((row) => row.exhibition_time !== null)
    .map((row) => ({
      date: row.date.slice(5),
      exhibition_time: row.exhibition_time,
    }));

  // 使用履歴は新しい順の一覧だが、グラフは推移グラフと同じく左が古く右が新しい
  // 向きにそろえる（逆向きだと「右肩下がり＝最近悪化」と読み違える。BOA-513）
  const usageHistoryChartData = [...usageHistory]
    .reverse()
    .filter((meet) => meet.rate2 !== null)
    .map((meet) => ({
      date: meet.playerName?.replace(/\s+/g, "") ?? "",
      rate2: meet.rate2,
      rate3: meet.rate3,
    }));

  const bestMotor2Rate =
    breakdown.length > 0
      ? Math.max(...breakdown.map((r) => r.motor_2rate ?? 0))
      : null;

  // BOA-301: embedded時のFR-2/3枠番グリッドで強調表示する「今日の艇番」。
  // 今日のレースはまだ実施前のため実進入コース(actual_course)は存在せず、
  // このレースへの割り当て艇番をそのまま暫定的な枠として使う
  const todayHighlightCourse =
    drillDownMotor !== null
      ? (breakdown.find((r) => r.motor_number === drillDownMotor)
          ?.boat_number ?? null)
      : null;

  // kyoteibiyori等の会場出走表に倣い、優出数・優勝数・1着率は艇ごとの
  // 単一バッジではなく、同じレースの全艇を横並びで比較できる列として表示する
  // （1位・2位を色分けするのも合わせて模倣。BOA-264追加調査）
  const firstPlaceRates = breakdown.map((r) =>
    r.race_count && r.first_place_count !== null
      ? (r.first_place_count / r.race_count) * 100
      : null,
  );
  const rankClassFor = (values) => {
    const distinct = [...new Set(values.filter((v) => v !== null))].sort(
      (a, b) => b - a,
    );
    // 全艇が同値（例: まだ実績が無く全て0）の場合は「1位」を強調する意味が
    // 無いため、RaceCardDataTable.jsxのrankClass()と同じくハイライトなしにする
    if (distinct.length <= 1) return () => "";
    return (value) => {
      if (value === null || value === undefined) return "";
      if (distinct[0] !== undefined && value === distinct[0])
        return "motor-stat-rank1";
      if (distinct[1] !== undefined && value === distinct[1])
        return "motor-stat-rank2";
      return "";
    };
  };
  // 全艇が null（その会場・その節で1着率が取れていない）の列は出さない。
  // 「-」だけが6行並んで横幅を50px食い、肝心の2連率・機力指数を画面外へ
  // 押し出していた（2026-09-27、ファン視点のレビュー。条件別タブで
  // n=0の行を畳んだBOA-432と同じ考え方）
  const showFirstPlaceRate = firstPlaceRates.some((v) => v !== null);
  // 優出数・優勝数も、会場の全モーターで値が無い（会場公式サイトが出していない）ときは
  // 列ごと畳む。「-」が並ぶと「0回」と読まれる（BOA-513、ファン4人のパネル）
  const showFinalCount = breakdown.some(
    (r) => r.final_count !== null && r.final_count !== undefined,
  );
  const showChampionshipCount = breakdown.some(
    (r) => r.championship_count !== null && r.championship_count !== undefined,
  );
  // 前検タイムも同じ扱い（BOA-451）。節に前検の行が無い開催では列ごと出さない
  // （ADR-0067 の 2026-09-26 追記「節に前検の行が無い場合は行ごと出さない」と同じ）
  const hasPretest = breakdown.some(
    (r) => r.pretest_time !== null && r.pretest_time !== undefined,
  );
  // 9列の表は390pxでは右が切れる。切れていることに気づけるようにする
  const rankingScroll = useHorizontalScrollHint([breakdown.length]);
  const finalCountRankClass = rankClassFor(breakdown.map((r) => r.final_count));
  const championshipCountRankClass = rankClassFor(
    breakdown.map((r) => r.championship_count),
  );
  const firstPlaceRateRankClass = rankClassFor(firstPlaceRates);
  // 過去レースの一覧表は出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）。
  // 期間の切り替えは効かないので出さず、1行の注記に置き換える
  const officialMode = breakdown.some((r) => r.rate_source === "official");
  const isPastSelectedRace =
    Boolean(selectedRace) && selectedRace.slice(0, 10) < getTodayJST();
  // 過去レースは、一覧でもドリルダウンでも期間を選ばせない（90日固定）。
  // ドリルダウンだけ選べると、押すだけで機力指数の評価が「実力以上」⇔「低調」に
  // 反転し、一覧の「期間は選べません」とも食い違う（2026-09-29 ファン評価2周目）
  const showPeriodToggle =
    drillDownMotor === null
      ? !officialMode
      : !drillPreGeneration && !isPastSelectedRace;
  // 入れ替えから1ヶ月以内は「直近1ヶ月」まで使用開始日で切り詰められ、どちらの
  // 期間を選んでも中身が同じになる。押しても変わらないボタンは出さない
  // （2026-09-29 ファン評価。使用開始日の行と切り詰めの注記は出す）
  const periodChoiceHasEffect = !isClippedByGeneration(
    generationStart,
    getTodayJST(),
    30,
  );
  // 期間を現行モーターの使用開始日で切り詰めたか（入れ替え後で期間が短い）
  const clippedByGeneration =
    drillDownMotor === null
      ? breakdown.some((r) => r.clipped_by_generation)
      : Boolean(
          powerIndex?.clipped_by_generation || trendData?.clippedByGeneration,
        );

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.motor.title")}</h2>
          <p className="section-description">
            {t("analysis.motor.description")}
          </p>
        </>
      )}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <div className="controls-section">
            <label htmlFor="motor-venue-select">
              {t("analysis.venueSelectTodayLabel")}
            </label>
            <select
              id="motor-venue-select"
              value={selectedVenue ?? ""}
              onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
              className="venue-select"
            >
              {venues.map((v) => (
                <option key={v} value={v}>
                  {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
                </option>
              ))}
            </select>

            {races.length > 0 && (
              <>
                <label htmlFor="motor-race-select">
                  {t("analysis.raceSelectLabel")}
                </label>
                <select
                  id="motor-race-select"
                  value={selectedRace ?? ""}
                  onChange={(e) => setSelectedRace(e.target.value)}
                  className="venue-select"
                >
                  {races.map((r) => (
                    <option key={r.race_id} value={r.race_id}>
                      {t("analysis.raceOption", {
                        number: r.race_number,
                        time: r.start_time?.slice(0, 5),
                      })}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        ))}

      {showPeriodToggle ? (
        <>
          {/* 現行モーターの使用開始日。いつからのモーターかが分からないと、「入れ替え後の
              ため期間を限っています」を「最近入れ替えた」と読み違える（2026-09-29 ユーザー指摘）。
              当日のレースだけに出す（過去レースは出走表時点の公式値で、取れるのは最新の
              使用開始日1つだけのため、当時の日付を出せない） */}
          {generationStart !== null && (
            <p className="motor-generation-start">
              {t("analysis.motor.generationStartLabel", {
                date: formatGenerationDate(generationStart),
              })}
              <span className="motor-generation-start-source">
                {t("analysis.motor.generationStartSource")}
              </span>
            </p>
          )}
          {periodChoiceHasEffect && (
            <div className="period-toggle" role="group">
              <button
                type="button"
                className={`period-toggle-btn ${periodDays === 90 ? "active" : ""}`}
                onClick={() => setPeriodDays(90)}
              >
                {t("analysis.motor.period90")}
              </button>
              <button
                type="button"
                className={`period-toggle-btn ${periodDays === 30 ? "active" : ""}`}
                onClick={() => setPeriodDays(30)}
              >
                {t("analysis.motor.period30")}
              </button>
            </div>
          )}
          {clippedByGeneration && (
            <p className="table-note">
              {t("analysis.motor.periodClippedNote", {
                date: formatGenerationDate(generationStart, { short: true }),
              })}
            </p>
          )}
        </>
      ) : (
        officialMode &&
        drillDownMotor === null && (
          <p className="table-note">
            {t("analysis.motor.periodOfficialNote")}
            {racePreGeneration &&
              ` ${t("analysis.motor.racePreGenerationNote")}`}
          </p>
        )
      )}

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading &&
        !error &&
        drillDownMotor === null &&
        breakdown.length > 0 && (
          <>
            <div
              className={`table-wrapper hscroll-hint${rankingScroll.hasMore ? " has-more" : ""}`}
            >
              {rankingScroll.hasMore && (
                <button
                  type="button"
                  className="hscroll-more"
                  onClick={rankingScroll.scrollRight}
                  /* 装飾兼ショートカット。表自体は指でスワイプできるので
                   支援技術には出さない */
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  ›
                </button>
              )}
              <div
                className="table-scroll"
                ref={rankingScroll.ref}
                onScroll={rankingScroll.update}
              >
                <table className="motor-ranking-table">
                  <thead>
                    <tr>
                      <th>{t("analysis.laneHeader")}</th>
                      <th>{t("table.playerName")}</th>
                      <th>{t("analysis.motor.motorNumberHeader")}</th>
                      {/* BOA-451: 「公式2連率（節時点）」は再計算した2連率の**すぐ右**に
                      置く。この2つを見比べられることが追加の目的なので隣り合わせる。
                      前検は「起点」なので3連率の右（機力指数の手前）。
                      **2連率より左に列を足さない**のが肝心で、390pxでは左から3列で
                      画面が埋まるため、手前に足すと肝心の2連率・機力指数が画面外へ
                      押し出される（1着率の列を条件表示にしたのと同じ理由、2026-09-27） */}
                      <th>{t("analysis.motor.rate2Header")}</th>
                      {/* 過去レースは2連率の列そのものが公式値なので、同じ値の列を畳む */}
                      {!officialMode && (
                        <th>{t("analysis.motor.officialRate2Header")}</th>
                      )}
                      <th>{t("analysis.motor.rate3Header")}</th>
                      {hasPretest && (
                        <th>{t("analysis.motor.pretestTimeHeader")}</th>
                      )}
                      {showFirstPlaceRate && (
                        <th>{t("analysis.motor.firstPlaceRateHeader")}</th>
                      )}
                      <th>{t("analysis.motor.powerIndexHeader")}</th>
                      {showFinalCount && (
                        <th>{t("analysis.motor.finalCountHeader")}</th>
                      )}
                      {showChampionshipCount && (
                        <th>{t("analysis.motor.championshipCountHeader")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((row, i) => (
                      <tr
                        key={row.boat_number}
                        className={`motor-ranking-row ${row.motor_2rate === bestMotor2Rate ? "best-motor" : ""}`}
                        onClick={() => setDrillDownMotor(row.motor_number)}
                      >
                        <td className="rank">{row.boat_number}</td>
                        <td translate="no">
                          {row.player_name?.replace(/\s+/g, "")}
                        </td>
                        <td className="motor-num">
                          {t("analysis.motor.motorUnit", {
                            n: row.motor_number,
                          })}
                        </td>
                        {/* 連対率は**小数1桁**で出す（BOA-474、2026-09-28）。
                          `official_2rate`（`race_entries.motor_2rate`）は、同じ節・同じ
                          モーターでもレースによって桁数が違う。出走表の行は二段階で埋まり、
                          前夜の初期投入（番組表＝Bファイル由来）は**1桁**、発走60分前ごろの
                          出走表更新が**2桁**に上書きするため、当日のまだ更新が走っていない
                          レースだけが1桁のまま残る（実測: 2026-09-28 戸田の12R=54.8 /
                          6R=54.84、同じ21号機・同じ節・同じ瞬間）。2桁で出すと同じモーターが
                          レースによって 54.80 と 54.84 に見える。1桁に揃えると
                          **9月の節内不一致748件のうち691件（92.4%）が消える**
                          （残りは連続開催の節境界で、桁の問題ではない）。
                          基本情報タブのデータ出走表も同じ値を `toFixed(1)` で出しており、
                          ボートレース日和も1桁。再計算した2連率/3連率も、母数が数十走で
                          2桁目に意味が無いため揃える */}
                        <td className="rate">
                          {row.motor_2rate?.toFixed(1)}
                          {/* このレースより前に結果の出た走が無い新モーター（当日の
                              レースのみ判定できる）。公式の 0.0 は消さずに添える
                              （BOA-513、ファン4人のパネル） */}
                          {row.sample_count === 0 && (
                            <span className="motor-waku-n motor-first-use">
                              {t("analysis.motor.firstUseBadge")}
                            </span>
                          )}
                        </td>
                        {!officialMode && (
                          <td className="rate">
                            {row.official_2rate !== null &&
                            row.official_2rate !== undefined
                              ? Number(row.official_2rate).toFixed(1)
                              : "-"}
                          </td>
                        )}
                        <td className="rate">{row.motor_3rate?.toFixed(1)}</td>
                        {hasPretest && (
                          <td className="rate motor-pretest-cell">
                            {row.pretest_time !== null &&
                            row.pretest_time !== undefined ? (
                              <>
                                {Number(row.pretest_time).toFixed(2)}
                                {row.pretest_rank ? (
                                  <span className="motor-waku-n">
                                    {t("analysis.motor.pretestRank", {
                                      rank: row.pretest_rank,
                                    })}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                        )}
                        {showFirstPlaceRate && (
                          <td
                            className={`rate ${firstPlaceRateRankClass(firstPlaceRates[i])}`}
                          >
                            {firstPlaceRates[i] !== null
                              ? `${firstPlaceRates[i].toFixed(1)}%`
                              : "-"}
                          </td>
                        )}
                        <td
                          className={`rate power-index ${
                            row.power_index > 0
                              ? "power-index-good"
                              : row.power_index < 0
                                ? "power-index-bad"
                                : ""
                          }`}
                        >
                          {row.power_index !== null &&
                          row.power_index !== undefined
                            ? `${row.power_index > 0 ? "+" : ""}${row.power_index.toFixed(1)}`
                            : "-"}
                        </td>
                        {showFinalCount && (
                          <td
                            className={`rate ${finalCountRankClass(row.final_count)}`}
                          >
                            {row.final_count ?? "-"}
                          </td>
                        )}
                        {showChampionshipCount && (
                          <td
                            className={`rate ${championshipCountRankClass(row.championship_count)}`}
                          >
                            {row.championship_count ?? "-"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* BOA-451 / ADR-0067: 生値をそのまま出す列（前検タイム・公式2連率）
              の出典を表のすぐ下に1回だけ置く。集計・加工した列（期間別の
              2連率/3連率・機力指数）は当社の計算なので出典の対象外。
              横スクロールの枠（右端のフェード）の外に置く。枠の中だと375pxで
              各行の末尾がフェードに隠れて読めない（2026-09-29 ファン評価） */}
            <p className="table-note motor-official-source-note">
              {officialMode
                ? t("analysis.motor.officialModeSourceNote", {
                    // 表に出ている会場公式サイト由来の列だけを挙げる（1着率の列が無い
                    // 会場で「1着率」に触れない。BOA-513）
                    venueCols: [
                      showFirstPlaceRate &&
                        "analysis.motor.firstPlaceRateHeader",
                      showFinalCount && "analysis.motor.finalCountHeader",
                      showChampionshipCount &&
                        "analysis.motor.championshipCountHeader",
                    ]
                      .filter(Boolean)
                      .map((key) =>
                        t("analysis.motor.quotedLabel", { label: t(key) }),
                      )
                      .join(t("analysis.motor.quotedLabelSeparator")),
                  })
                : t("analysis.motor.officialSourceNote")}
            </p>
          </>
        )}

      {!loading && !error && drillDownMotor !== null && drillPreGeneration && (
        <>
          <DrillDownHeader
            onBack={() => setDrillDownMotor(null)}
            backLabel={t("analysis.backToList")}
            heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
          />
          <div className="empty-state">
            {t("analysis.motor.drillPreGeneration", { n: drillDownMotor })}
          </div>
        </>
      )}

      {!loading && !error && drillDownMotor !== null && !drillPreGeneration && (
        <>
          <DrillDownHeader
            onBack={() => setDrillDownMotor(null)}
            backLabel={t("analysis.backToList")}
            heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
          />
          {/* 過去レースのドリルダウンは「このレースの直前まで」で集計する（BOA-521）。
              期間の切り替えは出さないので、どこまでの集計かをここで示す */}
          {isPastSelectedRace && (
            <p className="table-note">
              {t("analysis.motor.drillAsOfRaceNote")}
            </p>
          )}

          {powerIndex?.power_index !== null &&
            powerIndex?.power_index !== undefined && (
              <p
                className={`power-index-summary ${
                  powerIndex.power_index > 0
                    ? "power-index-good"
                    : powerIndex.power_index < 0
                      ? "power-index-bad"
                      : ""
                }`}
              >
                {t("analysis.motor.powerIndexSummary", {
                  index: `${powerIndex.power_index > 0 ? "+" : ""}${powerIndex.power_index.toFixed(1)}`,
                  count: powerIndex.sample_count,
                  // 入れ替え後で期間を切り詰めたときは「過去90日」と書かない
                  // （37走が本当に90日分に見えてしまう）
                  period: powerIndex.clipped_by_generation
                    ? t("analysis.motor.periodSinceGeneration", {
                        date: formatGenerationDate(generationStart, {
                          short: true,
                        }),
                      })
                    : t(`analysis.motor.period${periodDays}`),
                })}
                {" — "}
                {powerIndex.power_index > 0
                  ? t("analysis.motor.powerIndexGood")
                  : powerIndex.power_index < 0
                    ? t("analysis.motor.powerIndexBad")
                    : ""}
              </p>
            )}

          <MotorStatBadgeRow
            icon="🔧"
            label={t("analysis.motor.freshnessLabel")}
            badges={[
              venueMotorStats?.raceCount !== null &&
                venueMotorStats?.raceCount !== undefined && {
                  key: "raceCount",
                  text: t("analysis.motor.freshnessRaceBadge", {
                    raceCount: venueMotorStats.raceCount,
                  }),
                },
              venueMotorStats?.meetCount !== null &&
                venueMotorStats?.meetCount !== undefined && {
                  key: "meetCount",
                  text: t("analysis.motor.freshnessMeetBadge", {
                    meetCount: venueMotorStats.meetCount,
                  }),
                },
            ].filter(Boolean)}
          />

          {/* BOA-301 FR-1: 会場内ランキング（venue_motor_stats最新スナップショット、
              自社race_resultsからの再計算はしない） */}
          <MotorStatBadgeRow
            icon="🏆"
            label={t("analysis.motor.venueRankLabel")}
            badges={[
              venueMotorRanking && {
                key: "venueRank",
                text: t("analysis.motor.venueRankBadge", {
                  rank: venueMotorRanking.rank,
                  total: venueMotorRanking.total,
                }),
              },
            ].filter(Boolean)}
          />

          <MotorRecordStatCards
            cards={[
              venueMotorStats?.finalCount !== null &&
                venueMotorStats?.finalCount !== undefined && {
                  key: "finalCount",
                  value: venueMotorStats.finalCount,
                  label: t("analysis.motor.finalCountHeader"),
                },
              venueMotorStats?.championshipCount !== null &&
                venueMotorStats?.championshipCount !== undefined && {
                  key: "championshipCount",
                  value: venueMotorStats.championshipCount,
                  label: t("analysis.motor.championshipCountHeader"),
                },
              venueMotorStats?.firstPlaceCount !== null &&
                venueMotorStats?.firstPlaceCount !== undefined &&
                venueMotorStats?.raceCount && {
                  key: "firstPlaceRate",
                  value: `${(
                    (venueMotorStats.firstPlaceCount /
                      venueMotorStats.raceCount) *
                    100
                  ).toFixed(1)}%`,
                  label: t("analysis.motor.firstPlaceRateHeader"),
                },
            ].filter(Boolean)}
          />
          {/* 鮮度・会場内順位・1着率・優出・優勝は会場公式サイトのスナップショットで、
              節の終わりにしか更新されない。下の機力指数・使用履歴（当サイトの集計）と
              走数が合わないことを先に断る（BOA-513、2026-09-28 ファン評価） */}
          {(venueMotorStats || venueMotorRanking) && (
            <p className="table-note">
              {t("analysis.motor.officialSnapshotNote")}
            </p>
          )}

          {/* BOA-301 FR-2/3/4: 枠番別成績・展示タイム推移・選手×枠成績 */}
          {selectedWakuCourse !== null ? (
            <MotorRacerWakuDrillDown
              course={selectedWakuCourse}
              rows={motorRacerWakuStats.rows.filter(
                (r) => r.course === selectedWakuCourse,
              )}
              onBack={() => setSelectedWakuCourse(null)}
            />
          ) : (
            <MotorWakuStatsGrid
              rows={motorWakuStats.rows}
              generationStart={motorWakuStats.generationStart}
              fetchFailed={motorWakuStats.fetchFailed}
              embedded={embedded}
              highlightCourse={todayHighlightCourse}
              onSelectCourse={setSelectedWakuCourse}
            />
          )}

          <h3 className="selected-motor-heading">
            {t("analysis.motor.championshipHistoryHeading")}
          </h3>
          {championshipHistory.wins.length > 0 ? (
            <ul className="history-list">
              {championshipHistory.wins.map((win) => (
                <li key={win.raceId}>
                  <span className="history-date">{win.date}</span>
                  <span translate="no" className="usage-history-player">
                    {win.playerName?.replace(/\s+/g, "")}
                  </span>
                </li>
              ))}
            </ul>
          ) : championshipHistory.fetchFailed ? (
            <InlineFetchError />
          ) : (
            <div className="empty-state">
              {championshipHistory.generationStart === null
                ? t("analysis.motor.championshipHistoryUnknownGeneration")
                : t("analysis.motor.championshipHistoryEmpty")}
            </div>
          )}
          <p className="table-note">
            {t("analysis.motor.championshipHistoryNote")}
          </p>

          <h3 className="selected-motor-heading">
            {t("analysis.motor.rateTrendHeading")}
          </h3>
          {chartData.length > 0 ? (
            <TrendLineChart
              data={chartData}
              yAxisLabel={t("analysis.motor.yAxis")}
              tooltipFormatter={(value) => `${value.toFixed(1)}%`}
              series={[
                {
                  dataKey: "motor_2rate",
                  name: t("analysis.motor.legend2"),
                  stroke: "var(--brand-accent-primary)",
                  type: "stepAfter",
                },
                {
                  dataKey: "motor_3rate",
                  name: t("analysis.motor.legend3"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "stepAfter",
                },
              ]}
            />
          ) : (
            <div className="empty-state">{t("analysis.motor.trendEmpty")}</div>
          )}

          <h3 className="selected-motor-heading">
            {t("analysis.motor.exhibitionTrendHeading")}
          </h3>
          {exhibitionChartData.length > 0 ? (
            <TrendLineChart
              data={exhibitionChartData}
              yAxisLabel={t("analysis.motor.exhibitionYAxis")}
              yAxisDomain={["dataMin - 0.1", "dataMax + 0.1"]}
              tooltipFormatter={(value) => value.toFixed(2)}
              series={[
                {
                  dataKey: "exhibition_time",
                  name: t("analysis.motor.exhibitionLegend"),
                  stroke: "var(--brand-accent-primary)",
                  type: "monotone",
                },
              ]}
            />
          ) : (
            <div className="empty-state">
              {t("analysis.motor.exhibitionTrendEmpty")}
            </div>
          )}
          <p className="table-note">
            {t("analysis.motor.exhibitionTrendNote")}
          </p>

          <h3 className="selected-motor-heading">
            {t("analysis.motor.usageHistoryHeading")}
          </h3>
          {usageHistoryChartData.length > 1 && (
            <TrendLineChart
              data={usageHistoryChartData}
              yAxisLabel={t("analysis.motor.yAxis")}
              tooltipFormatter={(value) => `${value.toFixed(1)}%`}
              series={[
                {
                  dataKey: "rate2",
                  name: t("analysis.motor.legend2"),
                  stroke: "var(--brand-accent-primary)",
                  type: "monotone",
                },
                {
                  dataKey: "rate3",
                  name: t("analysis.motor.legend3"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "monotone",
                },
              ]}
            />
          )}
          {usageHistory.length > 0 ? (
            <ul className="history-list">
              {usageHistory.map((meet, i) => (
                <li key={`${meet.racerId}-${meet.firstDate}-${i}`}>
                  <span className="history-date">
                    {meet.firstDate}
                    {meet.firstDate !== meet.lastDate && `〜${meet.lastDate}`}
                  </span>
                  <span translate="no" className="usage-history-player">
                    {meet.playerName?.replace(/\s+/g, "")}
                  </span>
                  <RacerGradeBadge grade={meet.grade} />
                  {meet.rate2 !== null && (
                    <span className="usage-history-rate">
                      {t("analysis.motor.legend2")} {meet.rate2.toFixed(1)}%
                    </span>
                  )}
                  <span className="usage-history-ranks">
                    {meet.races
                      .map((r) =>
                        r.rank !== null
                          ? t("analysis.motor.usageHistoryRank", {
                              n: r.rank,
                            })
                          : "-",
                      )
                      .join(" ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {t("analysis.motor.usageHistoryEmpty")}
            </div>
          )}
          <p className="table-note">{t("analysis.motor.usageHistoryNote")}</p>

          <h3 className="selected-motor-heading">
            {t("analysis.motor.partsHistoryHeading")}
          </h3>
          {partsHistory.length > 0 ? (
            <ul className="history-list">
              {partsHistory.map((event, i) => (
                <li key={`${event.date}-${i}`}>
                  <span className="history-date">
                    {event.date}
                    {/* 何Rの展示で記録された交換か（そのレースの前の交換）。
                        同じ日に複数のレースがある（BOA-513、ファン4人のパネル） */}
                    {event.raceNos?.length > 0 &&
                      ` ${event.raceNos.map((n) => `${n}R`).join("・")}`}
                  </span>
                  <span className="parts-history-items">
                    {event.parts && event.parts.length > 0 && (
                      <span className="parts-history-tag">
                        {event.parts.join("・")}
                      </span>
                    )}
                    {event.propellerChanged && (
                      <span className="parts-history-tag">
                        {t("analysis.motor.propellerChanged")}
                      </span>
                    )}
                  </span>
                  {event.interpretation && (
                    <span
                      className={`parts-history-badge parts-history-badge-${event.interpretation}`}
                    >
                      {t(
                        `analysis.motor.partsInterpretation.${event.interpretation}`,
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {t("analysis.motor.partsHistoryEmpty")}
            </div>
          )}
          <p className="table-note">{t("analysis.motor.partsHistoryNote")}</p>
        </>
      )}

      {/* 「行を押すと推移」は一覧でだけ、入れ替え前のレースでは出さない
          （押しても推移が出ないため） */}
      {drillDownMotor === null &&
        (racePreGeneration ? (
          <p className="table-note">{t("analysis.motor.highlightNote")}</p>
        ) : (
          <p className="table-note">{t("analysis.motor.note")}</p>
        ))}
      {!drillPreGeneration && (
        <p className="table-note">{t("analysis.motor.powerIndexNote")}</p>
      )}
    </div>
  );
}

export default MotorConditionChart;
