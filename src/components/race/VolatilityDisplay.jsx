/**
 * VolatilityDisplay - イン崩れ指数バッジ（FR3、AI予想モデル大規模改修）
 * 会場内パーセンタイル（0-1、高いほど1号艇が崩れやすい）を表示する。
 * high/medium/lowの3段階ラベル・おすすめモデル提示（旧3モデル切替）は廃止し、
 * 連続値パーセンタイル＋実測相関の裏付けを示す構成に変更した（ADR0012、screens.md）。
 */
import { useTranslation } from "react-i18next";

function PercentileBar({ percentile }) {
  const { t } = useTranslation();
  const pct = Math.round(percentile * 100);
  const color =
    percentile >= 0.7 ? "#ff9800" : percentile <= 0.3 ? "#4caf50" : "#2196f3";

  return (
    <div
      style={{
        marginTop: "0.75rem",
        marginBottom: "0.25rem",
        padding: "0.6rem 0.75rem",
        background: "rgba(255,255,255,0.55)",
        borderRadius: "6px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.4rem",
        }}
      >
        <span style={{ fontSize: "0.82rem", color: "#555" }}>
          {t("volatility.percentileBarLabel")}
        </span>
        <span style={{ fontSize: "1.25rem", fontWeight: "700", color }}>
          {pct}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          height: "6px",
          background: "#e0e0e0",
          borderRadius: "3px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: "3px",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-3px",
            bottom: "-3px",
            width: "2px",
            background: "#616161",
            borderRadius: "1px",
            transform: "translateX(-50%)",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.68rem",
          color: "#999",
          marginTop: "0.25rem",
        }}
      >
        <span>{t("volatility.percentileBarMin")}</span>
        <span>{t("volatility.percentileBarMedian")}</span>
        <span>{t("volatility.percentileBarMax")}</span>
      </div>
    </div>
  );
}

function VolatilityDisplay({ percentile, reasons, isFallback }) {
  const { t } = useTranslation();

  if (percentile === null || percentile === undefined) {
    return null;
  }

  // 会場内パーセンタイル分布のサンプル数が不足している場合、フォールバック値0.5を
  // そのまま「標準」として表示すると実データのように見えてしまうため、
  // 「データ収集中」であることを誠実に伝える表示に切り替える（2026-08-14ユーザー指摘）
  if (isFallback) {
    return (
      <div
        style={{
          padding: "1rem 1.5rem",
          background: "#f5f5f5",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          borderLeft: "4px solid #9e9e9e",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>📊</span>
          <span style={{ fontWeight: "600", color: "#333" }}>
            {t("volatility.attentionTitle")}
          </span>
          <span
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: "500",
              background: "#9e9e9e",
              color: "white",
            }}
          >
            {t("volatility.collectingData")}
          </span>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "#777",
            paddingLeft: "1.7rem",
          }}
        >
          {t("volatility.collectingDataDesc")}
        </div>
        {reasons && reasons.length > 0 && (
          <div
            style={{
              fontSize: "0.9rem",
              color: "#555",
              paddingLeft: "1.7rem",
              marginTop: "0.5rem",
            }}
          >
            <ul
              style={{
                margin: "0",
                paddingLeft: "1.2rem",
                listStyleType: "disc",
              }}
            >
              {reasons.map((reason, index) => (
                <li key={index} style={{ marginBottom: "0.25rem" }}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const level =
    percentile >= 0.7 ? "high" : percentile <= 0.3 ? "low" : "standard";
  const icon = level === "high" ? "🌪️" : level === "low" ? "🎯" : "⚖️";
  const bg =
    level === "high" ? "#fff3e0" : level === "low" ? "#e8f5e9" : "#e3f2fd";
  const border =
    level === "high" ? "#ff9800" : level === "low" ? "#4caf50" : "#2196f3";
  const attentionLabel =
    level === "high"
      ? t("volatility.attentionHigh")
      : level === "low"
        ? t("volatility.attentionLow")
        : t("volatility.attentionStandard");

  return (
    <div
      style={{
        padding: "1rem 1.5rem",
        background: bg,
        borderRadius: "8px",
        marginBottom: "1.5rem",
        borderLeft: `4px solid ${border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontSize: "1.2rem" }}>{icon}</span>
        <span style={{ fontWeight: "600", color: "#333" }}>
          {t("volatility.attentionTitle")}
        </span>
        <span
          style={{
            padding: "0.25rem 0.75rem",
            borderRadius: "12px",
            fontSize: "0.85rem",
            fontWeight: "500",
            background: border,
            color: "white",
          }}
        >
          {attentionLabel}
        </span>
      </div>

      <div
        style={{
          fontSize: "0.8rem",
          color: "#777",
          paddingLeft: "1.7rem",
          marginBottom: "0.25rem",
        }}
      >
        {t("volatility.description")}
      </div>

      <PercentileBar percentile={percentile} />

      {reasons && reasons.length > 0 && (
        <div
          style={{
            fontSize: "0.9rem",
            color: "#555",
            paddingLeft: "1.7rem",
            marginTop: "0.5rem",
          }}
        >
          <ul
            style={{
              margin: "0",
              paddingLeft: "1.2rem",
              listStyleType: "disc",
            }}
          >
            {reasons.map((reason, index) => (
              <li key={index} style={{ marginBottom: "0.25rem" }}>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default VolatilityDisplay;
