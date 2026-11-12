import { useTranslation } from "react-i18next";
import { aiCopyFollowUpKeys } from "../../utils/aiCopyPrompts";
import { isInCautionEnabled } from "../../config/featureFlags";

export default function AiCopyBannerPreviewBody({ buildText, promptType }) {
  const { t } = useTranslation();
  return (
    <>
      {/* コピーされる全文（表・注記・出典を含む、BOA-770 推奨9）。
            表だけは横に長いので折り返さずに箱の中で横スクロールさせ、前提の行・注記・
            質問文は折り返して読めるようにする（375px で質問文が切れていた。ファン評価2周目） */}
      <div
        data-testid="ai-copy-preview"
        style={{
          margin: "8px 0 0",
          padding: "10px 12px",
          background: "#ffffff",
          border: "1px solid var(--color-primary-alpha-30)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-gray-700)",
          lineHeight: 1.6,
          maxHeight: "320px",
          overflowY: "auto",
        }}
      >
        {buildText(promptType)
          .split("\n\n")
          .map((block, i) => {
            const isTable = block.startsWith("|");
            return (
              <pre
                key={i}
                style={{
                  margin: i === 0 ? 0 : "8px 0 0",
                  fontFamily: "inherit",
                  whiteSpace: isTable ? "pre" : "pre-wrap",
                  overflowWrap: isTable ? "normal" : "anywhere",
                  overflowX: isTable ? "auto" : "visible",
                }}
              >
                {block}
              </pre>
            );
          })}
      </div>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-gray-700)",
        }}
      >
        {t("aiCopy.followUpHeading")}
      </p>
      <ul
        style={{
          margin: "4px 0 0",
          paddingLeft: "1.25rem",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-gray-600)",
          lineHeight: 1.6,
        }}
      >
        {aiCopyFollowUpKeys(isInCautionEnabled()).map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
    </>
  );
}
