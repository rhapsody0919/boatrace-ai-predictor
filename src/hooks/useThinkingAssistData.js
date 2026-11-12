/**
 * 思考アシスト（BOA-430）のデータ取得（plan「全体の構成」の3段、tasks T2-1）。
 *   1段目: 出走表（getPredictions の対象レース。気象・raceStage を含む）・オッズ・展示・F。これで図を描く（N-5）
 *   1.5段目: v16 facts。届いたら today.scope_keys の NC・NCR（優勝戦・準優勝戦の日）・NA で scenario を取る
 *   2段目: similar・展示の整備（体重・チルト・部品交換・展示の進入）・オリジナル展示（展示後だけ）
 *   3段目: 深掘りの艇の走（getRacerScopedRaceStats）・6艇の勝ち決まり手・前検タイム（深掘りを開いたときだけ）
 *   会場: 水質・型（ヘッダーの潮の「傾向 ›」に使うので最初に）、決まり手の期間（会場の特徴のシートを開いたときだけ）
 * 部分ごとに {status: "idle"|"loading"|"ready"|"error", data, retry}。失敗は部分だけ（FR-11）。
 * 取得の失敗を「データなし」に倒さない（.claude/rules/frontend-data-fetch.md）
 */
import { useCallback, useMemo } from "react";
import { useDatePredictions, FETCH_FAILED_ERROR } from "./useDatePredictions";
import {
  useAnalogyFacts,
  useAnalogyResource,
  useAnalogyScenario,
  useAnalogySimilar,
} from "./useAnalogyV16";
import { getRaceMotorBreakdown } from "../services/motorQueries3.js";
import { getRaceMotorMaintenanceBreakdown } from "../services/motorQueries6.js";
import { getRaceEntryOfficialRatesBreakdown } from "../services/raceQueries.js";
import {
  getRaceExhibitionBasics,
  getRaceOddsSnapshots,
} from "../services/raceQueries2.js";
import {
  getRaceFinalOdds,
  getRaceTechniqueProfileBreakdown,
} from "../services/raceQueries3.js";
import { getRaceOriginalExhibition } from "../services/raceQueries4.js";
import { getRacerScopedRaceStats } from "../services/racerQueries2.js";
import {
  getVenueCharacteristics,
  getVenueTechniquePeriodStats,
} from "../services/venueQueries.js";
import {
  nextOddsRefreshDelay,
  oddsByBetType,
  raceRound,
  stageFromExhibition,
} from "../utils/assistModel";
import { parseRaceId } from "../utils/raceId";
import { getDeadlineDate } from "../utils/raceDeadlineStatus";

// 出走表の状態: 取得の失敗と「その日のデータに無い」を分ける（純関数）
function racecardState(race, enabled, loading, error) {
  let status = "ready";
  if (!race && enabled) {
    if (loading) status = "loading";
    else if (error === FETCH_FAILED_ERROR) status = "error";
  }
  return { status, data: race };
}

// 券種ごとのオッズの取得（スナップショットの失敗は投げ、締切時オッズだけの失敗は finalFailed の印にする）
async function fetchAssistOdds(raceId, fresh = false) {
  const [snaps, final] = await Promise.allSettled([
    getRaceOddsSnapshots(raceId, { fresh }),
    getRaceFinalOdds(raceId, { fresh }),
  ]);
  if (snaps.status === "rejected") throw snaps.reason;
  const out = oddsByBetType(
    snaps.value,
    final.status === "fulfilled" ? final.value : null,
  );
  return final.status === "rejected"
    ? {
        ...(out ?? { byType: {}, trifecta: null, capturedAt: null }),
        finalFailed: true,
      }
    : out;
}

// 出走する艇の番号（欠場を除く）
function activeBoats(race, absentBoats) {
  return (race?.players ?? [])
    .map((p) => Number(p.number))
    .filter((b) => b && !absentBoats.includes(b));
}

// 時点: 展示がそろえば展示後。展示後のときだけ選択を採る
function resolveStage(exhibition, boats, chosenStage) {
  const defaultStage =
    exhibition.status === "ready"
      ? stageFromExhibition(exhibition.data, boats)
      : "pre";
  const stage = defaultStage === "post" ? (chosenStage ?? "post") : "pre";
  return { defaultStage, stage };
}

// 類似レース: 展示後の段が無い（neighbors が無い）ときは出走表の時点の値。失敗は失敗のまま
function pickSimilar(stage, similarRacecard, similarExhibition) {
  const post = stage === "post";
  if (post && similarExhibition.status === "error")
    return { ...similarExhibition, racecardStage: false };
  if (post && similarExhibition.data?.similar?.neighbors)
    return { ...similarExhibition, racecardStage: false };
  return { ...similarRacecard, racecardStage: post };
}

// scenario を範囲キー → 応答の形にまとめる（assistModel.sameClassScope が読む形）
function buildScenarios(keys, ncData, ncrData, naData) {
  const out = {};
  if (keys?.NC && ncData) out[keys.NC] = ncData;
  if (keys?.NCR && ncrData) out[keys.NCR] = ncrData;
  if (keys?.NA && naData) out[keys.NA] = naData;
  return out;
}

// facts の today と範囲キー（scope_keys の "1"）
function factsToday(facts) {
  const today = facts.data?.today ?? null;
  return { today, keys: today?.scope_keys?.["1"] ?? null };
}

// 深掘りの艇の選手ID
function findDeepRacerId(race, deep) {
  return (
    (race?.players ?? []).find((p) => Number(p.number) === deep)?.racerId ??
    null
  );
}

// 券種ごとのオッズ（BOA-990）。DB のスナップショット（race_odds）と締切時オッズ（race_odds_final）を読むだけで、
// 公式への取得は増やさない。開いたままのページは、DB に次の窓の値・締切時オッズが入る時刻に読み直す
// （BOA-1180。読み直しはキャッシュを通さない）
function useAssistOdds(raceId, race, enabled) {
  const deadlineMs = getDeadlineDate(raceId, race?.startTime)?.getTime() ?? null;
  const oddsRefresh = useCallback(
    (data, refresh) =>
      nextOddsRefreshDelay(deadlineMs, Date.now(), data, refresh),
    [deadlineMs],
  );
  return useAnalogyResource(
    `assist-odds|${raceId}`,
    (fresh = false) => fetchAssistOdds(raceId, fresh),
    enabled,
    false,
    oddsRefresh,
  );
}

// 会場・展示・率（1段目）。getVenueCharacteristics は無いとき null を返す（失敗は投げる。D-36 (5)）
function useAssistBasics(raceId, parsed, enabled, venueOpen) {
  const venueInfo = useAnalogyResource(
    `assist-venue|${parsed?.venueCode}`,
    () => getVenueCharacteristics(parsed.venueCode),
    enabled,
  );
  const venueTech = useAnalogyResource(
    `assist-venue-tech|${parsed?.venueCode}`,
    () => getVenueTechniquePeriodStats(parsed.venueCode),
    enabled && venueOpen,
  );
  const exhibition = useAnalogyResource(
    `assist-exhibition|${raceId}`,
    () => getRaceExhibitionBasics(raceId),
    enabled,
  );
  const rates = useAnalogyResource(
    `assist-rates|${raceId}`,
    () => getRaceEntryOfficialRatesBreakdown(raceId),
    enabled,
  );
  return { venueInfo, venueTech, exhibition, rates };
}

// 時点: DB の展示が出走する艇の全部にそろえば展示後（D-36 (1)）。欠場の艇は数えない（D-38）
function useAssistStage(exhibition, race, chosenStage) {
  const absentBoats = useMemo(
    () => (exhibition.data ?? []).filter((e) => e.absent).map((e) => e.boat),
    [exhibition.data],
  );
  const boats = useMemo(
    () => activeBoats(race, absentBoats),
    [race, absentBoats],
  );
  const { defaultStage, stage } = resolveStage(exhibition, boats, chosenStage);
  return { absentBoats, defaultStage, stage };
}

// 1.5段目: v16 facts と、そのキーで取る scenario（NC・NCR・NA と会場の全レース VA。FR-2・D-21）
function useAssistFactsScenarios(raceId, race, v16Stage, enabled) {
  const facts = useAnalogyFacts(raceId, v16Stage, enabled);
  const { today, keys } = factsToday(facts);
  const round = raceRound(today, race?.raceStage ?? null);
  const nc = useAnalogyScenario(raceId, keys?.NC, v16Stage, Boolean(keys?.NC));
  const ncr = useAnalogyScenario(
    raceId,
    keys?.NCR,
    v16Stage,
    Boolean(round && keys?.NCR),
  );
  const na = useAnalogyScenario(raceId, keys?.NA, v16Stage, Boolean(keys?.NA));
  const va = useAnalogyScenario(raceId, keys?.VA, v16Stage, Boolean(keys?.VA));
  return { facts, keys, round, nc, ncr, na, va };
}

// 2段目（展示後だけ）: 体重・チルト・部品交換・展示の進入と、会場のオリジナル展示
function useAssistPost(raceId, enabled, post) {
  const maintenance = useAnalogyResource(
    `assist-maintenance|${raceId}`,
    () => getRaceMotorMaintenanceBreakdown(raceId),
    enabled && post,
  );
  const original = useAnalogyResource(
    `assist-original|${raceId}`,
    () => getRaceOriginalExhibition(raceId),
    enabled && post,
  );
  return { maintenance, original };
}

// 3段目: 深掘りを開いた艇の走（FR-5）と、6艇分の勝ち決まり手・前検タイム（初めて開いたとき1回）
function useAssistDeep(raceId, parsed, deepRacerId, enabled, deepOpened) {
  const runs = useAnalogyResource(
    `assist-runs|${deepRacerId}`,
    () => getRacerScopedRaceStats(deepRacerId),
    Boolean(deepRacerId),
  );
  const technique = useAnalogyResource(
    `assist-technique|${raceId}`,
    () => getRaceTechniqueProfileBreakdown(raceId),
    enabled && deepOpened,
  );
  const motor = useAnalogyResource(
    `assist-motor|${raceId}`,
    () => getRaceMotorBreakdown(raceId, parsed?.venueCode ?? null),
    enabled && deepOpened,
  );
  return { runs, technique, motor };
}

/**
 * @param {string} raceId
 * @param {{stage?: "pre"|"post"|null, deep?: number|null, venueOpen?: boolean}} [options] 時点（null なら展示から決める既定。D-36 (1)）・深掘りの艇・会場の特徴のシートを開いたか
 */
export function useThinkingAssistData(
  raceId,
  { stage: chosenStage = null, deep = null, venueOpen = false } = {},
) {
  const parsed = parseRaceId(raceId);
  const enabled = Boolean(parsed);
  const { races, loading, error } = useDatePredictions(parsed?.date);
  const race = useMemo(
    () => races.find((r) => r.raceId === raceId) ?? null,
    [races, raceId],
  );
  // 出走表: 取得の失敗と「その日のデータに無い」を分ける。
  // 形の正しくない raceId（13R・会場99 等）は日付が無く取得が始まらないので、読み込み中に残さず「無い」にする
  const racecard = racecardState(race, enabled, loading, error);
  const odds = useAssistOdds(raceId, race, enabled);
  const { venueInfo, venueTech, exhibition, rates } = useAssistBasics(
    raceId,
    parsed,
    enabled,
    venueOpen,
  );
  const { absentBoats, defaultStage, stage } = useAssistStage(
    exhibition,
    race,
    chosenStage,
  );
  const v16Stage = stage === "post" ? "exhibition" : "racecard";
  const { facts, keys, round, nc, ncr, na, va } = useAssistFactsScenarios(
    raceId,
    race,
    v16Stage,
    enabled,
  );
  // 類似レース: 展示後で v16 の展示後の段が無い（neighbors が無い）ときは、出走表の時点の値で描く（screens「状態」）。
  // 展示後の段の取得の失敗は「段が無い」と分けて失敗のまま返す（FR-11、Codex 依頼27 F02）
  const similarRacecard = useAnalogySimilar(raceId, "racecard", enabled);
  const similarExhibition = useAnalogySimilar(
    raceId,
    "exhibition",
    enabled && stage === "post",
  );
  const similar = pickSimilar(stage, similarRacecard, similarExhibition);
  const { maintenance, original } = useAssistPost(
    raceId,
    enabled,
    stage === "post",
  );
  const deepRacerId = findDeepRacerId(race, deep);
  const { runs, technique, motor } = useAssistDeep(
    raceId,
    parsed,
    deepRacerId,
    enabled,
    deep != null,
  );
  // scenario を範囲キー → 応答の形にまとめる（assistModel.sameClassScope が読む形）
  const scenarios = useMemo(
    () => buildScenarios(keys, nc.data, ncr.data, na.data),
    [keys, nc.data, ncr.data, na.data],
  );

  return {
    parsed,
    racecard,
    odds,
    exhibition,
    rates,
    absentBoats,
    stage,
    defaultStage,
    round,
    facts,
    scenario: { nc, ncr, na, va, byKey: scenarios },
    similar,
    maintenance,
    original,
    runs: { ...runs, racerId: deepRacerId },
    technique,
    motor,
    venueInfo,
    venueTech,
  };
}
