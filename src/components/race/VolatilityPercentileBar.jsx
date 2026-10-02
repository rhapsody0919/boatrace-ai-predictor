import { useTranslation } from "react-i18next";
import {
  getVolatilityLevel,
  volatilityDisplayValue,
} from "../../utils/volatilityLevel";
import "./VolatilityPercentileBar.css";

/**
 * イン崩れ指数（会場内パーセンタイル 0〜1）を 0〜100 のバーで示す。
 * レース前（VolatilityDisplay）とレース後の振り返り（RaceAiPredictionTab）で同じ見せ方にする
 * （BOA-706。振り返りでは「会場内パーセンタイル0」と文字で出していて、専門用語のうえ「0」が
 * 確率0%に見えた）。
 *
 * @param {number} percentile 0〜1。高いほど1号艇が崩れやすい
 * @param {boolean} [onLight] 常に明るい地のカード（VolatilityDisplay）に載せるとき true。
 *   ダークモードでもカードの地が明るいので、意味トークンではなく固定の色にする
 */
function VolatilityPercentileBar({ percentile, onLight = false }) {
  const { t } = useTranslation();
  // 数値はラベルの境目をまたがない値にする（同じ70で「標準」と「イン崩れ確率高」が出ないように）
  const pct = volatilityDisplayValue(percentile);
  // 色の段階は、ラベル（本命有利・イン崩れ確率高）と同じ基準で決める
  const tone = getVolatilityLevel(percentile) ?? "standard";

  return (
    <div
      className={`vpb vpb--${tone}${onLight ? " vpb--on-light" : ""}`}
      data-testid="volatility-percentile-bar"
    >
      <div className="vpb-head">
        <span className="vpb-label">{t("volatility.percentileBarLabel")}</span>
        <span className="vpb-value">{pct}</span>
      </div>
      <div className="vpb-track">
        <div className="vpb-fill" style={{ width: `${pct}%` }} />
        <div className="vpb-median" />
        {/* 今の値の位置の印。値が0に近いと塗りが見えず、真ん中の「標準」の目印だけが
            目に入って「標準」と読めた（PR #1186 ファン評価1周目） */}
        <div
          className="vpb-marker"
          style={{ left: `${pct}%` }}
          data-testid="volatility-percentile-marker"
        />
      </div>
      <div className="vpb-ends">
        <span>{t("volatility.percentileBarMin")}</span>
        <span>{t("volatility.percentileBarMedian")}</span>
        <span>{t("volatility.percentileBarMax")}</span>
      </div>
    </div>
  );
}

export default VolatilityPercentileBar;
