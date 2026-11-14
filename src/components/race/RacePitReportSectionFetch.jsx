import { useEffect, useState } from "react";
import { getRacePitReport } from "../../services/raceQueries4.js";

export function usePitReportFetch(raceId, isCandidate) {
  // レース間ナビゲーション（BOA-118のボトムバー等）ではこのコンポーネントが
  // アンマウントされずraceIdだけが変わるため、取得結果はraceIdとセットで持つ。
  // そうしないと、effectが走るまでの1描画で「前のレースのコメント＋今のレースの
  // 公式リンク」という食い違った表示が出る
  const [fetched, setFetched] = useState(null);
  const [failedRaceId, setFailedRaceId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isCandidate) return undefined;
    let cancelled = false;
    getRacePitReport(raceId)
      .then((data) => {
        if (cancelled) return;
        // 直前に失敗したレースへ戻ってきて今度は成功した場合に、エラー表示が残らないようにする
        setFailedRaceId((prev) => (prev === raceId ? null : prev));
        setFetched({ raceId, data });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("ピットレポート取得エラー:", error);
        setFailedRaceId(raceId);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, isCandidate, reloadKey]);

  const report = fetched?.raceId === raceId ? fetched.data : null;
  const failed = failedRaceId === raceId;
  const loading = !report && !failed;
  const retry = () => {
    setFailedRaceId(null);
    setReloadKey((n) => n + 1);
  };

  return { report, failed, loading, retry };
}
