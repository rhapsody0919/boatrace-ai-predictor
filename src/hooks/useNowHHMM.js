import { useState, useEffect } from "react";
import { getNowHHMMJST } from "../utils/dateUtils";

const REFRESH_INTERVAL_MS = 60 * 1000;

/**
 * JST現在時刻をHH:MM文字列で返す共有フック。60秒毎に再レンダーを促し、常に最新の時刻を返す。
 * enabled=falseの間はnullを返しタイマーも起動しない（過去日付ビュー等、時刻比較しない画面向け）。
 *
 * 値自体はstateとしてミラーせずレンダー時に直接算出する（enabled変化時に古い値が
 * 一瞬残る心配が無い）。タイマーは60秒毎の再レンダーをトリガーするためだけに使う。
 * @param {boolean} enabled
 * @returns {string|null}
 */
export function useNowHHMM(enabled = true) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => forceTick((t) => t + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  return enabled ? getNowHHMMJST() : null;
}
