/**
 * InlineFetchError - セクション単位のデータ取得失敗の表示（BOA-359）
 *
 * 取得失敗を「データなし」「対象外」と誤解させないための共通表示。
 * 取得に成功して0件だったケースには使わない（それは各画面の空状態表示）。
 *
 * ページ全体の失敗には DataFetchError（`window.location.reload()` でページごと再読み込み）を使い、
 * 画面の一部だけが失敗したときはこちらを使う。`onRetry` を渡すと、ページをリロードせず
 * そのセクションだけ取り直す（RacePitReportSection で確立した reloadKey 方式）。
 */
import { useTranslation } from "react-i18next";
import "./InlineFetchError.css";

function InlineFetchError({ message = null, onRetry = null }) {
  const { t } = useTranslation();
  return (
    <div className="inline-fetch-error" role="alert">
      <span className="inline-fetch-error__text">
        ⚠️ {message ?? t("home.fetchErrorTitle")}
      </span>
      {onRetry && (
        <button
          type="button"
          className="inline-fetch-error__retry"
          onClick={onRetry}
        >
          {t("pitReport.retry")}
        </button>
      )}
    </div>
  );
}

export default InlineFetchError;
