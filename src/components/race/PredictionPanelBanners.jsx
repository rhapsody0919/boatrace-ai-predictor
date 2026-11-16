/**
 * PredictionPanel の公式サイトリンク・状態バナー・エラー表示
 */
const BANNER_STYLE = {
  marginTop: "1rem",
  marginBottom: "1.5rem",
  padding: "0.75rem 1rem",
  background: "var(--color-gray-100)",
  borderRadius: "8px",
  borderLeft: "4px solid var(--color-gray-600)",
  color: "var(--color-gray-700)",
};

export function OfficialLinkBanner({ officialUrl, t }) {
  if (!officialUrl) return null;
  return (
    <div
      style={{
        marginTop: "1rem",
        marginBottom: "1.5rem",
        padding: "0.75rem 1rem",
        background: "#e3f2fd",
        borderRadius: "8px",
        borderLeft: "4px solid #2196f3",
      }}
    >
      <span style={{ marginRight: "0.5rem" }}>&#x1F517;</span>
      <a
        href={officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#0ea5e9",
          textDecoration: "none",
          fontWeight: "500",
        }}
      >
        {t("panel.officialLink")}
      </a>
      <span
        style={{
          marginLeft: "0.5rem",
          fontSize: "0.9rem",
          color: "#475569",
        }}
      >
        {t("panel.newTab")}
      </span>
    </div>
  );
}

export function StatusBanner({ isCancelled, isAwaitingResult, t }) {
  if (isCancelled) {
    return <div style={BANNER_STYLE}>{t("panel.cancelledBanner")}</div>;
  }
  return (
    isAwaitingResult && (
      <div style={BANNER_STYLE}>{t("panel.awaitingResultBanner")}</div>
    )
  );
}

export function PredictionErrorView({ prediction, isCancelled, t }) {
  // 中止・順延（BOA-254）で選手情報が無く出走表自体が組めないレースは、
  // 汎用の「予想データが利用できません」ではなく専用メッセージを出す
  if (isCancelled) {
    return (
      <div
        className="prediction-cancelled"
        style={{
          padding: "2rem",
          background: "var(--color-gray-100)",
          borderRadius: "12px",
          border: "2px solid var(--color-gray-600)",
          textAlign: "center",
        }}
      >
        <h3 style={{ color: "var(--color-gray-700)" }}>
          {t("panel.cancelledBanner")}
        </h3>
      </div>
    );
  }
  return (
    <div
      className="prediction-error"
      style={{
        padding: "2rem",
        background: "#fff3cd",
        borderRadius: "12px",
        border: "2px solid #ffc107",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
        &#x26A0;&#xFE0F;
      </div>
      <h3 style={{ color: "#856404", marginBottom: "1rem" }}>
        {t("panel.noData")}
      </h3>
      <p style={{ color: "#856404" }}>{prediction.errorMessage}</p>
    </div>
  );
}
