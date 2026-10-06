import { useTranslation } from "react-i18next";
import { useAiCopyText } from "../../hooks/useAiCopyText";
import { getAiCopyPromptLabel } from "../../utils/aiCopyPrompts";

export default function AiCopyButton({
  variant = "inline",
  raceId,
  prediction,
  race,
  venueCode,
  promptType,
  onCopy,
}) {
  const { t } = useTranslation();
  const { buildText, isReady } = useAiCopyText({
    raceId,
    prediction,
    race,
    venueCode,
  });

  if (!isReady) return null;

  const handleCopy = async () => {
    try {
      const text = buildText(promptType);
      await navigator.clipboard.writeText(text);
      onCopy?.(t("aiCopy.toastSuccess"), "success");
    } catch {
      onCopy?.(t("aiCopy.toastError"), "error");
    }
  };

  // 上のバナーと下のボタンは同じ機能なので、同じ見た目・同じ文言にそろえる（BOA-770 推奨12）
  const style = {
    border: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-md)",
    fontWeight: 700,
    color: "#ffffff",
    background: "var(--gradient-primary)",
    whiteSpace: "nowrap",
    padding: "10px 18px",
    fontSize: "1rem",
    ...(variant === "inline" && { marginTop: "0.75rem" }),
  };

  const button = (
    <button
      type="button"
      className={`ai-copy-btn ai-copy-btn-${variant}`}
      onClick={handleCopy}
      style={style}
    >
      {t("aiCopy.bannerLabel")}
    </button>
  );

  if (variant !== "inline") return button;

  // ページ末尾のボタンは単独だと SNS 共有の仲間に見え、どの質問が付くかも分からないため、
  // 上のバナーで選んでいる質問を添える（BOA-770 ファン評価）
  return (
    <div className="ai-copy-inline">
      {button}
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {t("aiCopy.inlinePromptCaption", {
          label: getAiCopyPromptLabel(t, promptType),
        })}
      </p>
    </div>
  );
}
