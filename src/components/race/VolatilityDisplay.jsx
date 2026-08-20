/**
 * VolatilityDisplay - イン崩れ指数バッジ（FR3、AI予想モデル大規模改修）
 * 会場内パーセンタイル（0-1、高いほど1号艇が崩れやすい）を表示する。
 * high/medium/lowの3段階ラベル・おすすめモデル提示（旧3モデル切替）は廃止し、
 * 連続値パーセンタイル＋実測相関の裏付けを示す構成に変更した（ADR0012、screens.md）。
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useUnifiedVolatilityAccuracy } from "../../hooks/useUnifiedVolatilityAccuracy";
import { getVolatilityLevel } from "../../utils/volatilityLevel";
import RaceMoodEffect from "./RaceMoodEffect";

// VolatilityDisplayのlevel（high/low/standard）→ calculate-unified-volatility-accuracy.js
// の集計キー（high/low/medium）への対応
const STATS_LEVEL_KEY = { high: "high", low: "low", standard: "medium" };

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

/**
 * LevelAccuracyStat - 今表示しているレベル（警戒/標準/堅い）に対応する実測値を
 * その場で示す（BOA-177）。複勝予想/展開予測カードのAccuracyStatBadgeと同じ
 * 「AIの結論のすぐそばに実測の裏付けを置く」設計方針を踏襲。
 * データ取得はcalculate-unified-volatility-accuracy.jsが日次で保存した値を
 * 読むだけの軽量フックのため、レースごとの追加クエリは発生しない
 */
function LevelAccuracyStat({ level, venueCode, raceId }) {
  const { t } = useTranslation();
  const { stats, loading } = useUnifiedVolatilityAccuracy();

  if (loading) {
    return (
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          paddingLeft: "1.7rem",
          marginTop: "0.5rem",
        }}
      >
        {t("volatility.accuracyLoading")}
      </div>
    );
  }

  const levelStat = stats?.byLevel?.[STATS_LEVEL_KEY[level]];
  if (!levelStat) return null;

  return (
    <div
      style={{
        fontSize: "0.85rem",
        color: "var(--text-secondary)",
        paddingLeft: "1.7rem",
        marginTop: "0.5rem",
      }}
    >
      📈{" "}
      {t("volatility.accuracyStat", {
        level: t(
          `volatility.attention${level === "standard" ? "Standard" : level === "high" ? "High" : "Low"}`,
        ),
        rate: levelStat.upsetRate,
        count: levelStat.raceCount,
        baseline: stats.baseline.upsetRate,
      })}
      {venueCode && raceId && (
        <>
          {" "}
          <Link
            to={`/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=volatility`}
            style={{
              color: "var(--brand-accent-primary)",
              textDecoration: "none",
            }}
          >
            {t("volatility.accuracyLink")}
          </Link>
        </>
      )}
    </div>
  );
}

function VolatilityDisplay({
  percentile,
  reasons,
  isFallback,
  venueCode,
  raceId,
}) {
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
        className="volatility-display volatility-display-fallback"
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

  const level = getVolatilityLevel(percentile);
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
      className={`volatility-display volatility-display-${level}`}
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
        {/* イン崩れレベルに応じた波紋ムード演出（BOA-195）。艇番・決まり手等の
            具体的な予測内容は表現しない純粋な装飾のため、アイコンの背後に重ねる */}
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            fontSize: "1.2rem",
          }}
        >
          <RaceMoodEffect level={level} />
          <span style={{ position: "relative", zIndex: 1 }}>{icon}</span>
        </span>
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

      <LevelAccuracyStat level={level} venueCode={venueCode} raceId={raceId} />

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
