/**
 * Vercel Edge Function: アナロジー・ファインダー v16 の展開シナリオ（タブ3、BOA-271 T5-1）
 *
 * GET /api/analogy/scenario/{race_id}?scope={範囲キー}&stage=racecard|exhibition
 * 応答: status、範囲キーの scenario 全体（進入×形の全セル・手がかりの件数・③の表。画面が選択に応じて取り出す）、
 *   今日の手がかりの当否（today の hints）、stage=exhibition なら今日の展示の進入の型・展示 ST の形。
 * scope を省略すると、今日の1号艇の範囲キーのうち VC（会場で300件未満なら NC。spec「数えるレース」）。
 * reference: ③の比べる相手（spec C-4「全国・同じ組み合わせの同じ区分の率」）の範囲の③の表（attack だけ）。
 *   VC・NCR は NC、VA・VG は NA。NC・NA は無し（形の切り替えで取り直さないよう、同じ応答に入れる）
 * 300件はタブ3の母集団（返還・進入不明を除く）で数える
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

const MIN_VC_RACES = 300;
const REFERENCE = { VC: "NC", NCR: "NC", VA: "NA", VG: "NA" };

/** 既定の範囲（spec「数えるレース」）: VC。会場で300件未満なら NC。級別が欠けて VC・NC が無ければ VA */
async function defaultScope(raceId, runId, keys) {
  if (!keys.VC) return keys.NC ?? keys.VA;
  const vc = await readObject(
    objectPath(raceId, runId, "scenario", keys.VC.replaceAll(":", "_")),
  );
  return vc && vc.n >= MIN_VC_RACES ? keys.VC : (keys.NC ?? keys.VC);
}

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
      url.searchParams.get("scope") ||
      (await defaultScope(raceId, rc.run_id, keys));
    if (!SCOPE.test(scope) || !Object.values(keys).includes(scope))
      throw new RangeError(
        `scope は今日の1号艇の範囲キー（${Object.values(keys).join("|")}）`,
      );
    const refKey = keys[REFERENCE[scope.split(":")[0]]] ?? null;
    const [scenario, refFile] = await Promise.all([
      readObject(
        objectPath(raceId, rc.run_id, "scenario", scope.replaceAll(":", "_")),
      ),
      refKey
        ? readObject(
            objectPath(
              raceId,
              rc.run_id,
              "scenario",
              refKey.replaceAll(":", "_"),
            ),
          )
        : null,
    ]);
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
      reference: refFile ? { scope: refKey, attack: refFile.attack } : null,
      hints: today.hints,
      course_st: today.course_st,
      exhibition,
    };
  },
);
