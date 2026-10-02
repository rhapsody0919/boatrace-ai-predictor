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
import { trackEvent } from "../../utils/analytics";
import RaceMoodEffect from "./RaceMoodEffect";
import TermHintButton from "./TermHintButton";
import VolatilityPercentileBar from "./VolatilityPercentileBar";

// VolatilityDisplayのlevel（high/low/standard）→ calculate-unified-volatility-accuracy.js
// の集計キー（high/low/medium）への対応
const STATS_LEVEL_KEY = { high: "high", low: "low", standard: "medium" };

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
            onClick={() =>
              trackEvent("deep_link_click", {
                tab: "volatility",
                link_source: "volatility_display",
              })
            }
          >
            {t("volatility.accuracyLink")}
          </Link>
        </>
      )}
    </div>
  );
}

// AIが生成する根拠文（volatilityReasons）は日本語の自然文でDBに保存されており、
// 翻訳インフラの外にある（構造化データ化・DBスキーマ変更が必要な大きめの作業、
// BOA-252で将来対応検討）。日本語以外のロケールでは未翻訳の日本語文をそのまま
// 出さず、「日本語のみで利用可能」という誠実な注記に差し替える
function ReasonsList({ reasons, language, t }) {
  if (!reasons || reasons.length === 0) return null;

  if (language !== "ja") {
    return (
      <div
        style={{
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          paddingLeft: "1.7rem",
          marginTop: "0.5rem",
          fontStyle: "italic",
        }}
      >
        {t("volatility.reasonsJaOnly")}
      </div>
    );
  }

  return (
    <div
      style={{
        fontSize: "0.9rem",
        color: "var(--text-secondary)",
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
  );
}

function VolatilityDisplay({
  percentile,
  reasons,
  isFallback,
  venueCode,
  raceId,
}) {
  const { t, i18n } = useTranslation();

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
          background:
            "color-mix(in srgb, var(--text-secondary) 8%, var(--surface-card))",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          borderLeft: "4px solid var(--text-secondary)",
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
          <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>
            {t("volatility.attentionTitle")}
          </span>
          <TermHintButton termKey="inKuzureIndex" />
          <span
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: "500",
              background: "var(--text-secondary)",
              color: "var(--surface-card)",
            }}
          >
            {t("volatility.collectingData")}
          </span>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            paddingLeft: "1.7rem",
          }}
        >
          {t("volatility.collectingDataDesc")}
        </div>
        <ReasonsList reasons={reasons} language={i18n.language} t={t} />
      </div>
    );
  }

  const level = getVolatilityLevel(percentile);
  const icon = level === "high" ? "🌪️" : level === "low" ? "🎯" : "⚖️";
  // 色はテーマのトークンから作る（race-detail-ui-unify FR-6・R6）。以前は明るい固定色の
  // カード（#fff3e0 等）で、ダークでもカードだけ白く浮き、ラベルは白字に橙・緑の地で
  // コントラストが足りなかった（約2〜3:1）。地はカード色に段階の色を薄く混ぜ、ラベルは
  // 段階の色の文字＋薄い地（モック承認済み）
  const tone =
    level === "high"
      ? "var(--color-warning-text)"
      : level === "low"
        ? "var(--color-success-text)"
        : "var(--color-info-text)";
  const bg = `color-mix(in srgb, ${tone} 8%, var(--surface-card))`;
  const border = tone;
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
          // 375px で見出しが「イン崩れ注意／度」と1文字だけ折れたので、見出しとラベルは
          // 折らずに、入らないときはラベルを次の行へ送る（race-detail-ui-unify PR5）
          flexWrap: "wrap",
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
        <span
          style={{
            fontWeight: "600",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {t("volatility.attentionTitle")}
        </span>
        <TermHintButton termKey="inKuzureIndex" />
        <span
          style={{
            padding: "0.25rem 0.75rem",
            borderRadius: "12px",
            fontSize: "0.85rem",
            fontWeight: "700",
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
            color: tone,
            whiteSpace: "nowrap",
          }}
        >
          {attentionLabel}
        </span>
      </div>

      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          paddingLeft: "1.7rem",
          marginBottom: "0.25rem",
        }}
      >
        {t("volatility.description")}
      </div>

      <LevelAccuracyStat level={level} venueCode={venueCode} raceId={raceId} />

      <VolatilityPercentileBar percentile={percentile} />

      <ReasonsList reasons={reasons} language={i18n.language} t={t} />
    </div>
  );
}

export default VolatilityDisplay;
