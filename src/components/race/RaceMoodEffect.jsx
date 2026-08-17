import { motion, useReducedMotion } from "framer-motion";

/**
 * RaceMoodEffect - イン崩れ指数レベルに応じた波紋ムード演出（BOA-195）
 * 艇番・決まり手等の具体的な予測内容は一切表現しない、純粋な装飾コンポーネント。
 * VolatilityDisplayのアイコンの背後に重ねて使う想定（position: relativeの
 * 親要素の中でinset: 0を占有する）。数値はArtifactプロトタイプで検証済み
 * （docs/design/race-open-animation/plan.md参照）
 */
// scaleは実際のアイコンサイズ（1.2rem、約19px）を基準にした値。
// Artifactプロトタイプでは108pxの専用ステージ内でscale:9としていたが、
// アイコンサイズにそのまま適用すると300px超まで広がりテキストと重なるため、
// アイコン周辺に収まる控えめな値（2〜3倍）に調整した
const LEVEL_CONFIG = {
  high: {
    rings: 5,
    duration: 1.15,
    delayStep: 0.28,
    maxScale: 3.2,
    color: "var(--color-warning-light)",
  },
  standard: {
    rings: 3,
    duration: 1.9,
    delayStep: 0.63,
    maxScale: 2.6,
    color: "var(--color-info)",
  },
  low: {
    rings: 2,
    duration: 2.8,
    delayStep: 1.4,
    maxScale: 2,
    color: "var(--color-success-light)",
  },
};

export default function RaceMoodEffect({ level }) {
  const prefersReducedMotion = useReducedMotion();
  const config = LEVEL_CONFIG[level];

  if (!config || prefersReducedMotion) return null;

  return (
    <div
      className="race-mood-effect"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {Array.from({ length: config.rings }).map((_, i) => (
        <motion.span
          key={i}
          className="race-mood-effect-ring"
          animate={{ scale: [1, config.maxScale], opacity: [0.55, 0] }}
          transition={{
            duration: config.duration,
            repeat: Infinity,
            ease: "easeOut",
            delay: i * config.delayStep,
          }}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `2px solid ${config.color}`,
          }}
        />
      ))}
    </div>
  );
}
