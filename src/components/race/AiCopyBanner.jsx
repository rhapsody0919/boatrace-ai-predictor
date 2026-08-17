import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import AiCopyPromptSelector from "./AiCopyPromptSelector";
import AiCopyButton from "./AiCopyButton";

const scrollToDataRaceTable = () => {
  document
    .getElementById("data-race-table")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export default function AiCopyBanner({
  raceId,
  prediction,
  race,
  venueCode,
  promptType,
  onPromptTypeChange,
  onCopy,
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className="ai-copy-banner"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px",
        background: "var(--color-primary-alpha-10)",
        border: "1px solid var(--color-primary-alpha-30)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* ボタン自体は静止させ、背後に脈動するグローだけを重ねる
            （ボタンをscaleさせるとPlaywrightのactionability判定が
            「element is not stable」で失敗し続けるだけでなく、実クリック時の
            座標もフレームごとにずれるため、装飾要素として分離した）。
            グローのラッパーはボタンだけを子に持つ（キャッチコピーバッジを
            含めると脈動範囲がバッジまで広がってしまうため） */}
        <div style={{ position: "relative", display: "inline-block" }}>
          {!prefersReducedMotion && (
            <motion.span
              aria-hidden="true"
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "var(--radius-md)",
                background: "var(--color-primary-500)",
                zIndex: 0,
                pointerEvents: "none",
              }}
            />
          )}
          <div style={{ position: "relative", zIndex: 1 }}>
            <AiCopyButton
              variant="banner"
              raceId={raceId}
              prediction={prediction}
              race={race}
              venueCode={venueCode}
              promptType={promptType}
              onBeforeCopy={scrollToDataRaceTable}
              onCopy={onCopy}
            />
          </div>
        </div>
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            color: "var(--color-primary-700)",
            background: "#ffffff",
            padding: "3px 10px",
            borderRadius: "9999px",
            whiteSpace: "nowrap",
          }}
        >
          {t("aiCopy.bannerCatchphrase")}
        </span>
      </div>
      <AiCopyPromptSelector value={promptType} onChange={onPromptTypeChange} />
    </div>
  );
}
