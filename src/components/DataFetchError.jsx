/**
 * DataFetchError - データ取得失敗の表示（再読み込みボタン付き）
 * 取得失敗を「開催なし」「データなし」と誤解させないための共通表示。
 * 取得に成功して0件だったケースには使わない（それは各画面の空状態表示）。
 */
import { useTranslation } from "react-i18next";
import "./DataFetchError.css";

function DataFetchError({ detail = null }) {
  const { t } = useTranslation();
  return (
    <div className="data-fetch-error" role="alert">
      <p className="data-fetch-error__title">⚠️ {t("home.fetchErrorTitle")}</p>
      {detail && <p>{detail}</p>}
      <p>{t("home.fetchErrorDesc")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="data-fetch-error__reload"
      >
        {t("home.reload")}
      </button>
    </div>
  );
}

export default DataFetchError;
