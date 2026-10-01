import { useEffect, useState } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

/**
 * 出走表の今期F・L数（艇番 → {f_count, l_count, ...}）の Map。Fバッジを出す
 * ST考察カード（枠別情報タブ）とデータ出走表（BOA-638）が同じ取得を使うためのフック。
 * 基本情報タブが同じキーを先に取るため、実質キャッシュヒットで追加クエリは増えない（T5-3）。
 *
 * 取得中・取得失敗は null。バッジは補助表示なので、取れなければ出さない
 * （カードや表ごと消さない）。失敗はログに残す
 */
export function useRaceEntryFlyingRows(raceId) {
  const [result, setResult] = useState({ raceId: null, rows: null });

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceEntryOfficialRatesBreakdown(raceId)
      .then((rows) => {
        if (cancelled) return;
        setResult({
          raceId,
          rows: new Map((rows ?? []).map((r) => [r.boat_number, r])),
        });
      })
      .catch((err) => {
        console.error("F数取得エラー:", err?.message ?? String(err));
        if (!cancelled) setResult({ raceId, rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // 前のレースの結果を別のレースに持ち越さない
  return result.raceId === raceId ? result.rows : null;
}
