/**
 * モーターの推移（MotorGenerationTrend）の取得。取りの hook は入口の部品だけが呼ぶ（plan.md §13）:
 * モータ情報タブは MotorConditionChart、思考アシストはそのページが呼び、推移の部品には結果を渡す。
 * enabled が偽の間は取らない（推移を開くまで問い合わせない。今までの動きと同じ）
 */
import { useEffect, useState } from "react";
import { getMotorGenerationRuns } from "../services/motorQueries8.js";

/** 6艇の行（boat_number・motor_number）から、艇番の順の号機の並び（号機の無い行は除く） */
export const generationMotorsOf = (rows) =>
  [...(rows ?? [])]
    .filter((r) => Number.isInteger(r.motor_number))
    .sort((a, b) => a.boat_number - b.boat_number)
    .map((r) => r.motor_number);

/**
 * @param {number|null} venueCode
 * @param {number[]} motors 艇番の順の号機
 * @param {string|null} raceId
 * @param {boolean} enabled
 * @returns {{status: "idle"|"loading"|"ok"|"error", data: object|null}}
 */
export function useMotorGenerationRuns(venueCode, motors, raceId, enabled = true) {
  const key = enabled && venueCode !== null && raceId ? `${venueCode}-${motors.join("_")}-${raceId}` : null;
  // 取得の結果は、頼んだ鍵と一緒に持つ。鍵が今と違えば読み込み中（effect の中で同期に state を戻さない）
  const [got, setGot] = useState({ key: null, status: "loading", data: null });
  useEffect(() => {
    if (key === null) return undefined;
    let cancelled = false;
    getMotorGenerationRuns(venueCode, key.split("-")[1].split("_").map(Number), raceId).then(
      (data) => !cancelled && setGot({ key, status: "ok", data }),
      (err) => {
        console.error("モーターの推移の取得エラー:", err);
        if (!cancelled) setGot({ key, status: "error", data: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [venueCode, key, raceId]);
  if (key === null) return { status: "idle", data: null };
  return got.key === key ? got : { status: "loading", data: null };
}
