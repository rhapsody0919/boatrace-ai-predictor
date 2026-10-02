import { useCallback, useEffect, useState } from "react";
import { getAnalogyContribution } from "../services/analogyService";

/**
 * アナロジー・ファインダーの寄与度（BOA-271 FR-1）を読む。
 * @returns {{ status: "loading"|"ready"|"unavailable"|"error", data: object|null, retry: () => void }}
 *   unavailable = 学習前（is_active の版が無い）。節ごと出さない。
 *   error = 取得の失敗（「データなし」に倒さない。.claude/rules/frontend-data-fetch.md）
 */
export default function useAnalogyContribution({ venue, grade, round, target }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    // 条件を変えた直後は前の条件の結果を残したまま読み込む（表示が一瞬消えてガタつかないように）
    setState((s) => ({ status: "loading", data: s.data }));
    getAnalogyContribution({ venue, grade, round, target })
      .then((data) => {
        if (!alive) return;
        setState(
          data.available
            ? { status: "ready", data }
            : { status: "unavailable", data: null },
        );
      })
      .catch((error) => {
        if (!alive) return;
        console.error("[analogy] 寄与度の取得に失敗:", error);
        setState({ status: "error", data: null });
      });
    return () => {
      alive = false;
    };
  }, [venue, grade, round, target, reloadKey]);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  return { ...state, retry };
}
