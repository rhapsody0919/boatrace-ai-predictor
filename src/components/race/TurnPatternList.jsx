/**
 * TurnPatternList - 展開予測の上位パターンを確率付きランキングで表示する共有コンポーネント
 *
 * 背景（2026-08-14）: 展開予測の実測的中率（約80%）は「上位パターンのいずれかの
 * winnerCourseが実際の1着と一致すれば的中」という定義（verify-turn-prediction-accuracy-v6.js）。
 * これを「予想: 1・2・3号艇が1着」のように単一の断定予想として見せると、
 * (1) 複数艇を並べているだけで何を予想したのか分からない、
 * (2) 1位予想の確率が例えば47%しかない場合でも「1号艇が1着」と断定的に見えてしまい、
 *     イン崩れ注意度（波乱リスク高）の表示と矛盾しているように見える、
 * という2つの問題があった。確率付きの候補ランキングとして正直に見せることで、
 * どの程度の自信度の予想なのかが一目でわかるようにする。
 *
 * PredictionPanel（レース前）とRaceResult/RaceReview（レース後）で共有する。
 * actualWinnerを渡すとレース後モードになり、一致した行をハイライトし結果を明示する。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";
import "./TurnPatternList.css";

const RANK_ICONS = ["🥇", "🥈", "🥉"];

function TurnPatternList({ patterns, actualWinner = null }) {
  const { t } = useTranslation();

  if (!Array.isArray(patterns) || patterns.length === 0) return null;

  // patterns[].technique は "nige"/"sashi" 等の英語キー（TECHNIQUE_KEY_BY_NAMEの
  // 日本語名→キーとは向きが逆。FirstMarkAnimation.jsxのuseTechniqueLabelと同じ変換）
  const translateTechnique = (key) =>
    t(`techniques.${key}`, TECHNIQUE_NAMES[key] || key);

  const isResultMode = actualWinner != null;
  const hasHit =
    isResultMode && patterns.some((p) => p.winnerCourse === actualWinner);

  return (
    <div className="turn-pattern-list">
      {patterns.map((pattern, index) => {
        const isMatch = isResultMode && pattern.winnerCourse === actualWinner;
        const colors = BOAT_COLORS[pattern.winnerCourse] || BOAT_COLORS[1];
        return (
          <div
            key={`${pattern.winnerCourse}-${pattern.technique}-${index}`}
            className={`turn-pattern-row${isMatch ? " turn-pattern-row--hit" : ""}`}
          >
            <span className="turn-pattern-rank">
              {RANK_ICONS[index] || `${index + 1}`}
            </span>
            <span
              className="turn-pattern-boat"
              style={{ background: colors.bg, color: colors.text }}
            >
              {pattern.winnerCourse}
            </span>
            <span className="turn-pattern-technique">
              {translateTechnique(pattern.technique)}
            </span>
            <span className="turn-pattern-prob">
              {Math.round(pattern.probability * 100)}%
            </span>
            {isMatch && (
              <span className="turn-pattern-hit-tag">
                {t("turnPatternList.hitTag")}
              </span>
            )}
          </div>
        );
      })}

      {isResultMode && (
        <p
          className={`turn-pattern-summary${hasHit ? " turn-pattern-summary--hit" : " turn-pattern-summary--miss"}`}
        >
          {hasHit
            ? t("turnPatternList.summaryHit")
            : t("turnPatternList.summaryMiss", { winnerNumber: actualWinner })}
        </p>
      )}
    </div>
  );
}

export default TurnPatternList;
