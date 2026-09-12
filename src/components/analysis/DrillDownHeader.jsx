/**
 * DrillDownHeader - ドリルダウン画面共通の「戻る」ボタン＋見出し（BOA-280）
 * racerIdを渡すと選手ページへのリンクも表示する（モーターのドリルダウンには無い）。
 */
import { Link } from "react-router-dom";

function DrillDownHeader({
  onBack,
  backLabel,
  heading,
  racerId,
  racerLinkLabel,
}) {
  return (
    <>
      <button className="back-to-ranking-btn" onClick={onBack}>
        {backLabel}
      </button>
      <h3 className="selected-motor-heading" translate="no">
        {heading}
      </h3>
      {racerId != null && (
        <Link to={`/racer/${racerId}`} className="racer-page-link">
          {racerLinkLabel}
        </Link>
      )}
    </>
  );
}

export default DrillDownHeader;
