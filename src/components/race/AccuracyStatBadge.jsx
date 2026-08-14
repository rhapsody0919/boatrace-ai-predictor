/**
 * AccuracyStatBadge - unifiedモデルの実測精度を動的に表示するバッジ（BOA-179関連）
 * 複勝予想パネル・展開予測パネルの両方で使う共有コンポーネント。
 * calculate-unified-model-accuracy.js が日次で計算・保存した値をそのまま表示する
 * （ハードコードされた文言ではなく、実データから動的に算出された数値）
 */
import { useTranslation } from "react-i18next";

function AccuracyStatBadge({ loading, hitRate, recoveryRate, totalRaces }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="ai-analysis-block-badge ai-analysis-block-badge--loading">
        <span className="drt-skeleton" aria-hidden="true" />
      </p>
    );
  }

  if (hitRate == null || !totalRaces) return null;

  return (
    <p className="ai-analysis-block-badge">
      📈{" "}
      {recoveryRate != null
        ? t("accuracyStat.withRecovery", {
            hitRate: Math.round(hitRate * 100),
            recoveryRate: Math.round(recoveryRate * 100),
            totalRaces,
          })
        : t("accuracyStat.hitRateOnly", {
            hitRate: Math.round(hitRate * 100),
            totalRaces,
          })}
    </p>
  );
}

export default AccuracyStatBadge;
