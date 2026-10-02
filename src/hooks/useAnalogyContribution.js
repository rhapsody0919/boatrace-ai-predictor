import { useCallback, useEffect, useState } from "react";
import { getAnalogyContribution } from "../services/analogyService";

/**
 * アナロジー・ファインダーの寄与度（BOA-271 FR-1）を読む。
 * @returns {{ status: "loading"|"ready"|"unavailable"|"error", data: object|null, retry: () => void }}
 *   unavailable = 学習前（is_active の版が無い）。節ごと出さない。
 *   error = 取得の失敗（「データなし」に倒さない。.claude/rules/frontend-data-fetch.md）。
 *   data は条件を変えた直後の読み込み中も前の条件の結果を返す（表示が一瞬消えてガタつかないように）。
 * 結果・失敗は条件のキーとセットで持ち、loading はそこから導く（RacePitReportSection と同じ形）
 */
export default function useAnalogyContribution({
  venue,
  grade,
  round,
  target,
}) {
  const key = `${venue}|${grade}|${round}|${target}`;
  const [fetched, setFetched] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    getAnalogyContribution({ venue, grade, round, target })
      .then((data) => {
        if (!alive) return;
        setFailedKey((prev) => (prev === key ? null : prev));
        setFetched({ key, data });
      })
      .catch((error) => {
        if (!alive) return;
        console.error("[analogy] 寄与度の取得に失敗:", error);
        setFailedKey(key);
      });
    return () => {
      alive = false;
    };
  }, [key, venue, grade, round, target, reloadKey]);

  // 再試行を押したら「読み込み中」に戻す（押しても見た目が変わらないと、再失敗と区別がつかない）
  const retry = useCallback(() => {
    setFailedKey(null);
    setReloadKey((k) => k + 1);
  }, []);
  if (failedKey === key) return { status: "error", data: null, retry };
  if (fetched?.key === key) {
    return fetched.data.available
      ? { status: "ready", data: fetched.data, retry }
      : { status: "unavailable", data: null, retry };
  }
  const previous = fetched?.data?.available ? fetched.data : null;
  return { status: "loading", data: previous, retry };
}
