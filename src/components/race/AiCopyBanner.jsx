import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AiCopyPromptSelector from "./AiCopyPromptSelector";
import AiCopyButton from "./AiCopyButton";
import { useAiCopyText } from "../../hooks/useAiCopyText";
import { getAiCopyPromptText } from "../../utils/aiCopyPrompts";

const scrollToDataRaceTable = () => {
  document
    .getElementById("data-race-table")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};

// 脈動リングを時間差で2重に描画し、ping通知のような目立つ演出にする
const PING_RINGS = [0, 0.7];

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
  const [previewOpen, setPreviewOpen] = useState(false);
  // AiCopyButton自体もisReadyで自身を隠すが、バナーの他要素
  // （バッジ・券種セレクタ・プレビュー開閉）だけが先に表示され、
  // 肝心のボタンだけ無いという壊れて見える状態を避けるため、
  // バナー全体をisReadyでゲートする（同じキャッシュ済みフックの再呼び出しのため
  // 追加のデータ取得コストは発生しない）
  const { isReady } = useAiCopyText({ raceId, prediction, race, venueCode });

  if (!isReady) return null;

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
        {/* ボタン自体は静止させ、背後にping通知風の脈動リングだけを重ねる
            （ボタンをscaleさせるとPlaywrightのactionability判定が
            「element is not stable」で失敗し続けるだけでなく、実クリック時の
            座標もフレームごとにずれるため、装飾要素として分離した）。
            リングのラッパーはボタンだけを子に持つ（キャッチコピーバッジを
            含めると脈動範囲がバッジまで広がってしまうため） */}
        <div style={{ position: "relative", display: "inline-block" }}>
          {!prefersReducedMotion &&
            PING_RINGS.map((delay) => (
              <motion.span
                key={delay}
                aria-hidden="true"
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay,
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
            ))}
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
        {/* バッジ自体は独立要素のためPlaywrightのクリック対象にならず、
            上下バウンスを付けても操作性に影響しない */}
        <motion.span
          animate={prefersReducedMotion ? {} : { y: [0, -4, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
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
        </motion.span>
      </div>
      <AiCopyPromptSelector value={promptType} onChange={onPromptTypeChange} />

      <button
        type="button"
        onClick={() => setPreviewOpen((prev) => !prev)}
        aria-expanded={previewOpen}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--color-primary-700)",
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: previewOpen ? "rotate(90deg)" : "none",
          }}
        >
          ▸
        </span>
        {t("aiCopy.previewToggleLabel")}
      </button>
      <AnimatePresence>
        {previewOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ width: "100%", overflow: "hidden" }}
          >
            <p
              style={{
                margin: "8px 0 0",
                padding: "10px 12px",
                background: "#ffffff",
                border: "1px solid var(--color-primary-alpha-30)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-gray-600)",
                lineHeight: 1.6,
              }}
            >
              {getAiCopyPromptText(t, promptType)}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
