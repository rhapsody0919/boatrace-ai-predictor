/**
 * Vercel Edge Function: アナロジー・ファインダー v16 の「来る艇の条件」（タブ1、BOA-271 T5-1）
 *
 * GET /api/analogy/facts/{race_id}?stage=racecard|exhibition
 * 応答: status（api/_lib/analogyV16.js の resolveStatus）、today（今日の6艇の値と6艇中の順位・範囲キー・前日までの走数）、
 *   facts（今日の6艇それぞれの範囲キー VC・NC・NCR・VA の集計。キーで引く）、exhibition（stage=exhibition のとき、
 *   今日の展示の値: 展示タイム・順位・風速区分）。AIの見立ては /api/analogy/contribution（stage 付き）を画面が読む
 * NCR が優勝戦のときは、その範囲から今節の平均着順点を外す（spec A-4。優勝戦の枠は準優勝戦までの成績で決まる）
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

const FACT_SCOPES = ["VC", "NC", "NCR", "VA"];

export function withoutSeriesScoreOnFinal(key, facts) {
  if (!key.startsWith("NCR:") || !key.endsWith(":yusho") || !facts)
    return facts;
  const by = Object.fromEntries(
    Object.entries(facts.by).map(([b, items]) => {
      const { series_score: _drop, ...rest } = items;
      return [b, rest];
    }),
  );
  return { ...facts, by };
}

export default createHandler(async ({ raceId, stage, state, snapshot }) => {
  const rc = state.racecard;
  if (!rc) return {};
  const today = await readObject(
    objectPath(raceId, rc.run_id, "today", raceId),
  );
  if (!today) return {};
  const keys = [
    ...new Set(
      Object.values(today.scope_keys).flatMap((k) =>
        FACT_SCOPES.map((s) => k[s]).filter(Boolean),
      ),
    ),
  ];
  const files = await Promise.all(
    keys.map((k) =>
      readObject(
        objectPath(raceId, rc.run_id, "facts", k.replaceAll(":", "_")),
      ),
    ),
  );
  const facts = Object.fromEntries(
    keys.map((k, i) => [k, withoutSeriesScoreOnFinal(k, files[i])]),
  );
  const exhibition =
    stage === "exhibition" && snapshot?.status === "ok"
      ? await readObject(
          objectPath(raceId, snapshot.run_id, "today-exhibition", raceId),
        )
      : null;
  return {
    run_id: rc.run_id,
    pool_cutoff: rc.pool_cutoff,
    today,
    facts,
    exhibition,
  };
});
