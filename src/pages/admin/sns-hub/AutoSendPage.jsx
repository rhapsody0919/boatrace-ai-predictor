// 自動送信ページ（/admin/sns-hub/auto）。検査が通れば承認なしで送る投稿（/today の X・全貌動画）の状況を見る
import { useState } from "react";
import SnsHubLayout from "./SnsHubLayout.jsx";
import DeadlineQueuePanel from "./DeadlineQueuePanel.jsx";

export default function AutoSendPage() {
  // 読み込むまでは null（ナビは数字を出さず、待ち行列を二重に取りに行かない）
  const [attentionCount, setAttentionCount] = useState(null);
  return (
    <SnsHubLayout counts={{ auto: attentionCount }}>
      <DeadlineQueuePanel onAttentionCount={setAttentionCount} />
    </SnsHubLayout>
  );
}
