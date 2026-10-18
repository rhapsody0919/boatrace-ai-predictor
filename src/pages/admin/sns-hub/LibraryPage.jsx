// 資料のページ（/admin/sns-hub/library）。フォーマットカタログと、展望素材 v0 の取り込み（Q4: 残して移した）
import { useEffect, useState } from "react";
import SnsHubLayout from "./SnsHubLayout.jsx";
import CatalogTab from "./CatalogTab.jsx";
import BundleImportPanel from "./BundleImportPanel.jsx";
import { getTemplateVariants } from "../../../services/snsHubService";

export default function LibraryPage() {
  const [templateVariants, setTemplateVariants] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getTemplateVariants()
      .then((rows) => {
        if (active) setTemplateVariants(rows);
      })
      .catch((err) => {
        console.error("型一覧取得エラー:", err);
        if (active)
          setError(
            "型一覧を取得できませんでした。画面を再読み込みしてください。",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <SnsHubLayout>
      <div className="sns-hub-tab-content">
        {error && <p role="alert">{error}</p>}
        <CatalogTab templateVariants={templateVariants} />
      </div>
      {/* 取り込んだ下書きは手動承認のページに出る。ここでは結果の表示だけ */}
      <BundleImportPanel onImported={async () => {}} />
    </SnsHubLayout>
  );
}
