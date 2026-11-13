import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import AiCopyPromptSelector from "./AiCopyPromptSelector";
import AiCopyBannerButtonRow from "./AiCopyBannerButtonRow";
import AiCopyBannerPreviewBody from "./AiCopyBannerPreviewBody";
import { useAiCopyText } from "../../hooks/useAiCopyText";

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
  const [previewOpen, setPreviewOpen] = useState(false);
  // AiCopyButton自体もisReadyで自身を隠すが、バナーの他要素
  // （バッジ・券種セレクタ・プレビュー開閉）だけが先に表示され、
  // 肝心のボタンだけ無いという壊れて見える状態を避けるため、
  // バナー全体をisReadyでゲートする（同じキャッシュ済みフックの再呼び出しのため
  // 追加のデータ取得コストは発生しない）
  const { isReady, buildText } = useAiCopyText({
    raceId,
    prediction,
    race,
    venueCode,
  });

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
      <AiCopyBannerButtonRow
        raceId={raceId}
        prediction={prediction}
        race={race}
        venueCode={venueCode}
        promptType={promptType}
        onCopy={onCopy}
      />
      <AiCopyPromptSelector
        value={promptType}
        onChange={onPromptTypeChange}
        volatilityPercentile={prediction?.volatilityPercentile}
        inCautionLevel={prediction?.inCaution?.level ?? null}
      />
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
            style={{ width: "100%", minWidth: 0, overflow: "hidden" }}
          >
            <AiCopyBannerPreviewBody
              buildText={buildText}
              promptType={promptType}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
