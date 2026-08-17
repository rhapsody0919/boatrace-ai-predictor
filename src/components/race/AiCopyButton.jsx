import { useTranslation } from "react-i18next";
import { useAiCopyText } from "../../hooks/useAiCopyText";
import Toast, { useToast } from "../Toast";

export default function AiCopyButton({
  variant = "inline",
  raceId,
  prediction,
  race,
  promptType,
  onBeforeCopy,
}) {
  const { t } = useTranslation();
  const { buildText, isReady } = useAiCopyText({ raceId, prediction, race });
  const { toast, showToast } = useToast();

  if (!isReady) return null;

  const handleCopy = async () => {
    onBeforeCopy?.();
    try {
      const text = buildText(promptType);
      await navigator.clipboard.writeText(text);
      showToast(t("aiCopy.toastSuccess"), "success");
    } catch {
      showToast(t("aiCopy.toastError"), "error");
    }
  };

  const label =
    variant === "banner"
      ? t("aiCopy.bannerLabel")
      : t("aiCopy.inlineButtonLabel");

  const baseStyle = {
    border: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-md)",
    fontWeight: 700,
    color: "#ffffff",
    background: "var(--gradient-primary)",
    whiteSpace: "nowrap",
  };

  const style =
    variant === "banner"
      ? { ...baseStyle, padding: "10px 18px", fontSize: "1rem" }
      : {
          ...baseStyle,
          padding: "6px 14px",
          fontSize: "var(--font-size-sm)",
          marginTop: "0.75rem",
        };

  return (
    <>
      <button
        type="button"
        className={`ai-copy-btn ai-copy-btn-${variant}`}
        onClick={handleCopy}
        style={style}
      >
        {label}
      </button>
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </>
  );
}
