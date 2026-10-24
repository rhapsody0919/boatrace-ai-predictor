// 資料のページ（/admin/sns-hub/library）。フォーマットカタログと、展望素材 v0 の取り込み（Q4: 残して移した）
import SnsHubLayout from "./SnsHubLayout.jsx";
import CatalogTab from "./CatalogTab.jsx";
import BundleImportPanel from "./BundleImportPanel.jsx";

export default function LibraryPage() {
  return (
    <SnsHubLayout>
      <div className="sns-hub-tab-content">
        <CatalogTab />
      </div>
      {/* 取り込んだ下書きは手動承認のページに出る。ここでは結果の表示だけ */}
      <BundleImportPanel onImported={async () => {}} />
    </SnsHubLayout>
  );
}
