/**
 * 思考アシスト（BOA-430）のデータ取得（plan「全体の構成」の3段、tasks T2-1）。
 *   1段目: 出走表（getPredictions の対象レース。気象・raceStage を含む）・オッズ・展示・F。これで図を描く（N-5）
 *   1.5段目: v16 facts。届いたら today.scope_keys の NC・NCR（優勝戦・準優勝戦の日）・NA で scenario を取る
 *   2段目: similar（会場の決まり手の期間は会場の特徴のシートを足す PR で）
 * 部分ごとに {status: "idle"|"loading"|"ready"|"error", data, retry}。失敗は部分だけ（FR-11）。
 * 取得の失敗を「データなし」に倒さない（.claude/rules/frontend-data-fetch.md）
 */
import { useMemo } from "react";
import { useDatePredictions, FETCH_FAILED_ERROR } from "./useDatePredictions";
import {
  useAnalogyFacts,
  useAnalogyResource,
  useAnalogyScenario,
  useAnalogySimilar,
} from "./useAnalogyV16";
import { supabaseDataService } from "../services/supabaseDataService";
import { latestSnapshotWith } from "../utils/oddsMath";
import { raceRound, stageFromExhibition } from "../utils/assistModel";
import { parseRaceId } from "../utils/raceId";

/**
 * @param {string} raceId
 * @param {{stage?: "pre"|"post"|null}} [options] 時点（null なら展示から決める既定。D-36 (1)）
 */
export function useThinkingAssistData(
  raceId,
  { stage: chosenStage = null } = {},
) {
  const parsed = parseRaceId(raceId);
  const enabled = Boolean(parsed);
  const { races, loading, error } = useDatePredictions(parsed?.date);
  const race = useMemo(
    () => races.find((r) => r.raceId === raceId) ?? null,
    [races, raceId],
  );
  // 出走表: 取得の失敗と「その日のデータに無い」を分ける
  const racecard = {
    status: race
      ? "ready"
      : loading
        ? "loading"
        : error === FETCH_FAILED_ERROR
          ? "error"
          : "ready",
    data: race,
  };

  const odds = useAnalogyResource(
    `assist-odds|${raceId}`,
    async () => {
      const snaps = await supabaseDataService.getRaceOddsSnapshots(raceId);
      const latest = latestSnapshotWith(snaps, "trifectaAll");
      return latest
        ? { capturedAt: latest.capturedAt, trifecta: latest.trifectaAll }
        : null;
    },
    enabled,
  );

  const exhibition = useAnalogyResource(
    `assist-exhibition|${raceId}`,
    () => supabaseDataService.getRaceExhibitionBasics(raceId),
    enabled,
  );

  const rates = useAnalogyResource(
    `assist-rates|${raceId}`,
    () => supabaseDataService.getRaceEntryOfficialRatesBreakdown(raceId),
    enabled,
  );

  // 時点: DB の展示が出走する艇の全部にそろえば展示後（v16 の展示後の段の有無では決めない。D-36 (1)）。
  // 欠場の艇は数えない（D-38）
  const absentBoats = useMemo(
    () => (exhibition.data ?? []).filter((e) => e.absent).map((e) => e.boat),
    [exhibition.data],
  );
  const boats = useMemo(
    () =>
      (race?.players ?? [])
        .map((p) => Number(p.number))
        .filter((b) => b && !absentBoats.includes(b)),
    [race, absentBoats],
  );
  const defaultStage =
    exhibition.status === "ready"
      ? stageFromExhibition(exhibition.data, boats)
      : "pre";
  const stage = defaultStage === "post" ? (chosenStage ?? "post") : "pre";
  const v16Stage = stage === "post" ? "exhibition" : "racecard";

  const facts = useAnalogyFacts(raceId, v16Stage, enabled);
  const today = facts.data?.today ?? null;
  const keys = today?.scope_keys?.["1"] ?? null;
  const round = raceRound(today, race?.raceStage ?? null);
  const nc = useAnalogyScenario(raceId, keys?.NC, v16Stage, Boolean(keys?.NC));
  const ncr = useAnalogyScenario(
    raceId,
    keys?.NCR,
    v16Stage,
    Boolean(round && keys?.NCR),
  );
  const na = useAnalogyScenario(raceId, keys?.NA, v16Stage, Boolean(keys?.NA));
  // 類似レース: 展示後で v16 の展示後の段が無い（neighbors が無い）ときは、出走表の時点の値で描く（screens「状態」）
  const similarRacecard = useAnalogySimilar(raceId, "racecard", enabled);
  const similarExhibition = useAnalogySimilar(
    raceId,
    "exhibition",
    enabled && stage === "post",
  );
  const similar =
    stage === "post" && similarExhibition.data?.similar?.neighbors
      ? { ...similarExhibition, racecardStage: false }
      : { ...similarRacecard, racecardStage: stage === "post" };

  // scenario を範囲キー → 応答の形にまとめる（assistModel.sameClassScope が読む形）
  const scenarios = useMemo(() => {
    const out = {};
    if (keys?.NC && nc.data) out[keys.NC] = nc.data;
    if (keys?.NCR && ncr.data) out[keys.NCR] = ncr.data;
    if (keys?.NA && na.data) out[keys.NA] = na.data;
    return out;
  }, [keys, nc.data, ncr.data, na.data]);

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
    scenario: { nc, ncr, na, byKey: scenarios },
    similar,
  };
}
