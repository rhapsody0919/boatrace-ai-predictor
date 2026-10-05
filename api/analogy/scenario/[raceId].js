/**
 * Vercel Edge Function: アナロジー・ファインダー v16 の展開シナリオ（タブ3、BOA-271 T5-1）
 *
 * GET /api/analogy/scenario/{race_id}?scope={範囲キー}&stage=racecard|exhibition
 * 応答: status、範囲キーの scenario 全体（進入×形の全セル・手がかりの件数・③の表。画面が選択に応じて取り出す）、
 *   今日の手がかりの当否（today の hints）、stage=exhibition なら今日の展示の進入の型・展示 ST の形。
 * scope を省略すると、今日の1号艇の範囲キーのうち VC（会場で300件未満なら NC。spec「数えるレース」）
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

const SCOPE = /^(VC|NC|NCR|VA|VG|NA)(:[0-9A-Za-z:-]+)?$/;

export default createHandler(
  async ({ raceId, stage, url, state, snapshot }) => {
    const rc = state.racecard;
    if (!rc) return {};
    const today = await readObject(
      objectPath(raceId, rc.run_id, "today", raceId),
    );
    if (!today) return {};
    const keys = today.scope_keys["1"];
    const scope =
      url.searchParams.get("scope") || keys.VC || keys.NC || keys.VA;
    if (!SCOPE.test(scope) || !Object.values(keys).includes(scope))
      throw new RangeError(
        `scope は今日の1号艇の範囲キー（${Object.values(keys).join("|")}）`,
      );
    const scenario = await readObject(
      objectPath(raceId, rc.run_id, "scenario", scope.replaceAll(":", "_")),
    );
    const exhibition =
      stage === "exhibition" && snapshot?.status === "ok"
        ? await readObject(
            objectPath(raceId, snapshot.run_id, "today-exhibition", raceId),
          )
        : null;
    return {
      run_id: rc.run_id,
      scope,
      scope_keys: keys,
      scenario,
      hints: today.hints,
      course_st: today.course_st,
      exhibition,
    };
  },
);
