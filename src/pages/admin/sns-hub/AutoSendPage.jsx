// 自動送信ページ（/admin/sns-hub/auto）。検査が通れば承認なしで送る投稿（/today の X・全貌動画）の状況を見る
import SnsHubLayout from "./SnsHubLayout.jsx";
import DeadlineQueuePanel from "./DeadlineQueuePanel.jsx";

export default function AutoSendPage() {
  return (
    <SnsHubLayout>
      <DeadlineQueuePanel />
    </SnsHubLayout>
  );
}
