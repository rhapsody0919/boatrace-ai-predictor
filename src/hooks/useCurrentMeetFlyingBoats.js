import { useEffect, useState } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

/**
 * 今節（前日まで）にFを切った艇番の Set（BOA-440）。基本情報タブと
 * ST考察カード（枠別情報タブ）の Fバッジが同じ判定を使うためのフック。
 *
 * 取得失敗時は空の Set にする。印は「今節のF」を**言い切るときだけ**付ける
 * 補助表示で、付かないことは「今節ではない」を意味しない（F本数のバッジは
 * 別の取得で出る）。失敗をカードごとのエラーにするほどの情報ではないため、
 * 既存のF数取得（RaceWakuInfoTab）と同じくログだけ残す
 */
export function useCurrentMeetFlyingBoats(raceId) {
  const [result, setResult] = useState({ raceId: null, boats: new Set() });

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getCurrentMeetFlyingBoats(raceId)
      .then((boats) => {
        if (!cancelled) setResult({ raceId, boats: new Set(boats ?? []) });
      })
      .catch((err) => {
        console.error("今節F取得エラー:", err?.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // 前のレースの結果を別のレースに持ち越さない
  return result.raceId === raceId ? result.boats : EMPTY;
}

const EMPTY = new Set();
