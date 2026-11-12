// 件数を押して開く元レース一覧の状態と、その一覧の取得（ScenarioTab から移した。hooks の順は元のまま）
import { useState } from "react";
import { useAnalogyScenarioRaces } from "../../../../hooks/useAnalogyV16";

// 絞りの鍵（範囲・進入・形・1着・1号艇以外・帯）
const pickKeyOf = (data, entry, slit, first, not1, band) =>
  [
    data.scope,
    entry,
    slit,
    first,
    not1,
    band ? `${band.p}${band.a}${band.b}` : "",
  ].join("|");

// 押した物を押し直したら閉じ、別の物なら開く
const toggled = (cur, pickKey, p) =>
  cur?.key === pickKey && JSON.stringify(cur.pick) === JSON.stringify(p)
    ? null
    : { key: pickKey, pick: p };

// 2〜6号艇の1着の棒はその艇の級でそろえた範囲の件数（BOA-806）なので、一覧も同じ範囲から出す（BOA-833）。
// その艇の範囲の値が無い（棒も1号艇の範囲）ときと、その艇の一覧がまだ無い朝の版は、1号艇の範囲の一覧
const listBoatOf = (racePick, data, entry, slit) =>
  racePick?.kind === "first" &&
  racePick.boat > 1 &&
  data.boats?.[racePick.boat]?.data?.cells?.[entry]?.[slit]
    ? racePick.boat
    : 1;

export function useRacePick({
  data,
  entry,
  slit,
  first,
  not1,
  band,
  raceId,
  stage,
}) {
  // STEP4 の件数を押したときの元のレースの一覧（BOA-823、承認モック mock-scenario-race-links-v2）。押した物と、
  // 押したときの絞り（範囲・進入・形・1着・1号艇以外・帯）。絞りが変わったら閉じる（同時に開くのは1つ）
  const [picked, setPicked] = useState(null);
  const pickKey = pickKeyOf(data, entry, slit, first, not1, band);
  const racePick = picked?.key === pickKey ? picked.pick : null;
  const togglePick = (p) => setPicked((cur) => toggled(cur, pickKey, p));
  const listBoat = listBoatOf(racePick, data, entry, slit);
  const boatRes = useAnalogyScenarioRaces(
    raceId,
    data.scope,
    stage,
    listBoat > 1,
    listBoat,
  );
  const boatMissing =
    listBoat > 1 && boatRes.status === "ready" && !boatRes.data?.races;
  const baseRes = useAnalogyScenarioRaces(
    raceId,
    data.scope,
    stage,
    Boolean(racePick) && (listBoat === 1 || boatMissing),
  );
  const racesRes = listBoat > 1 && !boatMissing ? boatRes : baseRes;
  return { racePick, togglePick, setPicked, racesRes, boatMissing };
}
