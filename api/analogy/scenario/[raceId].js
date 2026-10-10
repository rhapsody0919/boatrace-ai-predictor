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
 * boats=1: 2〜6号艇の「構成＋その艇の級」の範囲の値（scenario-boat、BOA-806）を boats に入れる。範囲の種類（VC・NC・NCR）は
 *   1号艇の範囲と同じにする（VC から NC に替えたときは全艇 NC）。VA・VG・NA は級によらないので null。
 *   ファイルの無い艇（BOA-806 より前の朝のバッチの版）は null（画面は1号艇の範囲の値を出す）
 * races=1: STEP4 の件数を押したときの元のレースの一覧（scenario-races、BOA-823）だけを返す（{run_id, scope, races}）。
 *   押したときだけ読むので、ふだんの応答には入れない。BOA-823 より前の朝のバッチの版は races が null
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

const MIN_VC_RACES = 300;
const REFERENCE = { VC: "NC", NCR: "NC", VA: "NA", VG: "NA" };

/**
 * 既定の範囲（spec「数えるレース」）: VC。会場で300件未満なら NC。級別が欠けて VC・NC が無ければ VA。
 * vcN は、VC が300件未満で NC に替えたときの VC の件数（画面の「全国で数えています」の1行。それ以外は null）
 * @returns {Promise<{scope: string, vcN: number|null}>}
 */
async function defaultScope(raceId, runId, keys) {
  if (!keys.VC) return { scope: keys.NC ?? keys.VA, vcN: null };
  const vc = await readObject(
    objectPath(raceId, runId, "scenario", keys.VC.replaceAll(":", "_")),
  );
  if (vc && vc.n >= MIN_VC_RACES) return { scope: keys.VC, vcN: null };
  return keys.NC
    ? { scope: keys.NC, vcN: vc ? vc.n : null }
    : { scope: keys.VC, vcN: null };
}

const SCOPE = /^(VC|NC|NCR|VA|VG|NA)(:[0-9A-Za-z:-]+)?$/;
const BOAT_KINDS = new Set(["VC", "NC", "NCR"]);

/**
 * 2〜6号艇の scenario-boat と、③の比べる相手（VC・NCR は NC）の attack。read は範囲キー → ファイル（無ければ null）。
 * kind は1号艇の確定した範囲の種類（VC から NC に替えたときは NC）。VA・VG・NA は級によらないので null
 * （scripts/maintenance/verify-analogy-v16-api.js が固定する）
 * @param {(key: string) => Promise<object|null>} read
 * @param {Record<string, Record<string, string>>} allKeys today の scope_keys（艇番 → 範囲キー）
 * @param {string} kind
 */
export async function boatScopes(read, allKeys, kind) {
  if (!BOAT_KINDS.has(kind)) return null;
  const get = (key) => (key ? read(key) : null);
  const entries = await Promise.all(
    [2, 3, 4, 5, 6].map(async (b) => {
      const keys = allKeys?.[String(b)] ?? {};
      const refKey = keys[REFERENCE[kind]] ?? null;
      const [data, ref] = await Promise.all([get(keys[kind]), get(refKey)]);
      return [
        String(b),
        data
          ? {
              scope: keys[kind],
              data,
              reference: ref ? { scope: refKey, attack: ref.attack } : null,
            }
          : null,
      ];
    }),
  );
  return Object.fromEntries(entries);
}

export default createHandler(
  async ({ raceId, stage, url, state, snapshot }) => {
    const rc = state.racecard;
    if (!rc) return {};
    const today = await readObject(
      objectPath(raceId, rc.run_id, "today", raceId),
    );
    if (!today) return {};
    const keys = today.scope_keys["1"];
    const picked = url.searchParams.get("scope");
    const def = picked ? null : await defaultScope(raceId, rc.run_id, keys);
    const scope = picked || def.scope;
    if (!SCOPE.test(scope) || !Object.values(keys).includes(scope))
      throw new RangeError(
        `scope は今日の1号艇の範囲キー（${Object.values(keys).join("|")}）`,
      );
    if (url.searchParams.get("races") === "1")
      return {
        run_id: rc.run_id,
        scope,
        races: await readObject(
          objectPath(
            raceId,
            rc.run_id,
            "scenario-races",
            scope.replaceAll(":", "_"),
          ),
        ),
      };
    const refKey = keys[REFERENCE[scope.split(":")[0]]] ?? null;
    const wantBoats = url.searchParams.get("boats") === "1";
    const [scenario, refFile, boats] = await Promise.all([
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
      wantBoats
        ? boatScopes(
            (key) =>
              readObject(
                objectPath(
                  raceId,
                  rc.run_id,
                  "scenario-boat",
                  key.replaceAll(":", "_"),
                ),
              ),
            today.scope_keys,
            scope.split(":")[0],
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
      // 既定で VC から NC に替えたときの VC の件数（範囲を指定した要求には付けない。画面の1行は既定の表示中だけ）
      vc_fell_back: def?.vcN ?? null,
      scope_keys: keys,
      scenario,
      reference: refFile ? { scope: refKey, attack: refFile.attack } : null,
      ...(wantBoats ? { boats } : {}),
      hints: today.hints,
      course_st: today.course_st,
      exhibition,
    };
  },
);
